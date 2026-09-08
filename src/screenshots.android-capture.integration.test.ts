/**
 * @file
 *
 * Produces the mobile frames of the export tree, driving it in Obsidian Mobile on a real Android emulator
 * and writing `images/screenshots/screenshot-mobile-N.png`.
 *
 * They are not the desktop frames at half the width. The tree is the WHOLE screen on a phone, its rows
 * carry the full vault path on one line, and the `Selection` toolbar renders as five pills rather than a
 * button row - so the same five subjects photograph differently here.
 *
 * The frame this set does NOT have is the mobile destination prompt, which would have been the one shot
 * with no desktop equivalent (there is no system directory picker on a phone). It cannot be taken: on a
 * device the export throws before the prompt opens, which is `T973-P46` and not this suite's to fix.
 *
 * There is no mobile equivalent of the desktop viewport override, so the capture is always the device's
 * own framebuffer - which is why this runs on the `obsidian_screenshots` AVD, built at exactly the
 * 900x1600 the community store asks for. See `scripts/vitest-config.ts` for why the shared `obsidian_test`
 * AVD cannot stand in.
 *
 * Split across several short `evalInObsidian` calls because one call is one `execute/sync`, which
 * WebDriver caps at 30 seconds.
 *
 * Excluded from `npm run test:integration` by its file name - see the `capture-screenshots:android`
 * project in `scripts/vitest-config.ts`. Capturing is an explicit operation
 * (`npm run capture:screenshots`), not something every test run does.
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
 * `App`, reduced to the font-size applier that `obsidian-typings` does not declare. Setting
 * `baseFontSize` alone changes nothing on screen.
 */
interface FontSizeApp {
  updateFontSize(this: void): void;
}

/**
 * `App`, reduced to the inline-title toggle that `obsidian-typings` does not declare. Setting
 * `showInlineTitle` alone changes nothing on screen.
 */
interface InlineTitleApp {
  updateInlineTitleDisplay(this: void): void;
}

/**
 * What is painted over the screen at the moment of the shutter.
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

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

/**
 * The AVD is 900x1600 at density 320 - a 450x800 dp screen, on which the default type is large enough
 * that a four-level tree runs off the bottom of the frame.
 */
const MOBILE_FONT_SIZE_IN_PIXELS = 13;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

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
    async callback({ app, fontSizeInPixels, lib: { waitUntil }, noteAPath, waitTimeoutInMilliseconds }): Promise<void> {
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;

      app.changeTheme('obsidian');

      /*
       * No sidebar to collapse, unlike the desktop suite: on a phone it is a drawer that is already
       * closed, and the modal covers whatever is behind it.
       *
       * Smaller type so the deeper trees fit the frame - see `MOBILE_FONT_SIZE_IN_PIXELS`. Setting the
       * config alone changes nothing on screen; the applier is what re-renders.
       */
      app.vault.setConfig('baseFontSize', fontSizeInPixels);
      const fontApp: unknown = app;
      (fontApp as FontSizeApp).updateFontSize();

      // The example note's own `# A` heading already titles it, so Obsidian's inline title renders the
      // Name twice.
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
      fontSizeInPixels: MOBILE_FONT_SIZE_IN_PIXELS,
      noteAPath: NOTE_A_PATH,
      waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
    },
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('mobile frames of the export tree', () => {
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

    expect(checkedPaths(rows)).toContain(ATTACHMENT_B3_PATH);
    expect(checkedPaths(rows)).toContain(ATTACHMENT_B4_PATH);
    expect(checkedPaths(rows)).not.toContain(NOTE_C_PATH);

    await shoot(2, 'Tick a linked note and it expands one level deeper');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('3 - a file already in the bundle is mirrored where it repeats', async () => {
    const rows = await tickRow(NOTE_C_PATH);

    const repeats = rows.filter((row) => row.isRepeat).map((row) => row.path);
    expect(repeats).toContain(NOTE_A_PATH);
    expect(repeats).toContain(ATTACHMENT_A1_PATH);
    expect(rows.filter((row) => row.path === ATTACHMENT_A1_PATH && !row.isRepeat)).toHaveLength(1);

    await shoot(3, 'Listed once, and mirrored wherever it repeats');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('4 - a folder root makes a forest', async () => {
    const rows = await openTreeFor(EXAMPLE_FOLDER_PATH);

    expect(rows.map((row) => row.path)).toStrictEqual([NOTE_A_PATH, NOTE_B_PATH, NOTE_C_PATH]);

    await shoot(4, 'Export a folder and every note in it is a root');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('5 - the selection toolbar at phone width', async () => {
    await clickToolbarButton('Expand all');
    const rows = await clickToolbarButton('Check attachments');

    // `Expand all` is what puts the attachments on screen for `Check attachments` to tick.
    expect(checkedPaths(rows)).toContain(ATTACHMENT_A1_PATH);
    expect(checkedPaths(rows)).toContain(ATTACHMENT_B3_PATH);

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
    async callback({ buttonText: text, lib: { clickElement, waitUntil }, waitTimeoutInMilliseconds }): Promise<TreeRow[]> {
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      const modalEl = document.querySelector('.advanced-markdown-export-tree-modal');
      if (!modalEl) {
        throw new Error('No export tree modal is open.');
      }

      const button = [...modalEl.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
      if (!button) {
        throw new Error(`The toolbar has no ${text} button.`);
      }

      await clickElement({ element: button });

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
 * What is painted over the screen right now.
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
      lib: { pressKey, waitUntil },
      menuItemTitle,
      obsidianModule,
      rootPath,
      waitTimeoutInMilliseconds
    }): Promise<TreeRow[]> {
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      /*
       * Each shot leaves its modal on screen - that is the point of the shot - so the next one has to put
       * it away before opening its own. Escape rather than a tap on the modal background: a trusted tap is
       * hit-tested at the element's centre, and the background's centre is behind the modal, so the tap
       * would land on the modal itself.
       */
      await pressKey({ key: 'Escape' });

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
 * Captures the device's framebuffer, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  /*
   * Exactly one modal and no notice, always. Every frame here deliberately leaves its modal on screen and
   * the next shot dismisses it on the way in, so the ways this goes wrong are a stray SECOND modal landing
   * in the frame, the intended one having closed before the shutter, and a notice band settling on top of
   * whatever is being photographed. None of them fails any assertion above - they just produce a picture
   * of the wrong thing, which is the one defect a capture suite cannot afford to ship silently. The notice
   * half matters most HERE: a phone frame is all modal, so a band has nowhere to land but on the subject.
   */
  expect(await countOverlays()).toStrictEqual({
    modalCount: 1,
    noticeCount: 0
  });

  const captured = await captureObsidianScreenshot({ vaultPath: vaultPath() });

  /*
   * The AVD is 900x1600, so the device frame IS the store's size. Asserting it here is what keeps that
   * true: run this against any other AVD and it fails loudly instead of quietly shipping an off-spec
   * image.
   */
  expect(readPngDimensions(captured)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  // Captioned AFTER capture, so the frame stays an untouched device screenshot and rewording a label
  // Needs no re-shoot.
  const labeled = await labelScreenshot(captured, { text: caption });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
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
