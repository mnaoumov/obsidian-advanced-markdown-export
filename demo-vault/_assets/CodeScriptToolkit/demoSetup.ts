import type { App } from 'obsidian';

import { Notice } from 'obsidian';

const PLUGIN_ID = 'advanced-markdown-export';
const EXAMPLE_NOTE_PATH = 'Example/A.md';

/**
 * Runs one of the plugin's sample commands.
 *
 * A command a note names is a command that note can run, so the reader never has to go hunting in the
 * Command Palette for the thing the paragraph just described.
 *
 * Manual equivalent: the Command Palette entry of the same name.
 */
export function runCommand(app: App, commandId: string): void {
  const fullCommandId = `${PLUGIN_ID}:${commandId}`;
  if (!app.commands.commands[fullCommandId]) {
    new Notice(`Command ${fullCommandId} is not registered — is the plugin enabled?`);
    return;
  }

  app.commands.executeCommandById(fullCommandId);
}

/**
 * Opens the export dialog on the example note, which is the one thing in this plugin that cannot be
 * shown by reading a file: the tree, its defaults and its running total only exist on screen.
 *
 * Manual equivalent: right-click `Example/A.md` in the file explorer and choose
 * `Export with dependencies`.
 */
export async function openExportDialogForExampleNote(app: App): Promise<void> {
  const note = app.vault.getFileByPath(EXAMPLE_NOTE_PATH);

  if (!note) {
    new Notice(`${EXAMPLE_NOTE_PATH} is missing from this vault.`);
    return;
  }

  await app.workspace.getLeaf(false).openFile(note);
  runCommand(app, 'export-active-file');
}
