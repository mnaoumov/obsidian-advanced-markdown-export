/**
 * @file
 *
 * Produces the desktop frames of the export tree, driving a staged vault in a real Obsidian and writing
 * `images/screenshots/screenshot-desktop-N.png`.
 *
 * The staged graph IS the demo vault's worked example - `Example/A.md` embedding two attachments and
 * linking `B`, `B.md` embedding two of its own and linking both `C` and back to `A`, `C.md` embedding an
 * attachment `A` already has. That is not decoration: the cycle and the diamond are what produce the
 * greyed, disabled REPEAT rows, which are this modal's most distinctive behavior and the one thing a
 * still frame can actually show. A reader who follows the README to the demo vault meets the same names.
 *
 * The attachment bytes are read off `demo-vault/Example/Attachments/`, so the files in the pictures are
 * the files in the documentation rather than a second set that can drift from it.
 *
 * Excluded from `npm run test:integration` by its file name - see the `capture-screenshots:desktop`
 * project in `scripts/vitest-config.ts`. Capturing is an explicit operation
 * (`npm run capture:screenshots`), not something every test run does: it opens a window and leaves a
 * modal on screen to photograph it.
 */

import type { MenuItem } from 'obsidian';

import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

/**
 * `App`, reduced to the inline-title toggle that `obsidian-typings` does not declare. Setting
 * `showInlineTitle` alone changes nothing on screen.
 */
interface InlineTitleApp {
  updateInlineTitleDisplay(this: void): void;
}

/**
 * What is painted over the window at the moment of the shutter.
 */
interface Overlays {
  readonly modalCount: number;
  readonly noticeCount: number;
}

/**
 * One row of the tree, reduced to what a caption can be checked against.
 */
interface TreeRow {
  readonly isChecked: boolean;
  readonly isRepeat: boolean;
  readonly path: string;
}

const MENU_ITEM_TITLE = 'Export with dependencies';

const WIDTH_IN_PIXELS = 1200;
const HEIGHT_IN_PIXELS = 800;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');
const EXAMPLE_DIRECTORY = join(process.cwd(), 'demo-vault', 'Example');
const ATTACHMENTS_DIRECTORY = join(EXAMPLE_DIRECTORY, 'Attachments');

const NOTE_A_PATH = 'Example/A.md';
const NOTE_B_PATH = 'Example/B.md';
const NOTE_C_PATH = 'Example/C.md';
const ATTACHMENT_A1_PATH = 'Example/Attachments/A1.png';
const ATTACHMENT_A2_PATH = 'Example/Attachments/A2.png';
const ATTACHMENT_B3_PATH = 'Example/Attachments/B3.png';
const ATTACHMENT_B4_PATH = 'Example/Attachments/B4.png';
const EXAMPLE_FOLDER_PATH = 'Example';

