/**
 * @file
 *
 * Mobile integration suite for the export itself, driven in Obsidian Mobile on a real Android emulator.
 *
 * It exists because of a defect that shipped in 1.0.0 and that no other suite could see: on a phone the
 * export did nothing at all. `mobile-export-destination.ts` statically imports the ZIP target, the ZIP
 * target imported bare `fflate`, and `fflate`'s `exports` map answers a `node` condition first - so the
 * bundle carried fflate's Node build, whose module body calls `createRequire` at load. The mobile chain
 * therefore threw the moment `createExportDestination` reached for it, `invokeAsyncSafely` swallowed the
 * rejection, and the dialog just closed with no destination prompt, no notice and no bundle.
 *
 * How the three existing suites all missed it is what this file is shaped around. The unit tests mock
 * `prompt`, so the real import chain never loads. The desktop suite takes the other branch. And the
 * Android smoke test only asserts that the plugin LOADS - which it always did, because the throw is in a
 * module imported lazily, on demand, at the moment of export. The gap was precisely that nothing
 * exercised the mobile export PATH on a mobile device.
 *
 * Both destinations are covered, because the fix was a change of which fflate build ships and only the
 * archive path actually calls into it: the folder case proves the chain LOADS, and the ZIP case proves
 * `zipSync` RUNS there. A green folder case over a compressor that throws is exactly the shape this suite
 * is here to refuse.
 *
 * Split across several short `evalInObsidian` / `pollInObsidian` calls because one call is one
 * `execute/sync`, which WebDriver caps at 30 seconds. So every wait happens in NODE, where no cap
 * applies: `pollInObsidian` kicks the work off in a short `start` closure, then polls a short `poll`
 * closure until the Node-side predicate accepts.
 *
 * Buttons are pressed through the harness's trusted `clickElement`. The one dispatched event is
 * `new Event('input')` after setting the prompt's `.value`, which tells the app about a change rather
 * than pretending to be a user - the shape `no-untrusted-input-events` exempts, as it does every
 * `*.android.integration.test.ts` by name, Android having no `window.electron` to reach through.
 */

import type { MenuItem } from 'obsidian';

import { unzipSync } from 'fflate';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

/**
 * A bundle written as a folder, as a test reads it back.
 */
interface BundleFolder {
  readonly noteContent: string;
  readonly paths: readonly string[];
}

/**
 * The two settings this suite writes, as the editor closure sees them.
 */
interface EditableSettings {
  outputFolderPath: string;
  shouldCreateZip: boolean;
}

/**
 * The settings component reduced to its one write path.
 */
interface EditableSettingsComponent {
  editAndSave: (this: void, settingsEditor: (settings: EditableSettings) => void) => Promise<void>;
}

/**
 * The plugin reduced to the settings seam a test needs.
 *
 * `PluginBase.pluginSettingsComponent` is `protected` and there is no public setter for one setting, so
 * the cases reach the settings through this narrow view. The alternative - driving the settings tab on the
 * device to tick a checkbox - would test Obsidian's settings UI rather than the export.
 */
interface SettingsEditablePlugin {
  pluginSettingsComponent: EditableSettingsComponent;
}

const MENU_ITEM_TITLE = 'Export with dependencies';
const PLUGIN_ID = 'advanced-markdown-export';

const TREE_MODAL_SELECTOR = '.advanced-markdown-export-tree-modal';
const TREE_PATH_SELECTOR = '.advanced-markdown-export-path';

/**
 * The destination prompt is `obsidian-dev-utils`' shared one, so its own class is generic; the plugin id
 * is on the same element because the library scopes every modal it opens to the plugin that opened it.
 */
const PROMPT_MODAL_SELECTOR = `.prompt-modal.${PLUGIN_ID}`;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const EXAMPLE_DIRECTORY = join(process.cwd(), 'demo-vault', 'Example');
const ATTACHMENTS_DIRECTORY = join(EXAMPLE_DIRECTORY, 'Attachments');

const NOTE_A_PATH = 'Example/A.md';
const NOTE_B_PATH = 'Example/B.md';
const ATTACHMENT_A1_PATH = 'Example/Attachments/A1.png';
const ATTACHMENT_A2_PATH = 'Example/Attachments/A2.png';

