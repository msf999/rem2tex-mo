import {
  declareIndexPlugin,
  type ReactRNPlugin,
  type Rem,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import '../style.css';
import '../index.css'; // import <widget-name>.css
import {
  buildCompletedProgressLines,
  buildProgressErrorState,
  getFocusedParentRem,
  getRemTitle,
  type Rem2TexTodoExportMode,
  tryReadPreambleTitleAuthor,
  type Rem2TexConversionContext,
  type Rem2TexProgressUiState,
  REM2TEX_PROGRESS_STORAGE_KEY,
  REM2TEX_PROGRESS_TOTAL,
  runRem2TexConversion,
} from '../lib/rem2tex';

/**
 * Large fixed dimensions match Incremental Everything’s batch priority popup pattern
 * (hugomarins/incremental-everything `register/widgets.ts`: 1200×1150).
 */
const REM2TEX_PROGRESS_POPUP_PX = { width: 1040, height: 760 } as const;

/** Close any open plugin popup, then show the progress widget in the modal popup. */
async function openOrReplaceRem2TexProgressPopup(plugin: ReactRNPlugin): Promise<void> {
  try {
    await plugin.widget.closePopup();
  } catch {
    /* no popup open */
  }
  await plugin.widget.openPopup('rem2tex_progress');
}

async function onActivate(plugin: ReactRNPlugin) {
  // Register settings
  await plugin.settings.registerStringSetting({
    id: 'name',
    title: 'What is your Name?',
    defaultValue: 'Bob',
  });

  await plugin.settings.registerBooleanSetting({
    id: 'pizza',
    title: 'Do you like pizza?',
    defaultValue: true,
  });

  await plugin.settings.registerNumberSetting({
    id: 'favorite-number',
    title: 'What is your favorite number?',
    defaultValue: 42,
  });

  await plugin.app.registerWidget('rem2tex_progress', WidgetLocation.Popup, {
    dimensions: {
      width: REM2TEX_PROGRESS_POPUP_PX.width,
      height: REM2TEX_PROGRESS_POPUP_PX.height,
    },
  });

  const runExportWithTodoMode = async (
    todoExportMode: Rem2TexTodoExportMode
  ): Promise<void> => {
      let parentRem: Rem;
      let paperRemTitle: string | undefined;
      try {
        parentRem = await getFocusedParentRem(plugin);
        const descendants = await parentRem.getDescendants();
        const ctx: Rem2TexConversionContext = {
          hierarchyRemIds: new Set([parentRem._id, ...descendants.map((r) => r._id)]),
        };
        paperRemTitle = (await getRemTitle(plugin, parentRem, ctx)) || undefined;
      } catch (error) {
        await plugin.storage.setSession(
          REM2TEX_PROGRESS_STORAGE_KEY,
          buildProgressErrorState(error)
        );
        await openOrReplaceRem2TexProgressPopup(plugin);
        return;
      }

      try {
        const startedAtIso = new Date().toISOString();
        const preambleMeta = await tryReadPreambleTitleAuthor(plugin, parentRem);
        const preambleTitle = preambleMeta?.title ?? '';
        const preambleAuthor = preambleMeta?.author ?? '';

        await plugin.storage.setSession(REM2TEX_PROGRESS_STORAGE_KEY, {
          phase: 'running',
          step: 0,
          total: REM2TEX_PROGRESS_TOTAL,
          label: 'Starting…',
          paperRemTitle,
          startedAtIso,
          preambleTitle,
          preambleAuthor,
              todoExportMode,
          progressLog: [],
        });
        await openOrReplaceRem2TexProgressPopup(plugin);

        const outputTitle = await runRem2TexConversion(plugin, {
          parentRem,
          todoExportMode,
          onProgress: async (step, total, label) => {
            await plugin.storage.setSession(REM2TEX_PROGRESS_STORAGE_KEY, {
              phase: 'running',
              step,
              total,
              label,
              paperRemTitle,
              startedAtIso,
              preambleTitle,
              preambleAuthor,
              todoExportMode,
              progressLog: buildCompletedProgressLines(step),
            });
          },
        });

        await plugin.storage.setSession(REM2TEX_PROGRESS_STORAGE_KEY, {
          phase: 'success',
          outputTitle,
          paperRemTitle,
          preambleTitle,
          preambleAuthor,
          todoExportMode,
          progressLog: buildCompletedProgressLines(REM2TEX_PROGRESS_TOTAL + 1),
        });
      } catch (error) {
        const prev = await plugin.storage.getSession<Rem2TexProgressUiState>(REM2TEX_PROGRESS_STORAGE_KEY);
        const running = prev?.phase === 'running' ? prev : undefined;
        await plugin.storage.setSession(
          REM2TEX_PROGRESS_STORAGE_KEY,
          buildProgressErrorState(error, {
            paperRemTitle,
            preambleTitle: running?.preambleTitle,
            preambleAuthor: running?.preambleAuthor,
            todoExportMode: running?.todoExportMode,
            progressLog: running?.progressLog,
            failedAtLabel: running?.label,
          })
        );
      }
  };

  // Convert the focused Paper rem tree into LaTeX and copy all todos as comments.
  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper',
    name: 'Rem2Tex: Convert Paper to TeX (Copy All Todos as Comments)',
    description:
      'Convert a Paper rem tree into LaTeX using Preamble/End and heading-formatted sections; copy all todos as `% TODO ...` comments.',
    quickCode: 'rem2tex',
    action: async () => runExportWithTodoMode('all'),
  });

  // Convert and copy only unfinished todos as comments.
  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper-unfinished-todos',
    name: 'Rem2Tex: Convert Paper to TeX (Copy Unfinished Todos as Comments)',
    description:
      'Convert a Paper rem tree into LaTeX and copy only unfinished todos as `% TODO ...` comments.',
    quickCode: 'rem2tex-unfinished',
    action: async () => runExportWithTodoMode('unfinished'),
  });

  // Convert and do not copy todos as comments.
  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper-no-todos',
    name: 'Rem2Tex: Convert Paper to TeX (Do Not Copy Todos as Comments)',
    description: 'Convert a Paper rem tree into LaTeX and skip todo comment output.',
    quickCode: 'rem2tex-no-todos',
    action: async () => runExportWithTodoMode('none'),
  });

  // Show a toast notification to the user.
  await plugin.app.toast('Rem2Tex loaded. Type /rem2tex on a parent Rem to export.');

  // Register a sidebar widget.
  await plugin.app.registerWidget('sample_widget', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
  });
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