beforeAll(async () => {
  const vault = getTemporaryVault();

  vault.populate({
    [ATTACHMENT_A1_PATH]: readFileSync(join(ATTACHMENTS_DIRECTORY, 'A1.png')),
    [ATTACHMENT_A2_PATH]: readFileSync(join(ATTACHMENTS_DIRECTORY, 'A2.png')),
    [ATTACHMENT_B3_PATH]: readFileSync(join(ATTACHMENTS_DIRECTORY, 'B3.png')),
    [ATTACHMENT_B4_PATH]: readFileSync(join(ATTACHMENTS_DIRECTORY, 'B4.png')),
    [NOTE_A_PATH]: readFileSync(join(EXAMPLE_DIRECTORY, 'A.md'), 'utf-8'),
    [NOTE_B_PATH]: readFileSync(join(EXAMPLE_DIRECTORY, 'B.md'), 'utf-8'),
    [NOTE_C_PATH]: readFileSync(join(EXAMPLE_DIRECTORY, 'C.md'), 'utf-8')
  });
  await vault.syncToDevice();

  await evalInObsidian({
    async callback({ app, lib: { waitUntil }, noteAPath, waitTimeoutInMilliseconds }): Promise<void> {
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;

      app.changeTheme('obsidian');

      // The modal is the subject, not the file explorer, so the sidebar is collapsed to give it the frame.
      app.workspace.leftSplit.collapse();

      // The example note's own `# A` heading already titles it, so Obsidian's inline title renders the
      // Name twice. Setting the config alone changes nothing on screen; the applier is what re-renders.
      app.vault.setConfig('showInlineTitle', false);
      const inlineTitleApp: unknown = app;
      (inlineTitleApp as InlineTitleApp).updateInlineTitleDisplay();

      await waitUntil({
        message: 'the fixture graph is in the metadata cache',
        predicate: () => {
          const noteA = app.vault.getFileByPath(noteAPath);
          if (!noteA) {
            return false;
          }

          const cache = app.metadataCache.getFileCache(noteA);
          return (cache?.embeds?.length ?? 0) > 0 && (cache?.links?.length ?? 0) > 0;
        },
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      // The root of the worked example sits behind the modal, so the frame is a vault rather than a
      // Dialog floating over an empty New tab.
      const noteA = app.vault.getFileByPath(noteAPath);
      if (noteA) {
        await app.workspace.getLeaf(false).openFile(noteA);
      }

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    input: {
      noteAPath: NOTE_A_PATH,
      waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
    },
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('desktop frames of the export tree', () => {
  it('1 - the defaults a note opens with', async () => {
    const rows = await openTreeFor(NOTE_A_PATH);

    expect(rows.map((row) => row.path)).toStrictEqual([
      NOTE_A_PATH,
      ATTACHMENT_A1_PATH,
      ATTACHMENT_A2_PATH,
      NOTE_B_PATH
    ]);
    expect(checkedPaths(rows)).toStrictEqual([NOTE_A_PATH, ATTACHMENT_A1_PATH, ATTACHMENT_A2_PATH]);

    await shoot(1, 'Attachments arrive checked, linked notes do not');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('2 - ticking a linked note expands it', async () => {
    const rows = await tickRow(NOTE_B_PATH);

    // The same rule one level deeper: B's own attachments come in checked, B's own linked note does not.
    expect(checkedPaths(rows)).toContain(ATTACHMENT_B3_PATH);
    expect(checkedPaths(rows)).toContain(ATTACHMENT_B4_PATH);
    expect(checkedPaths(rows)).not.toContain(NOTE_C_PATH);

    await shoot(2, 'Tick a linked note and it expands one level deeper');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('3 - a file already in the bundle is mirrored where it repeats', async () => {
    const rows = await tickRow(NOTE_C_PATH);

    /*
     * Two repeats, and both are on screen: `A.md` under `B` (the cycle) and `A1.png` under `C` (the
     * diamond). The caption claims the file is LISTED ONCE, so the assertion is that each path owns
     * exactly one live row and every further occurrence is a repeat.
     */
    const repeats = rows.filter((row) => row.isRepeat).map((row) => row.path);
    expect(repeats).toContain(NOTE_A_PATH);
    expect(repeats).toContain(ATTACHMENT_A1_PATH);
    expect(rows.filter((row) => row.path === ATTACHMENT_A1_PATH && !row.isRepeat)).toHaveLength(1);

    await shoot(3, 'Listed once, and mirrored wherever it repeats');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('4 - a folder root makes a forest', async () => {
    const rows = await openTreeFor(EXAMPLE_FOLDER_PATH);

    // Every note in the folder is a root of its own, so all three sit at the top level side by side.
    expect(rows.map((row) => row.path)).toStrictEqual([NOTE_A_PATH, NOTE_B_PATH, NOTE_C_PATH]);

    await shoot(4, 'Export a folder and every note in it is a root');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('5 - the selection toolbar, close up', async () => {
    const rows = await clickToolbarButton('Expand all');
    const expanded = await clickToolbarButton('Check attachments');

    // `Expand all` is what puts the attachments on screen for `Check attachments` to tick.
    expect(rows.length).toBeGreaterThan(3);
    expect(checkedPaths(expanded)).toContain(ATTACHMENT_A1_PATH);
    expect(checkedPaths(expanded)).toContain(ATTACHMENT_B3_PATH);

    /*
     * At the listing size, not a narrower close-up. Shrinking the window does magnify the modal, but the
     * modal is taller than the toolbar - so the window that magnifies the five buttons is the window that
     * pushes `Export` and `Cancel` under the caption band, and a frame whose footer is half-covered reads
     * as a broken screenshot rather than a close-up.
     */
    await shoot(5, 'Bulk selection, without ticking a hundred boxes');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * The paths of the rows that are ticked.
 *
 * @param rows - The rows the modal is showing.
 * @returns Their paths, in the order they are drawn.
 */
function checkedPaths(rows: TreeRow[]): string[] {
  return rows.filter((row) => row.isChecked).map((row) => row.path);
}

/**
 * Presses one of the toolbar's buttons and leaves the result on screen.
 *
 * @param buttonText - The button's label.
 * @returns The rows the modal is showing afterwards.
 */
async function clickToolbarButton(buttonText: string): Promise<TreeRow[]> {
  return await evalInObsidian({
    async callback({ buttonText: text, lib: { waitUntil }, waitTimeoutInMilliseconds }): Promise<TreeRow[]> {
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      const modalEl = document.querySelector('.advanced-markdown-export-tree-modal');
      if (!modalEl) {
        throw new Error('No export tree modal is open.');
      }

      const button = [...modalEl.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
      if (!button) {
        throw new Error(`The toolbar has no ${text} button.`);
      }

      button.click();

      await waitUntil({
        message: `the tree redrew after ${text}`,
        predicate: () => modalEl.querySelectorAll('.advanced-markdown-export-path').length > 0,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      /**
       * Reads the drawn rows out of the modal. Declared inside the callback because the callback is
       * serialized into Obsidian and cannot reach anything in this module's scope.
       *
       * @param el - The modal element.
       * @returns One entry per row, in the order they are drawn.
       */
      function readRows(el: Element): TreeRow[] {
        return [...el.querySelectorAll('.tree-item-self')].map((rowEl) => ({
          isChecked: rowEl.querySelector<HTMLInputElement>('.advanced-markdown-export-checkbox')?.checked ?? false,
          isRepeat: rowEl.classList.contains('advanced-markdown-export-repeat'),
          path: rowEl.querySelector('.advanced-markdown-export-path')?.textContent ?? ''
        }));
      }

      return readRows(modalEl);
    },
    input: {
      buttonText,
      waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
    },
    vaultPath: vaultPath()
  });
}

/**
 * What is painted over the window right now.
 *
 * @returns The number of open modals and the number of notices on screen.
 */
async function countOverlays(): Promise<Overlays> {
  return await evalInObsidian({
    callback(): Overlays {
      return {
        modalCount: document.querySelectorAll('.modal-container').length,
        noticeCount: document.querySelectorAll('.notice-container, .notice').length
      };
    },
    vaultPath: vaultPath()
  });
}

/**
 * Opens the export tree from the file-explorer context menu and leaves it on screen for the capture.
 *
 * @param path - The note or folder the export starts from.
 * @returns The rows the modal is showing.
 */
async function openTreeFor(path: string): Promise<TreeRow[]> {
  return await evalInObsidian({
    async callback({
      app,
      lib: { waitUntil },
      menuItemTitle,
      obsidianModule,
      rootPath,
      waitTimeoutInMilliseconds
    }): Promise<TreeRow[]> {
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      /*
       * Each shot leaves its modal on screen - that is the point of the shot - so the next one has to put
       * it away before opening its own. Dismissed by clicking the modal background rather than by pressing
       * Escape, the one gesture that works on Android too, which keeps this suite and its mobile twin the
       * same shape.
       */
      const background = document.querySelector('.modal-bg');
      if (background instanceof HTMLElement) {
        background.click();
      }

      await waitUntil({
        message: 'no export tree left open',
        predicate: () => document.querySelector('.advanced-markdown-export-tree-modal') === null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

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

      await waitUntil({
        message: 'the export tree is open',
        predicate: () => document.querySelector('.advanced-markdown-export-tree-modal') !== null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      const modalEl = document.querySelector('.advanced-markdown-export-tree-modal');
      if (!modalEl) {
        throw new Error('The export tree modal vanished after opening.');
      }

      await waitUntil({
        message: 'the tree drew its rows',
        predicate: () => modalEl.querySelectorAll('.advanced-markdown-export-path').length > 0,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      /**
       * Reads the drawn rows out of the modal. Declared inside the callback because the callback is
       * serialized into Obsidian and cannot reach anything in this module's scope.
       *
       * @param el - The modal element.
       * @returns One entry per row, in the order they are drawn.
       */
      function readRows(el: Element): TreeRow[] {
        return [...el.querySelectorAll('.tree-item-self')].map((rowEl) => ({
          isChecked: rowEl.querySelector<HTMLInputElement>('.advanced-markdown-export-checkbox')?.checked ?? false,
          isRepeat: rowEl.classList.contains('advanced-markdown-export-repeat'),
          path: rowEl.querySelector('.advanced-markdown-export-path')?.textContent ?? ''
        }));
      }

      return readRows(modalEl);
    },
    input: {
      menuItemTitle: MENU_ITEM_TITLE,
      rootPath: path,
      waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
    },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshots/screenshot-desktop-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame. `labelScreenshot` scales one line to
 * the frame's width and does NOT wrap, so a caption much past 45 characters is silently clipped mid-word
 * at 1200px - which is how a frame ships with half a sentence burned into it.
 */
async function shoot(index: number, caption: string): Promise<void> {
  /*
   * Exactly one modal and no notice, always. Every frame here deliberately leaves its modal on screen and
   * the next shot dismisses it on the way in, so the ways this goes wrong are a stray SECOND modal landing
   * in the frame, the intended one having closed before the shutter, and a notice band settling on top of
   * whatever is being photographed. None of them fails any assertion above - they just produce a picture
   * of the wrong thing, which is the one defect a capture suite cannot afford to ship silently. Asserting
   * the exact counts is the difference between a frame that is right and a frame nobody has checked.
   */
  expect(await countOverlays()).toStrictEqual({
    modalCount: 1,
    noticeCount: 0
  });

  const bytes = await captureObsidianScreenshot({
    heightInPixels: HEIGHT_IN_PIXELS,
    vaultPath: vaultPath(),
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(bytes, { text: caption });

  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-desktop-${String(index)}.png`), labeled);
}

/**
 * Ticks one row of the open tree and leaves the result on screen.
 *
 * @param path - The vault path of the row to tick.
 * @returns The rows the modal is showing afterwards.
 */
async function tickRow(path: string): Promise<TreeRow[]> {
  return await evalInObsidian({
    async callback({ lib: { waitUntil }, rowPath, waitTimeoutInMilliseconds }): Promise<TreeRow[]> {
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      const modalEl = document.querySelector('.advanced-markdown-export-tree-modal');
      if (!modalEl) {
        throw new Error('No export tree modal is open.');
      }

      const rowCountBefore = modalEl.querySelectorAll('.advanced-markdown-export-path').length;

      const selfEl = [...modalEl.querySelectorAll('.tree-item-self')]
        .find((candidate) => candidate.querySelector('.advanced-markdown-export-path')?.textContent === rowPath);
      const checkbox = selfEl?.querySelector<HTMLInputElement>('.advanced-markdown-export-checkbox');
      if (!checkbox) {
        throw new Error(`The tree has no live checkbox for ${rowPath}.`);
      }

      // A dispatched change rather than a trusted click, exactly as `export-flow.desktop.integration.test.ts`
      // Drives the same checkbox: the harness's trusted-input helpers are Electron-only, and this suite's
      // Mobile twin has to do what this one does.
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      await waitUntil({
        message: `${rowPath} expanded into its own dependencies`,
        predicate: () => modalEl.querySelectorAll('.advanced-markdown-export-path').length > rowCountBefore,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      /**
       * Reads the drawn rows out of the modal. Declared inside the callback because the callback is
       * serialized into Obsidian and cannot reach anything in this module's scope.
       *
       * @param el - The modal element.
       * @returns One entry per row, in the order they are drawn.
       */
      function readRows(el: Element): TreeRow[] {
        return [...el.querySelectorAll('.tree-item-self')].map((rowEl) => ({
          isChecked: rowEl.querySelector<HTMLInputElement>('.advanced-markdown-export-checkbox')?.checked ?? false,
          isRepeat: rowEl.classList.contains('advanced-markdown-export-repeat'),
          path: rowEl.querySelector('.advanced-markdown-export-path')?.textContent ?? ''
        }));
      }

      return readRows(modalEl);
    },
    input: {
      rowPath: path,
      waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
    },
    vaultPath: vaultPath()
  });
}

/**
 * The vault the harness staged for this run.
 *
 * @returns Its absolute path.
 */
function vaultPath(): string {
  return getTemporaryVault().path;
}
