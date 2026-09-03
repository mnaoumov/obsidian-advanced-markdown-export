/**
 * @file
 *
 * Desktop integration suite for the export itself, against a live Obsidian.
 *
 * The unit tests stop at the two points where the flow waits for a human - the tree modal and the system
 * directory picker - and mock them. This suite mocks only the second: the OS-native directory dialog
 * cannot be automated, so `showOpenDialog` is shadowed to answer with a folder inside the temporary
 * vault, and everything else runs for real. The modal is opened from the file-explorer context menu, its
 * checkboxes are ticked through the DOM, and the bundle is then read back off disk through the vault
 * adapter.
 *
 * That makes this the test that the pieces fit together: the menu produces a forest, the forest drives
 * the tree, the tree drives the writer, the writer preserves vault-relative structure, and a link between
 * two exported notes still resolves in the bundle.
 *
 * Desktop-only: the directory picker exists only there, and the in-vault destination mobile uses is
 * covered by the unit tests.
 */

import type { MenuItem } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const MENU_ITEM_TITLE = 'Export with dependencies';
const COMMAND_ID = 'advanced-markdown-export:export-active-file';
const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;
const WAIT_TIMEOUT_IN_MILLISECONDS = 20_000;

/**
 * What the shadowed directory dialog answers with. Declared here rather than imported from
 * `obsidian-typings` so the callback stays self-contained when it is serialized into Obsidian.
 */
interface DirectoryDialogResult {
  readonly canceled: boolean;
  readonly filePaths: string[];
}

interface EntryPointsResult {
  readonly commandRegistered: boolean;
  readonly fileMenuTitles: string[];
  readonly filesMenuTitles: string[];
  readonly folderMenuTitles: string[];
}

interface ExportResult {
  readonly exportedNoteContent: string;
  readonly exportedPaths: string[];
  readonly rowPaths: string[];
}

