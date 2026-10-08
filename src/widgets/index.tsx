import { AppEvents, declareIndexPlugin, type ReactRNPlugin, SelectionType, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import '../index.css'; // import <widget-name>.css
import {
  getFocusedParentRem,
  isRem2TexConversionError,
  normalizeUnknownError,
  REM2TEX_IGNORE_TAG,
  previewRem2TexConvert,
  REM2TEX_CONVERT_REQUEST_KEY,
  REM2TEX_CONVERT_WIDGET,
  type Rem2TexConvertKind,
  type Rem2TexConvertRequest,
  runRem2TexConvert,
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

  // Same size as Remzot's sync popup, which fits without clamping.
  await plugin.app.registerWidget(REM2TEX_CONVERT_WIDGET, WidgetLocation.Popup, {
    dimensions: { height: 800, width: 1000 },
  });

  /**
   * Every conversion goes through one place: preview first, then decide.
   *  - Paper ALWAYS opens the popup, because that is where the todo options live.
   *  - Paragraph and Selection open it only when there is something to say — pins that could become
   *    citekeys, or an error/warning worth seeing. Otherwise they just run and toast.
   */
  const openConvertPopup = async (request: Rem2TexConvertRequest): Promise<void> => {
    await plugin.storage.setSession(REM2TEX_CONVERT_REQUEST_KEY, request);
    await plugin.widget.openPopup(REM2TEX_CONVERT_WIDGET);
  };

  const runConvert = async (kind: Rem2TexConvertKind, alwaysShowUi: boolean): Promise<void> => {
    try {
      const selectedRemIds = kind === 'selection' ? await getSelectedRemIds(plugin) : undefined;
      if (alwaysShowUi) {
        await openConvertPopup({ kind, selectedRemIds });
        return;
      }
      const preview = await previewRem2TexConvert(plugin, { kind, selectedRemIds });
      if (preview.pinRows.length > 0 || preview.issues.length > 0) {
        await openConvertPopup({ kind, selectedRemIds });
        return;
      }
      // Nothing to convert and nothing wrong: just do it.
      const result = await runRem2TexConvert(plugin, { kind, selectedRemIds });
      if (result.status === 'failed') {
        // Only reachable if a kind that reports instead of throwing ever takes this path.
        await plugin.app.toast(
          `Rem2Tex failed: ${result.errorHeadline ?? 'the conversion did not finish'}. ` +
            `See the Log under “${result.outputTitle}”.`
        );
        return;
      }
      const extra =
        kind === 'selection' && result.citationCount !== undefined
          ? ` with ${result.citationCount} reference(s)${result.missingMetadataCount ? ` — ${result.missingMetadataCount} without Zotero metadata` : ''}`
          : '';
      await plugin.app.toast(`Rem2Tex: exported “${result.outputTitle}”${extra}.`);
    } catch (error) {
      await plugin.app.toast(`Rem2Tex: ${failureMessage(error)}`);
    }
  };

  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper',
    name: 'Rem2Tex: Convert Paper to TeX',
    description:
      'Convert a Paper rem tree into LaTeX. Opens a preview where you choose how todos are handled and which Zotero pins become citekeys.',
    quickCode: 'rem2tex',
    action: async () => runConvert('paper', true),
  });

  await plugin.app.registerCommand({
    id: 'rem2tex-paragraph-to-tex',
    name: 'Rem2Tex: Convert Paragraph to TeX',
    description:
      'Convert the focused rem and its descendants to LaTeX, as a child export. Opens a preview only when there are pins to convert or something to flag.',
    quickCode: 'rem2tex-paragraph',
    action: async () => runConvert('paragraph', false),
  });

  await plugin.app.registerCommand({
    id: 'rem2tex-selection-to-tex',
    name: 'Rem2Tex: Convert Selection to TeX (Numbered Citations + Bibliography)',
    description:
      'Convert the selected rem(s) to LaTeX with `[1]`-style citations and a numbered bibliography. Opens a preview only when there are pins to convert or something to flag.',
    quickCode: 'rem2tex-selection',
    action: async () => runConvert('selection', false),
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
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
