/**
 * @file
 *
 * The at-scale check for a folder root, against a live Obsidian.
 *
 * Lazy expansion is the requirement the whole selection model is shaped around: nothing below a root is
 * resolved until the user asks for it, because a folder root can hold thousands of notes. The unit
 * suite asserts that with a call counter around the resolver; this asserts the consequence a user can
 * see, which a call counter cannot fake - a folder of several hundred notes opens a tree holding
 * exactly those notes, with none of their dependencies walked, inside a time budget.
 *
 * The fixture notes all embed the SAME attachment, so an eager-expansion regression would announce
 * itself as extra rows rather than as a slow test that might just be a slow machine.
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
const NOTE_COUNT = 300;
const OPEN_BUDGET_IN_MILLISECONDS = 5000;
const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;
const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

interface ScaleResult {
  readonly openDurationInMilliseconds: number;
  readonly rowCount: number;
  readonly rowPathsOutsideFolder: string[];
}

describe('Folder root at scale', () => {
  it('should open a folder root of hundreds of notes without walking their dependencies', async () => {
    const result = await runScaleScenario();

    // One row per note, and not one more: the shared attachment they all embed was never reached.
    expect(result.rowCount).toBe(NOTE_COUNT);
    expect(result.rowPathsOutsideFolder).toEqual([]);
    expect(result.openDurationInMilliseconds).toBeLessThan(OPEN_BUDGET_IN_MILLISECONDS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

async function runScaleScenario(): Promise<ScaleResult> {
  return evalInObsidian({
    async callback({
      app,
      lib: { waitUntil },
      menuItemTitle,
      noteCount,
      obsidianModule,
      timeoutInMilliseconds
    }): Promise<ScaleResult> {
      const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
      const folderPath = `scale-${stamp}`;
      const attachmentPath = `${folderPath}/shared.png`;

      try {
        await app.vault.createFolder(folderPath);
        await app.vault.createBinary(attachmentPath, new Uint8Array([1, 2, 3, 4]).buffer);

        for (let index = 0; index < noteCount; index++) {
          await app.vault.create(`${folderPath}/Note ${index.toString().padStart(4, '0')}.md`, `![[${attachmentPath}]]\n`);
        }

        const folder = app.vault.getFolderByPath(folderPath);

        if (!folder) {
          throw new Error('the fixture folder was not created');
        }

        const menu = new obsidianModule.Menu();
        app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
        const menuItem = menu.items.find((item): item is MenuItem => 'titleEl' in item && item.titleEl.textContent === menuItemTitle);

        const startedAt = performance.now();
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

        await waitUntil({
          message: 'the tree never drew a row per note',
          predicate: () => getRowPaths().length >= noteCount,
          timeoutInMilliseconds
        });

        const openDurationInMilliseconds = performance.now() - startedAt;
        const rowPaths = getRowPaths();

        const cancelButton = [...modalEl?.querySelectorAll('button') ?? []]
          .find((button) => button.textContent === 'Cancel');
        cancelButton?.click();

        return {
          openDurationInMilliseconds,
          rowCount: rowPaths.length,
          rowPathsOutsideFolder: rowPaths.filter((path) => !path.endsWith('.md'))
        };
      } finally {
        if (await app.vault.adapter.exists(folderPath)) {
          await app.vault.adapter.rmdir(folderPath, true);
        }
      }
    },
    input: {
      menuItemTitle: MENU_ITEM_TITLE,
      noteCount: NOTE_COUNT,
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
    },
    vaultPath: getTemporaryVault().path
  });
}
