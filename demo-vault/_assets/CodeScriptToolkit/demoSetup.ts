import type {
  App,
  MenuItem
} from 'obsidian';

import {
  Menu,
  Notice
} from 'obsidian';

const PLUGIN_ID = 'advanced-markdown-export';
const EXAMPLE_NOTE_PATH = 'Example/A.md';
const MENU_ITEM_TITLE = 'Export with dependencies';
const TREE_MODAL_SELECTOR = '.advanced-markdown-export-tree-modal';
const TREE_PATH_SELECTOR = '.advanced-markdown-export-path';
const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
const WAIT_POLL_IN_MILLISECONDS = 50;

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

/**
 * Opens the export dialog on any file or folder, exactly as its file-explorer context menu does — which
 * is the only way to start an export from a folder, since the command works on the active note.
 *
 * Manual equivalent: right-click the file or folder in the file explorer and choose
 * `Export with dependencies`.
 */
export async function openExportDialogFromContextMenu(app: App, path: string): Promise<HTMLElement> {
  const root = app.vault.getAbstractFileByPath(path);
  if (!root) {
    throw new Error(`${path} is missing from this vault.`);
  }

  const menu = new Menu();
  app.workspace.trigger('file-menu', menu, root, 'file-explorer-context-menu');
  const menuItem = menu.items.find((item): item is MenuItem => 'titleEl' in item && item.titleEl.textContent === MENU_ITEM_TITLE);
  if (!menuItem) {
    throw new Error(`The context menu on ${path} does not offer ${MENU_ITEM_TITLE} — is the plugin enabled?`);
  }

  // A dialog an earlier button left open would otherwise be the one this function goes on to read.
  const modalsBefore = new Set(document.querySelectorAll(TREE_MODAL_SELECTOR));
  menuItem.callback?.();

  return waitFor(
    () => [...document.querySelectorAll<HTMLElement>(TREE_MODAL_SELECTOR)].find((modalEl) => !modalsBefore.has(modalEl) && modalEl.querySelector(TREE_PATH_SELECTOR) !== null),
    'the export tree never opened'
  );
}

/**
 * Opens the export dialog on the example note and ticks the given linked notes in it, one after another,
 * so the tree grows the way the `Try it` walkthrough describes. Each tick waits for the note to expand
 * before the next one, because only an expanded note's own links are on screen to tick.
 *
 * Then checks that each path in `expectedRepeatPaths` shows up as a greyed-out repeat, and throws if one
 * does not: that disabled row is the whole point of the walkthrough, so a button that drew the tree
 * without it would be demonstrating something false.
 *
 * Manual equivalent: right-click `Example/A.md` in the file explorer, choose `Export with dependencies`,
 * then tick each note in turn.
 */
export async function openExampleTreeWithTickedNotes(
  app: App,
  notePaths: readonly string[],
  expectedRepeatPaths: readonly string[]
): Promise<void> {
  const modalEl = await openExportDialogFromContextMenu(app, EXAMPLE_NOTE_PATH);

  for (const notePath of notePaths) {
    const checkbox = findRow(modalEl, notePath, false)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) {
      throw new Error(`The export tree has no live row for ${notePath}.`);
    }

    const rowCountBefore = modalEl.querySelectorAll(TREE_PATH_SELECTOR).length;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await waitFor(
      () => modalEl.querySelectorAll(TREE_PATH_SELECTOR).length > rowCountBefore,
      `${notePath} never expanded after it was ticked`
    );
  }

  for (const repeatPath of expectedRepeatPaths) {
    const repeatCheckbox = findRow(modalEl, repeatPath, true)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!repeatCheckbox?.disabled || !repeatCheckbox.checked) {
      throw new Error(`The export tree does not show ${repeatPath} as a greyed-out, checked repeat.`);
    }
  }
}

function findRow(modalEl: HTMLElement, path: string, isRepeat: boolean): HTMLElement | undefined {
  return [...modalEl.querySelectorAll<HTMLElement>('.tree-item-self')].find((selfEl) =>
    selfEl.querySelector(TREE_PATH_SELECTOR)?.textContent === path
    && selfEl.hasClass('advanced-markdown-export-repeat') === isRepeat
  );
}

async function waitFor<T>(poll: () => false | null | T | undefined, timeoutMessage: string): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_IN_MILLISECONDS;
  while (Date.now() < deadline) {
    const value = poll();
    if (value !== undefined && value !== null && value !== false) {
      return value;
    }

    await sleep(WAIT_POLL_IN_MILLISECONDS);
  }

  throw new Error(`Timed out: ${timeoutMessage}.`);
}