describe('Export flow', () => {
  it('should offer the export from all three menu entry points and register the command', async () => {
    const result = await runEntryPointsScenario();

    expect(result.commandRegistered).toBe(true);
    expect(result.fileMenuTitles).toContain(MENU_ITEM_TITLE);
    expect(result.folderMenuTitles).toContain(MENU_ITEM_TITLE);
    expect(result.filesMenuTitles).toContain(MENU_ITEM_TITLE);
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('should write the ticked files to the chosen directory, structure and links intact', async () => {
    const result = await runExportScenario();

    /*
     * The defaults the whole plugin is built around: the root and its attachment arrive checked, the
     * linked note arrives unchecked and waiting to be asked for.
     */
    expect(result.rowPaths).toEqual(['Example/A.md', 'Example/Attachments/A1.png', 'Example/B.md']);

    // Vault-relative paths are preserved beneath the bundle, which is what keeps the links resolving.
    expect(result.exportedPaths).toEqual(['Example/A.md', 'Example/Attachments/A1.png', 'Example/B.md']);

    // Both targets are in the bundle, so neither link needed rewriting.
    expect(result.exportedNoteContent).toContain('![[Example/Attachments/A1.png]]');
    expect(result.exportedNoteContent).toContain('[[Example/B.md]]');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

async function runEntryPointsScenario(): Promise<EntryPointsResult> {
  return evalInObsidian({
    async callback({
      app,
      commandId,
      obsidianModule
    }): Promise<EntryPointsResult> {
      const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
      const folderPath = `export-flow-entry-${stamp}`;
      await app.vault.createFolder(folderPath);
      const noteA = await app.vault.create(`${folderPath}/A.md`, '# A\n');
      const noteB = await app.vault.create(`${folderPath}/B.md`, '# B\n');
      const folder = app.vault.getFolderByPath(folderPath);

      function menuItemTitles(trigger: (menu: InstanceType<typeof obsidianModule.Menu>) => void): string[] {
        const menu = new obsidianModule.Menu();
        trigger(menu);
        return menu.items
          .filter((item): item is MenuItem => 'titleEl' in item)
          .map((item) => item.titleEl.textContent);
      }

      const fileMenuTitles = menuItemTitles((menu) => {
        app.workspace.trigger('file-menu', menu, noteA, 'file-explorer-context-menu');
      });
      const folderMenuTitles = folder
        ? menuItemTitles((menu) => {
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
        })
        : [];
      const filesMenuTitles = menuItemTitles((menu) => {
        app.workspace.trigger('files-menu', menu, [noteA, noteB], 'file-explorer-context-menu');
      });

      if (folder) {
        await app.fileManager.trashFile(folder);
      }

      return {
        commandRegistered: Object.keys(app.commands.commands).includes(commandId),
        fileMenuTitles,
        filesMenuTitles,
        folderMenuTitles
      };
    },
    input: { commandId: COMMAND_ID },
    vaultPath: getTemporaryVault().path
  });
}

async function runExportScenario(): Promise<ExportResult> {
  const vaultPath = getTemporaryVault().path;

  return evalInObsidian({
    async callback({
      app,
      lib: { waitUntil },
      menuItemTitle,
      obsidianModule,
      timeoutInMilliseconds,
      vaultDirectoryPath
    }): Promise<ExportResult> {
      const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
      const exportFolderName = `export-flow-bundle-${stamp}`;

      /*
       * The picker is pointed inside the vault purely so the bundle can be read back through the vault
       * adapter. The module under test neither knows nor cares that the directory is the vault's - it
       * writes through `node:fs` either way.
       */
      const dialog = window.electron.remote.dialog;
      const originalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
      dialog.showOpenDialog = (): Promise<DirectoryDialogResult> =>
        Promise.resolve({
          canceled: false,
          filePaths: [`${vaultDirectoryPath}/${exportFolderName}`]
        });

      try {
        await app.vault.createFolder('Example');
        await app.vault.createFolder('Example/Attachments');
        await app.vault.createBinary('Example/Attachments/A1.png', new Uint8Array([1, 2, 3, 4]).buffer);
        await app.vault.create('Example/B.md', '# B\n');
        const noteA = await app.vault.create(
          'Example/A.md',
          '# A\n\n![[Example/Attachments/A1.png]]\n\n[[Example/B.md]]\n'
        );

        await waitUntil({
          message: 'the metadata cache never picked up the fixture note',
          predicate: () => (app.metadataCache.getFileCache(noteA)?.embeds?.length ?? 0) > 0,
          timeoutInMilliseconds
        });

        const menu = new obsidianModule.Menu();
        app.workspace.trigger('file-menu', menu, noteA, 'file-explorer-context-menu');
        const menuItem = menu.items.find((item): item is MenuItem => 'titleEl' in item && item.titleEl.textContent === menuItemTitle);
        menuItem?.callback?.();

        await waitUntil({
          message: 'the export tree modal never opened',
          predicate: () => document.querySelector('.advanced-markdown-export-tree-modal') !== null,
          timeoutInMilliseconds
        });

        const modalEl = document.querySelector('.advanced-markdown-export-tree-modal');

        function getRowPaths(): string[] {
          return [...modalEl?.querySelectorAll('.advanced-markdown-export-path') ?? []].map((el) => el.textContent);
        }

        // A single root is expanded on the way in, so its dependencies are on screen before anything is ticked.
        await waitUntil({
          message: 'the root note never expanded',
          predicate: () => getRowPaths().length === 3,
          timeoutInMilliseconds
        });

        const rowPaths = getRowPaths();

        function getCheckbox(path: string): HTMLInputElement | null {
          const selfEl = [...modalEl?.querySelectorAll('.tree-item-self') ?? []]
            .find((candidate) => candidate.querySelector('.advanced-markdown-export-path')?.textContent === path);
          return selfEl?.querySelector<HTMLInputElement>('.advanced-markdown-export-checkbox') ?? null;
        }

        // Ticking the linked note is the expand-on-tick gesture: it is what puts `B.md` in the bundle.
        const noteBCheckbox = getCheckbox('Example/B.md');
        if (noteBCheckbox) {
          noteBCheckbox.checked = true;
          noteBCheckbox.dispatchEvent(new Event('change'));
        }

        const exportButton = [...modalEl?.querySelectorAll('button') ?? []]
          .find((button) => button.textContent === 'Export');
        exportButton?.click();

        const exportedNotePath = `${exportFolderName}/A/Example/A.md`;

        /*
         * The completion notice, not the first file to land. `exportBundle` writes the chosen files one
         * after another and the notice is shown only once it has resolved, so waiting on a single file
         * lets the listing below race the ones still being written. That is exactly how this test used to
         * lose `Example/B.md` - the last file of the three - on roughly one run in six.
         */
        await waitUntil({
          message: 'the export never reported that it had finished',
          predicate: () => [...document.querySelectorAll('.notice')].some((noticeEl) => noticeEl.textContent.includes('Exported ')),
          timeoutInMilliseconds
        });

        const exportedPaths: string[] = [];

        async function collectExported(relativePath: string): Promise<void> {
          const listing = await app.vault.adapter.list(`${exportFolderName}/A/${relativePath}`);
          for (const filePath of listing.files) {
            exportedPaths.push(filePath.slice(`${exportFolderName}/A/`.length));
          }
          for (const folderPath of listing.folders) {
            await collectExported(folderPath.slice(`${exportFolderName}/A/`.length));
          }
        }

        await collectExported('');
        exportedPaths.sort((left, right) => left.localeCompare(right));

        return {
          exportedNoteContent: await app.vault.adapter.read(exportedNotePath),
          exportedPaths,
          rowPaths
        };
      } finally {
        dialog.showOpenDialog = originalShowOpenDialog;

        for (const path of ['Example', exportFolderName]) {
          if (await app.vault.adapter.exists(path)) {
            await app.vault.adapter.rmdir(path, true);
          }
        }
      }
    },
    input: {
      menuItemTitle: MENU_ITEM_TITLE,
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      vaultDirectoryPath: vaultPath
    },
    vaultPath
  });
}
