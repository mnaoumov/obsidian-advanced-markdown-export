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
 *
 * Building the fixture is a CLOSURE OF ITS OWN, and that split is what keeps this suite's budgets honest.
 * A single `evalInObsidian` callback is one script and the transport abandons a script at 30s, so a
 * closure that both writes the fixture and waits on the tree charges its waiting and its `NOTE_COUNT`
 * against the same 30s - and raising `NOTE_COUNT` would then quietly eat the budget the waits were sized
 * against. Writing the notes is a straight-line loop with nothing to wait for, so it costs this file
 * nothing to move it out: the timed closure below now holds only the open it is actually measuring.
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

const TREE_MODAL_SELECTOR = '.advanced-markdown-export-tree-modal';
const TREE_PATH_SELECTOR = '.advanced-markdown-export-path';

/*
 * Under the transport's ~30s per-closure cap, not at it. The two waits in `openFolderRoot` share ONE
 * script, and the transport abandons a script at 30s, so the previous 60_000 apiece declared 120s of
 * patience no script could be granted. A wait that outlives the cap cannot report what it was waiting
 * for - it dies as a bare `script timeout`, naming neither the modal that never opened nor the rows that
 * were never drawn, so both messages below were unreachable.
 *
 * Being a PERFORMANCE suite buys none of the cap back, which is the reading that kept this ceiling high.
 * The generous budget such a suite is entitled to is `TEST_TIMEOUT_IN_MILLISECONDS`, which vitest honours;
 * a ceiling declared inside a closure is a promise made to a script that is killed regardless.
 *
 * This file's budget is two waits and no settles, shared by the one closure that waits at all - the
 * fixture build and the clean-up declare nothing, which is why moving the fixture out was worth doing.
 * At 10_000 apiece that is 20s, two thirds of the cap, leaving the rest for the open itself. It stays at
 * that size rather than being tightened further because the ceilings exist for a machine slow enough to
 * make the open genuinely take seconds, which is the case where naming what did not happen matters most.
 * On a warm machine there is nothing to tighten towards: instrumented, the fixture-free closure ran in
 * about 100ms with both waits satisfied inside a single poll tick, and `OPEN_BUDGET_IN_MILLISECONDS`
 * fails the test at 5s long before either ceiling is approached.
 */
const WAIT_TIMEOUT_IN_MILLISECONDS = 10_000;

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

/**
 * Writes the fixture folder: one shared attachment and `NOTE_COUNT` notes that all embed it.
 *
 * Deliberately waits for nothing, so it declares no budget against the script-timeout cap and the size of
 * the fixture stays independent of the ceilings the timed closure sets.
 *
 * @param folderPath - The vault-relative folder to create the fixture in.
 */
async function buildFixture(folderPath: string): Promise<void> {
  await evalInObsidian({
    async callback({ app, folderPath: fixtureFolderPath, noteCount }): Promise<void> {
      await app.vault.createFolder(fixtureFolderPath);
      await app.vault.createBinary(`${fixtureFolderPath}/shared.png`, new Uint8Array([1, 2, 3, 4]).buffer);

      for (let index = 0; index < noteCount; index++) {
        await app.vault.create(
          `${fixtureFolderPath}/Note ${index.toString().padStart(4, '0')}.md`,
          `![[${fixtureFolderPath}/shared.png]]\n`
        );
      }
    },
    input: {
      folderPath,
      noteCount: NOTE_COUNT
    },
    vaultPath: vaultPath()
  });
}

/**
 * Opens the export tree on the fixture folder and times how long it takes to draw its rows.
 *
 * One closure on purpose, even though the waits inside it are what this file had to size down. The
 * duration is read from the PAGE clock either side of the menu callback, so moving the waiting to Node
 * would put a transport round trip inside the very measurement `OPEN_BUDGET_IN_MILLISECONDS` is asserted
 * against. With the fixture build lifted out, what remains under the cap is the open and nothing else.
 *
 * @param folderPath - The fixture folder to open the export from.
 * @returns What the tree drew, and how long it took.
 */
async function openFolderRoot(folderPath: string): Promise<ScaleResult> {
  return evalInObsidian({
    async callback({
      app,
      folderPath: rootFolderPath,
      lib: { waitUntil },
      menuItemTitle,
      noteCount,
      obsidianModule,
      timeoutInMilliseconds,
      treeModalSelector,
      treePathSelector
    }): Promise<ScaleResult> {
      const folder = app.vault.getFolderByPath(rootFolderPath);

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
        predicate: () => document.querySelector(treeModalSelector) !== null,
        timeoutInMilliseconds
      });

      const modalEl = document.querySelector(treeModalSelector);

      function getRowPaths(): string[] {
        return [...modalEl?.querySelectorAll(treePathSelector) ?? []].map((el) => el.textContent);
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
    },
    input: {
      folderPath,
      menuItemTitle: MENU_ITEM_TITLE,
      noteCount: NOTE_COUNT,
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      treeModalSelector: TREE_MODAL_SELECTOR,
      treePathSelector: TREE_PATH_SELECTOR
    },
    vaultPath: vaultPath()
  });
}

/**
 * Deletes the fixture folder, whatever happened to the open above.
 *
 * @param folderPath - The fixture folder to remove.
 */
async function removeFixture(folderPath: string): Promise<void> {
  await evalInObsidian({
    async callback({ app, folderPath: fixtureFolderPath }): Promise<void> {
      if (await app.vault.adapter.exists(fixtureFolderPath)) {
        await app.vault.adapter.rmdir(fixtureFolderPath, true);
      }
    },
    input: { folderPath },
    vaultPath: vaultPath()
  });
}

/**
 * Stages the fixture, opens the folder root, and clears up after itself.
 *
 * The folder name is stamped in NODE rather than in the page, so all three closures address the same
 * fixture without having to hand a name back across the transport.
 *
 * @returns What the tree drew, and how long it took.
 */
async function runScaleScenario(): Promise<ScaleResult> {
  const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
  const folderPath = `scale-${stamp}`;

  await buildFixture(folderPath);

  try {
    return await openFolderRoot(folderPath);
  } finally {
    await removeFixture(folderPath);
  }
}

/**
 * The vault the harness staged for this run.
 *
 * @returns Its absolute path.
 */
function vaultPath(): string {
  return getTemporaryVault().path;
}
