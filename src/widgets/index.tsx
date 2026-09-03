import { declareIndexPlugin, type ReactRNPlugin } from '@remnote/plugin-sdk';
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
  toggleIgnoreTag,
} from '../lib/rem2tex';

/** Toast text for anything thrown by a conversion (typed errors carry a human sentence). */
function failureMessage(error: unknown): string {
  if (isRem2TexConversionError(error)) {
    const where = error.sourceRemTitle ? ` (at rem “${error.sourceRemTitle}”)` : '';
    return `${error.headline}. ${error.whatHappened}${where}`;
  }
  return normalizeUnknownError(error);
}

async function onActivate(plugin: ReactRNPlugin) {
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
