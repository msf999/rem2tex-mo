import { AppEvents, declareIndexPlugin, type ReactRNPlugin, SelectionType } from '@remnote/plugin-sdk';
import '../style.css';
import '../index.css'; // import <widget-name>.css
import {
  getFocusedParentRem,
  isRem2TexConversionError,
  normalizeUnknownError,
  REM2TEX_IGNORE_TAG,
  type Rem2TexTodoExportMode,
  runParagraphToTexConversion,
  runRem2TexConversion,
  runSelectionToTexConversion,
  toggleIgnoreTag,
} from '../lib/rem2tex';

/**
 * The Omnibar steals editor focus before a command's `action` runs, so by then
 * `plugin.editor.getSelection()` returns nothing and a multi-rem selection is invisible. RemNote's
 * own commands capture the selection when the palette opens; plugins get no such hook, so we cache
 * every POSITIVE selection event and read the cache back when the live call comes up empty.
 * (Same workaround as Incremental Everything's `editor_selection.ts`.)
 */
const SELECTION_CACHE_KEY = 'rem2tex-last-rem-selection';
const SELECTION_CACHE_TTL_MS = 30_000;

type CachedRemSelection = { remIds: string[]; capturedAt: number };

function registerSelectionTracker(plugin: ReactRNPlugin): void {
  plugin.event.addListener(AppEvents.EditorSelectionChanged, undefined, async () => {
    try {
      const selection = await plugin.editor.getSelection();
      if (selection?.type === SelectionType.Rem) {
        const remIds = (selection as { remIds?: string[] }).remIds;
        if (remIds && remIds.length > 0) {
          const entry: CachedRemSelection = { remIds, capturedAt: Date.now() };
          await plugin.storage.setSession(SELECTION_CACHE_KEY, entry);
        }
        return;
      }
      if (selection?.type === SelectionType.Text) {
        // The caret is now inside a single rem, so the block selection is over and the cache would
        // only mislead the next command. Verified live: opening the Omnibar reports NO selection at
        // all rather than a text one, so clearing here cannot throw away the selection we exist for.
        await plugin.storage.setSession(SELECTION_CACHE_KEY, undefined);
      }
      // No selection at all: leave the cache alone — that is exactly what the Omnibar reports.
    } catch {
      /* best effort; a tracker must never throw */
    }
  });
}

/** Ids of the rems selected in the editor: live first, then the cache the tracker keeps. */
async function getSelectedRemIds(plugin: ReactRNPlugin): Promise<string[]> {
  try {
    const live = await plugin.editor.getSelectedRem();
    if (live?.remIds?.length) return live.remIds;
  } catch {
    /* fall through to the cache */
  }
  try {
    const cached = await plugin.storage.getSession<CachedRemSelection>(SELECTION_CACHE_KEY);
    // Consumed on read, so a second run never silently re-exports the first run's selection: by
    // then the live call is the only truth, and with none the lib falls back to the focused rem.
    await plugin.storage.setSession(SELECTION_CACHE_KEY, undefined);
    if (cached?.remIds?.length && Date.now() - cached.capturedAt < SELECTION_CACHE_TTL_MS) {
      return cached.remIds;
    }
  } catch {
    /* no cache: fall back to the focused rem in the lib */
  }
  return [];
}

/** Toast text for anything thrown by a conversion (typed errors carry a human sentence). */
function failureMessage(error: unknown): string {
  if (isRem2TexConversionError(error)) {
    const where = error.sourceRemTitle ? ` (at rem “${error.sourceRemTitle}”)` : '';
    return `${error.headline}. ${error.whatHappened}${where}`;
  }
  return normalizeUnknownError(error);
}

