import { declareIndexPlugin, type ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import '../index.css'; // import <widget-name>.css
import { normalizeUnknownError, runRem2TexConversion } from '../lib/rem2tex';

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

  // Convert the focused Paper Rem tree into a TeX code block child.
  await plugin.app.registerCommand({
    id: 'rem2tex-convert-paper',
    name: 'Rem2Tex: Convert Paper to TeX',
    description:
      'Convert a Paper rem tree into LaTeX using Preamble/End and heading-formatted sections.',
    quickCode: 'rem2tex',
    action: async () => {
      try {
        const outputRem = await runRem2TexConversion(plugin);
        await plugin.app.toast(`Rem2Tex complete: ${outputRem}`);
      } catch (error) {
        const message = normalizeUnknownError(error);
        await plugin.app.toast(`Rem2Tex failed: ${message}`);
      }
    },
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