/**
 * What a default export of `A` carries: the root note and its two embedded attachments, in the order the
 * tree owns them. The linked note `B` arrives unticked, which is what leaves the exported `A.md` holding
 * a link that points out of the bundle.
 */
const EXPECTED_BUNDLE_PATHS = [NOTE_A_PATH, ATTACHMENT_A1_PATH, ATTACHMENT_A2_PATH];

beforeAll(async () => {
  const vault = getTemporaryVault();

  /*
   * The demo vault's own worked example, read off disk rather than retyped - the same fixture the mobile
   * capture suite stages, for the same reason: the notes and the documentation cannot drift apart while
   * there is only one copy of them.
   */
  vault.populate({
    [ATTACHMENT_A1_PATH]: readFileSync(join(ATTACHMENTS_DIRECTORY, 'A1.png')),
    [ATTACHMENT_A2_PATH]: readFileSync(join(ATTACHMENTS_DIRECTORY, 'A2.png')),
    [NOTE_A_PATH]: readFileSync(join(EXAMPLE_DIRECTORY, 'A.md'), 'utf-8'),
    [NOTE_B_PATH]: readFileSync(join(EXAMPLE_DIRECTORY, 'B.md'), 'utf-8')
  });
  await vault.syncToDevice();

  await pollInObsidian({
    input: { noteAPath: NOTE_A_PATH },
    poll({ app, noteAPath }): boolean {
      const noteA = app.vault.getFileByPath(noteAPath);
      if (!noteA) {
        return false;
      }

      const cache = app.metadataCache.getFileCache(noteA);
      return (cache?.embeds?.length ?? 0) > 0 && (cache?.links?.length ?? 0) > 0;
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the fixture graph never reached the metadata cache',
    until: (isCached: boolean): boolean => isCached,
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('Export flow on Android', () => {
  it('should ask where the bundle goes and write it into the vault', async () => {
    const bundleFolderPath = `export-mobile-${stamp()}`;

    try {
      await setSettings({ outputFolderPath: '', shouldCreateZip: false });
      await openExportTree();
      await pressExport();
      await waitForPrompt();
      await answerPrompt(bundleFolderPath);

      expect(await waitForExportDestination()).toBe(bundleFolderPath);

      const bundle = await readBundleFolder(bundleFolderPath);
      expect(bundle.paths).toStrictEqual(sorted(EXPECTED_BUNDLE_PATHS));

      /*
       * Both embeds resolve inside the bundle, so they are left verbatim. `B` was never ticked, and the
       * default dangling-link policy keeps a link pointing out of the bundle exactly as it was written.
       */
      expect(bundle.noteContent).toContain('![[Attachments/A1.png]]');
      expect(bundle.noteContent).toContain('[[B]]');
    } finally {
      await removeFromVault([bundleFolderPath]);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('should write a single archive into the vault when ZIP is on', async () => {
    const bundleName = `export-mobile-zip-${stamp()}`;
    const archivePath = `${bundleName}.zip`;

    try {
      await setSettings({ outputFolderPath: '', shouldCreateZip: true });
      await openExportTree();
      await pressExport();
      await waitForPrompt();
      await answerPrompt(bundleName);

      expect(await waitForExportDestination()).toBe(archivePath);

      /*
       * Read the archive back and unzip it in NODE. This is the assertion that proves `zipSync` really
       * ran on the device: the folder case above stays green against a compressor that throws, because it
       * never reaches one.
       */
      const archive = unzipSync(await readVaultBinary(archivePath));
      expect(sorted(Object.keys(archive))).toStrictEqual(sorted(EXPECTED_BUNDLE_PATHS));
    } finally {
      await setSettings({ outputFolderPath: '', shouldCreateZip: false });
      await removeFromVault([archivePath]);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  /*
   * The second, independent way the mobile export could do nothing at all. The two cases above answer the
   * destination prompt with a ROOT-LEVEL name, deliberately, so the archive's parent is the vault root and
   * always exists - which is why they exercise the compressor rather than this. Point **Output folder** at
   * a folder the vault has not got, and before the fix `Vault.createBinary` rejected on the missing
   * parent, `invokeAsyncSafely` ate the rejection, and the tree closed with no notice and no error: the
   * exact symptom of the fflate defect, from a different cause.
   *
   * It has to run here rather than in the unit suite: `obsidian-test-mocks`' `Vault.createBinary` writes
   * straight through its adapter with no parent check, so the rejection only happens on a device.
   */
  it('should create a configured output folder the vault has not got', async () => {
    const outputFolderPath = `export-mobile-missing-${stamp()}`;
    const bundleName = 'A';
    const archivePath = `${outputFolderPath}/${bundleName}.zip`;

    try {
      await setSettings({ outputFolderPath, shouldCreateZip: true });
      await openExportTree();
      await pressExport();

      /*
       * No prompt this time - a configured output folder is the branch that does not ask - so the notice
       * is the first thing to wait for, and its timing out IS this regression.
       */
      expect(await waitForExportDestination()).toBe(archivePath);

      const archive = unzipSync(await readVaultBinary(archivePath));
      expect(sorted(Object.keys(archive))).toStrictEqual(sorted(EXPECTED_BUNDLE_PATHS));
    } finally {
      await setSettings({ outputFolderPath: '', shouldCreateZip: false });
      await removeFromVault([outputFolderPath]);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Types a destination into the open prompt and accepts it.
 *
 * @param destinationPath - The vault-relative folder to export into.
 */
async function answerPrompt(destinationPath: string): Promise<void> {
  await pollInObsidian({
    input: { destinationPath, promptModalSelector: PROMPT_MODAL_SELECTOR },
    poll({ promptModalSelector }): boolean {
      return document.querySelector(promptModalSelector) === null;
    },
    async start({ destinationPath: path, lib: { clickElement }, promptModalSelector }): Promise<void> {
      const modalEl = document.querySelector(promptModalSelector);
      if (!modalEl) {
        throw new Error('The destination prompt is not open.');
      }

      const inputEl = modalEl.querySelector<HTMLInputElement>('input');
      if (!inputEl) {
        throw new Error('The destination prompt has no text box.');
      }

      /*
       * The modal tracks its value through the text component's own change handler, so setting `.value`
       * alone would be accepted as the untouched default. The notification is what it listens for.
       */
      inputEl.value = path;
      inputEl.dispatchEvent(new Event('input'));

      const okButtonEl = modalEl.querySelector<HTMLElement>('.ok-button');
      if (!okButtonEl) {
        throw new Error('The destination prompt has no OK button.');
      }

      await clickElement({ element: okButtonEl });
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the destination prompt never closed after OK',
    until: (isClosed: boolean): boolean => isClosed,
    vaultPath: vaultPath()
  });
}

/**
 * Dismisses any completion notice an earlier case left on screen, and waits for the last of them to go.
 *
 * `waitForExportDestination` reads the FIRST `Exported ` notice it finds, so a notice still up from the
 * previous case is read as this case's answer - which is a stale destination path, and the wrong failure
 * to have to diagnose. Clearing them is cheaper and surer than assuming Obsidian's auto-hide has run,
 * which is a race whose length depends on how fast the round trips before it happened to be.
 */
async function dismissNotices(): Promise<void> {
  await pollInObsidian({
    poll(): number {
      return document.querySelectorAll('.notice').length;
    },
    async start({ lib: { clickElement } }): Promise<void> {
      // A notice hides itself when clicked, which is the only dismissal an Obsidian notice offers.
      for (const noticeEl of document.querySelectorAll<HTMLElement>('.notice')) {
        await clickElement({ element: noticeEl });
      }
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'a notice left on screen by an earlier case never went away',
    until: (noticeCount: number): boolean => noticeCount === 0,
    vaultPath: vaultPath()
  });
}

/**
 * Opens the export tree on the fixture note from the file-explorer context menu, and waits for its rows.
 *
 * Anything left on screen by an earlier case is dismissed on the way in - a modal here, a notice in
 * `dismissNotices` - so one case cannot strand the next behind a dialog it knows nothing about, nor hand
 * it an answer that belongs to the case before.
 */
async function openExportTree(): Promise<void> {
  await pollInObsidian({
    poll(): number {
      return document.querySelectorAll('.modal-container').length;
    },
    async start({ lib: { pressKey } }): Promise<void> {
      await pressKey({ key: 'Escape' });
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'a modal was left open by an earlier case',
    until: (modalCount: number): boolean => modalCount === 0,
    vaultPath: vaultPath()
  });

  await dismissNotices();

  await pollInObsidian({
    input: {
      menuItemTitle: MENU_ITEM_TITLE,
      rootPath: NOTE_A_PATH,
      treeModalSelector: TREE_MODAL_SELECTOR,
      treePathSelector: TREE_PATH_SELECTOR
    },
    poll({ treeModalSelector, treePathSelector }): number {
      return document.querySelector(treeModalSelector)?.querySelectorAll(treePathSelector).length ?? 0;
    },
    start({ app, menuItemTitle, obsidianModule, rootPath }): void {
      const root = app.vault.getAbstractFileByPath(rootPath);
      if (!root) {
        throw new Error(`The vault has no ${rootPath}.`);
      }

      const menu = new obsidianModule.Menu();
      app.workspace.trigger('file-menu', menu, root, 'file-explorer-context-menu');
      const menuItem = menu.items.find((item): item is MenuItem => 'titleEl' in item && item.titleEl.textContent === menuItemTitle);
      if (!menuItem) {
        throw new Error(`The context menu on ${rootPath} does not offer ${menuItemTitle}.`);
      }

      menuItem.callback?.();
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the export tree never drew its rows',
    until: (rowCount: number): boolean => rowCount > 0,
    vaultPath: vaultPath()
  });
}

/**
 * Accepts the open export tree with its default ticks, and waits for it to close.
 */
async function pressExport(): Promise<void> {
  await pollInObsidian({
    input: { treeModalSelector: TREE_MODAL_SELECTOR },
    poll({ treeModalSelector }): boolean {
      return document.querySelector(treeModalSelector) === null;
    },
    async start({ lib: { clickElement }, treeModalSelector }): Promise<void> {
      const modalEl = document.querySelector(treeModalSelector);
      if (!modalEl) {
        throw new Error('No export tree modal is open.');
      }

      const exportButtonEl = [...modalEl.querySelectorAll('button')].find((button) => button.textContent === 'Export');
      if (!exportButtonEl) {
        throw new Error('The export tree has no Export button.');
      }

      await clickElement({ element: exportButtonEl });
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the export tree never closed after Export',
    until: (isClosed: boolean): boolean => isClosed,
    vaultPath: vaultPath()
  });
}

/**
 * Reads a bundle that was written as a folder inside the vault.
 *
 * @param bundleFolderPath - The bundle's own folder, vault-relative.
 * @returns The paths it holds relative to that folder, sorted, plus the exported note's content.
 */
async function readBundleFolder(bundleFolderPath: string): Promise<BundleFolder> {
  const bundle = await evalInObsidian({
    async callback({ app, bundleFolderPath: bundlePath, noteAPath }): Promise<BundleFolder> {
      const paths: string[] = [];

      async function collect(relativePath: string): Promise<void> {
        const listing = await app.vault.adapter.list(`${bundlePath}/${relativePath}`);
        for (const filePath of listing.files) {
          paths.push(filePath.slice(`${bundlePath}/`.length));
        }

        for (const folderPath of listing.folders) {
          await collect(folderPath.slice(`${bundlePath}/`.length));
        }
      }

      await collect('');

      return {
        noteContent: await app.vault.adapter.read(`${bundlePath}/${noteAPath}`),
        paths
      };
    },
    input: { bundleFolderPath, noteAPath: NOTE_A_PATH },
    vaultPath: vaultPath()
  });

  return {
    noteContent: bundle.noteContent,
    paths: sorted(bundle.paths)
  };
}

/**
 * Reads a binary file out of the vault on the device.
 *
 * Carried across the transport as base64 because `evalInObsidian` answers in JSON, which has no way to
 * hold an `ArrayBuffer`. Fine for an archive of a few hundred bytes; not a way to move a large file.
 *
 * @param path - The file's vault-relative path.
 * @returns Its bytes.
 */
async function readVaultBinary(path: string): Promise<Uint8Array> {
  const base64 = await evalInObsidian({
    async callback({ app, filePath }): Promise<string> {
      const file = app.vault.getFileByPath(filePath);
      if (!file) {
        throw new Error(`The vault has no ${filePath}.`);
      }

      const bytes = new Uint8Array(await app.vault.readBinary(file));
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCodePoint(byte);
      }

      return btoa(binary);
    },
    input: { filePath: path },
    vaultPath: vaultPath()
  });

  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Deletes what a case wrote, so the next run starts from the same vault.
 *
 * A path may name either a bundle folder or a single archive, so the entry's own kind decides which
 * removal it takes; a path that is already gone is skipped.
 *
 * @param paths - The vault-relative paths to remove.
 */
async function removeFromVault(paths: string[]): Promise<void> {
  await evalInObsidian({
    async callback({ app, paths: pathsToRemove }): Promise<void> {
      for (const path of pathsToRemove) {
        const stat = await app.vault.adapter.stat(path);
        if (!stat) {
          continue;
        }

        if (stat.type === 'folder') {
          await app.vault.adapter.rmdir(path, true);
        } else {
          await app.vault.adapter.remove(path);
        }
      }
    },
    input: { paths },
    vaultPath: vaultPath()
  });
}

/**
 * Writes the two settings a case needs, through the plugin's own save path.
 *
 * @param settings - The values to write.
 */
async function setSettings(settings: EditableSettings): Promise<void> {
  await evalInObsidian({
    async callback({ app, pluginId, settings: newSettings }): Promise<void> {
      const plugin: unknown = app.plugins.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`The ${pluginId} plugin is not loaded.`);
      }

      await (plugin as SettingsEditablePlugin).pluginSettingsComponent.editAndSave((currentSettings) => {
        currentSettings.outputFolderPath = newSettings.outputFolderPath;
        currentSettings.shouldCreateZip = newSettings.shouldCreateZip;
      });
    },
    input: { pluginId: PLUGIN_ID, settings },
    vaultPath: vaultPath()
  });
}

/**
 * Sorts paths into a stable order, so an assertion never depends on a directory listing's.
 *
 * @param paths - The paths to sort.
 * @returns A sorted copy.
 */
function sorted(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

/**
 * A run-unique suffix, so a case leaves behind no name the next run can collide with.
 *
 * @returns The suffix.
 */
function stamp(): string {
  return `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
}

/**
 * The vault the harness staged for this run.
 *
 * @returns Its absolute path.
 */
function vaultPath(): string {
  return getTemporaryVault().path;
}

/**
 * Waits for the export's completion notice and reads back where it says the bundle landed.
 *
 * The notice, never the first file to appear: `exportBundle` writes the chosen files one after another
 * and the notice is shown only once that has resolved, so anything reading the bundle earlier races the
 * files still being written - the flake the desktop suite documents.
 *
 * @returns The destination the notice names.
 */
async function waitForExportDestination(): Promise<string> {
  const noticeText = await pollInObsidian({
    poll(): string {
      const noticeEl = [...document.querySelectorAll('.notice')]
        .find((candidate) => candidate.textContent.includes('Exported '));
      return noticeEl?.textContent ?? '';
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the export never reported that it had finished',
    until: (text: string): boolean => text !== '',
    vaultPath: vaultPath()
  });

  // The last ` to ` rather than the first, so a destination containing those four characters survives.
  const separator = ' to ';
  return noticeText.slice(noticeText.lastIndexOf(separator) + separator.length);
}

/**
 * Waits for the destination prompt to open.
 *
 * This is the assertion the whole suite was written for. Before the fflate fix nothing happened here at
 * all: the tree closed, the mobile chain threw as its module body loaded, `invokeAsyncSafely` ate the
 * rejection, and no prompt ever opened - so this timing out IS that regression, and the message says so.
 */
async function waitForPrompt(): Promise<void> {
  await pollInObsidian({
    input: { promptModalSelector: PROMPT_MODAL_SELECTOR },
    poll({ promptModalSelector }): boolean {
      return document.querySelector(promptModalSelector) !== null;
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the destination prompt never opened - the mobile export chain threw before reaching it',
    until: (isOpen: boolean): boolean => isOpen,
    vaultPath: vaultPath()
  });
}