async function onActivate(plugin: ReactRNPlugin) {
  registerSelectionTracker(plugin);

  /**
   * Paper export: no popup. The export rem (`Rem2Tex/Rem2Tex <timestamp>`) holds a Paper code block
   * and a Log code block; the toast only says whether to go and read the log.
   */
  const runPaperExport = async (
    todoExportMode: Rem2TexTodoExportMode,
    commandLabel: string
  ): Promise<void> => {
    try {
      const result = await runRem2TexConversion(plugin, { todoExportMode, commandLabel });
      if (result.status === 'success') {
        await plugin.app.toast(
          result.warningCount > 0
            ? `Rem2Tex: exported “${result.outputTitle}” with ${result.warningCount} warning(s) — check its Log.`
            : `Rem2Tex: exported “${result.outputTitle}”.`
        );
      } else {
        await plugin.app.toast(
          `Rem2Tex failed: ${result.errorHeadline}. See the Log under “${result.outputTitle}”.`
        );
      }
    } catch (error) {
      // Nothing was written (no paper found, or the export rems could not be created).
      await plugin.app.toast(`Rem2Tex: ${failureMessage(error)}`);
    }
  };

  // Convert the focused Paper rem tree into LaTeX and copy all todos as comments.
  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper',
    name: 'Rem2Tex: Convert Paper to TeX (Copy All Todos as Comments)',
    description:
      'Convert a Paper rem tree into LaTeX using Preamble/End and heading-formatted sections; copy all todos as `% TODO ...` comments.',
    quickCode: 'rem2tex',
    action: async () => runPaperExport('all', 'Convert Paper to TeX (Copy All Todos as Comments)'),
  });

  // Convert and copy only unfinished todos as comments.
  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper-unfinished-todos',
    name: 'Rem2Tex: Convert Paper to TeX (Copy Unfinished Todos as Comments)',
    description:
      'Convert a Paper rem tree into LaTeX and copy only unfinished todos as `% TODO ...` comments.',
    quickCode: 'rem2tex-unfinished',
    action: async () =>
      runPaperExport('unfinished', 'Convert Paper to TeX (Copy Unfinished Todos as Comments)'),
  });

  // Convert and do not copy todos as comments.
  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper-no-todos',
    name: 'Rem2Tex: Convert Paper to TeX (Do Not Copy Todos as Comments)',
    description: 'Convert a Paper rem tree into LaTeX and skip todo comment output.',
    quickCode: 'rem2tex-no-todos',
    action: async () => runPaperExport('none', 'Convert Paper to TeX (Do Not Copy Todos as Comments)'),
  });

  // Tag / untag the focused rem so exports skip it (and its subtree) without remembering the tag name.
  await plugin.app.registerCommand({
    id: 'rem2tex-toggle-ignore',
    name: `Rem2Tex: Toggle ${REM2TEX_IGNORE_TAG} tag on this rem`,
    description: `Add or remove the ${REM2TEX_IGNORE_TAG} tag on the focused rem. Tagged rems and their subtrees are left out of every Rem2Tex export.`,
    quickCode: 'rem2tex-ignore',
    action: async () => {
      try {
        const rem = await getFocusedParentRem(plugin);
        const outcome = await toggleIgnoreTag(plugin, rem);
        await plugin.app.toast(
          outcome === 'added'
            ? `Rem2Tex: tagged ${REM2TEX_IGNORE_TAG} — this rem and its subtree will be skipped by exports.`
            : `Rem2Tex: removed the ${REM2TEX_IGNORE_TAG} tag — this rem exports again.`
        );
      } catch (error) {
        await plugin.app.toast(`Rem2Tex: ${failureMessage(error)}`);
      }
    },
  });

  // Selected rem(s) -> one LaTeX code block with numbered citations and a numbered bibliography.
  await plugin.app.registerCommand({
    id: 'rem2tex-selection-to-tex',
    name: 'Rem2Tex: Selection to TeX (Numbered Citations + Bibliography)',
    description:
      'Convert the selected rem(s) and their descendants to LaTeX with `[1]`-style citations and a numbered bibliography built from the Zotero item properties. One rem: the export is its child. Several: a sister right after them.',
    quickCode: 'rem2tex-selection',
    action: async () => {
      try {
        const result = await runSelectionToTexConversion(plugin, {
          selectedRemIds: await getSelectedRemIds(plugin),
        });
        const scope =
          result.remCount === 1
            ? `“${result.exportedTitles[0] ?? 'the selected rem'}”`
            : `${result.remCount} rems (${result.exportedTitles.join(', ')})`;
        const citations =
          result.citationCount === 0
            ? 'no citations'
            : `${result.citationCount} reference(s)`;
        const missing =
          result.missingMetadataCount > 0
            ? ` — ${result.missingMetadataCount} without Zotero metadata, see the bibliography.`
            : '.';
        await plugin.app.toast(
          `Rem2Tex: exported ${scope} to “${result.outputTitle}” with ${citations}${missing}`
        );
      } catch (error) {
        await plugin.app.toast(`Rem2Tex selection export failed: ${failureMessage(error)}`);
      }
    },
  });

  await plugin.app.registerCommand({
    id: 'rem2tex-paragraph-to-tex',
    name: 'Rem2Tex: Paragraph to TeX',
    description:
      'Convert the focused rem (and its descendants) to LaTeX using the same rules as paper body text. All todos are copied as `% TODO ...` comments. Inserts a child export with a LaTeX code block.',
    quickCode: 'rem2tex-paragraph',
    action: async () => {
      try {
        const title = await runParagraphToTexConversion(plugin);
        await plugin.app.toast(`Rem2Tex: added “${title}” with LaTeX under this rem.`);
      } catch (error) {
        await plugin.app.toast(`Rem2Tex paragraph export failed: ${failureMessage(error)}`);
      }
    },
  });
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
