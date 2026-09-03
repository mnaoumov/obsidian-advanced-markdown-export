import type {
  ButtonComponent as ButtonComponentOriginal,
  TAbstractFile as TAbstractFileOriginal,
  TFile
} from 'obsidian';

import { setTimeoutAsync } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  App,
  ButtonComponent,
  Modal,
  Setting
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { DependencyResolver } from '../dependency-resolver.ts';
import { ExportForest } from '../export-forest.ts';
import { PluginSettings } from '../plugin-settings.ts';
import { showExportTreeModal } from './export-tree-modal.ts';

type AddButtonCallback = (button: ButtonComponentOriginal) => unknown;

interface OpenedModal {
  readonly contentEl: HTMLElement;
  readonly promise: Promise<null | TFile[]>;
}

describe('showExportTreeModal', () => {
  let app: App;
  let capturedButtons: ButtonComponent[];
  let originalAddButton: Setting['addButton'];
  let originalOpen: () => void;
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    settings = new PluginSettings();

    // Jsdom has no layout, so the jump-to-owner scroll would otherwise throw.
    Element.prototype.scrollIntoView = vi.fn();

    originalOpen = Modal.prototype.open;
    originalAddButton = Setting.prototype.addButton;
    capturedButtons = [];
    Setting.prototype.addButton = function addButton(this: Setting, callback: AddButtonCallback): Setting {
      return originalAddButton.call(this, (button: ButtonComponentOriginal) => {
        capturedButtons.push(ButtonComponent.fromOriginalType2__(button));
        return callback(button);
      });
    };
  });

  afterEach(() => {
    Modal.prototype.open = originalOpen;
    Setting.prototype.addButton = originalAddButton;
  });

  function createExampleGraph(): void {
    app.vault.createFolderSync__('Example');
    app.vault.createSync__('Example/A1.png', 'a1');
    app.vault.createSync__('Example/B3.png', 'b3');
    app.vault.createSync__('Example/A.md', '![[Example/A1.png]]\nSee [[B]].');
    app.vault.createSync__('Example/B.md', '![[Example/B3.png]]\nBack to [[A]].');
  }

  function createForest(rootPaths: string[]): ExportForest {
    return new ExportForest({
      resolver: new DependencyResolver({
        app: app.asOriginalType__(),
        settings
      }),
      roots: rootPaths.map((rootPath) => {
        const file = app.vault.getFileByPath(rootPath);

        if (!file) {
          throw new Error(`No such file: ${rootPath}`);
        }

        return castTo<TAbstractFileOriginal>(file.asOriginalType__());
      }),
      settings
    });
  }

  /**
   * The mock `Modal` auto-closes on a timer, so the modal's own element is captured as it opens and the
   * promise is deliberately left un-awaited - the test drives the DOM and only then settles it.
   */
  function openModal(forest: ExportForest): OpenedModal {
    let contentEl: HTMLElement | undefined;
    Modal.prototype.open = function open(this: Modal): void {
      contentEl = this.contentEl;
      originalOpen.call(this);
    };

    const promise = showExportTreeModal({
      app: app.asOriginalType__(),
      forest
    });

    if (!contentEl) {
      throw new Error('The modal did not open');
    }

    return {
      contentEl,
      promise
    };
  }

  /**
   * The mock `ButtonComponent` keeps its `onClick` handler to itself rather than binding a DOM listener,
   * so a plain `buttonEl.click()` is inert - the captured component has to be asked to fire.
   */
  function clickButton(text: string): void {
    const button = capturedButtons.find((candidate) => candidate.buttonEl.textContent === text);

    if (!button) {
      throw new Error(`No "${text}" button`);
    }

    button.simulateClick__();
  }

  function getCheckboxes(contentEl: HTMLElement): HTMLInputElement[] {
    return [...contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  }

  function getRowPaths(contentEl: HTMLElement): string[] {
    return [...contentEl.querySelectorAll('.advanced-markdown-export-path')].map((el) => el.textContent);
  }

  function getSummary(contentEl: HTMLElement): string {
    return contentEl.querySelector('.advanced-markdown-export-summary')?.textContent ?? '';
  }

  /**
   * Sets the box and fires the `change` the modal listens for. jsdom's own click activation does not
   * produce one for an input built through Obsidian's `createEl`, and the handler is what is under test.
   */
  function tickCheckbox(checkbox: HTMLInputElement | undefined): void {
    if (!checkbox) {
      throw new Error('No such checkbox');
    }

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }

  async function settle(): Promise<void> {
    for (let index = 0; index < MACROTASK_TURNS_TO_SETTLE; index++) {
      await setTimeoutAsync();
    }
  }

  it('should draw a row per node, with its path and a running total', async () => {
    createExampleGraph();
    const forest = createForest(['Example/A.md']);
    await forest.expand(forest.getRootIds()[0] ?? '');
    const { contentEl, promise } = openModal(forest);

    expect(getRowPaths(contentEl)).toEqual([
      'Example/A.md',
      'Example/A1.png',
      'Example/B.md'
    ]);
    expect(getSummary(contentEl)).toContain('2 files');

    await promise;
  });

  it('should say "file" rather than "files" for a single one', async () => {
    createExampleGraph();
    const { contentEl, promise } = openModal(createForest(['Example/A.md']));

    expect(getSummary(contentEl)).toContain('1 file ');

    await promise;
  });

  /*
   * The invariant the selection model rests on: a repeat mirrors its owner and never becomes the live
   * checkbox.
   */
  it('should disable the checkbox on a repeat and on an unresolved link', async () => {
    createExampleGraph();
    app.vault.createSync__('C.md', 'See [[Missing]].');
    const forest = createForest(['Example/A.md']);
    const rootId = forest.getRootIds()[0] ?? '';
    await forest.expand(rootId);
    const bId = forest.getNode(rootId).childIds.find((id) => forest.getNode(id).path === 'Example/B.md') ?? '';
    await forest.expand(bId);

    const { contentEl, promise } = openModal(forest);
    const repeatEl = contentEl.querySelector('.advanced-markdown-export-repeat');
    expect(repeatEl).not.toBeNull();

    const repeatCheckbox = repeatEl?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(repeatCheckbox?.disabled).toBe(true);

    await promise;
  });

  it('should grey out an unresolved link and refuse to tick it', async () => {
    app.vault.createSync__('A.md', 'See [[Missing]].');
    const forest = createForest(['A.md']);
    await forest.expand(forest.getRootIds()[0] ?? '');
    const { contentEl, promise } = openModal(forest);

    const unresolvedEl = contentEl.querySelector('.advanced-markdown-export-unresolved');
    expect(unresolvedEl).not.toBeNull();
    expect(unresolvedEl?.getAttribute('title')).toContain('points at nothing');
    expect(unresolvedEl?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);

    await promise;
  });

  it('should stop flashing the owner once the flash has run its course', async () => {
    vi.useFakeTimers();

    try {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);
      const bId = forest.getNode(rootId).childIds.find((id) => forest.getNode(id).path === 'Example/B.md') ?? '';
      await forest.expand(bId);

      const { contentEl } = openModal(forest);
      castTo<HTMLElement>(contentEl.querySelector('.advanced-markdown-export-repeat')).click();

      const ownerEl = contentEl.querySelector('.tree-item-self');
      expect(ownerEl?.classList.contains('advanced-markdown-export-flash')).toBe(true);

      vi.advanceTimersByTime(FLASH_DURATION_IN_MILLISECONDS);

      expect(ownerEl?.classList.contains('advanced-markdown-export-flash')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  /*
   * A repeat's owner can sit inside a subtree the user has since collapsed, in which case there is
   * nothing on screen to jump to.
   */
  it('should do nothing when the owner of a repeat is not on screen', async () => {
    app.vault.createSync__('B.md', '# B');
    app.vault.createSync__('A.md', 'See [[B]].');
    app.vault.createSync__('D.md', 'Also see [[B]].');
    const forest = createForest(['A.md', 'D.md']);
    const [aRootId = '', dRootId = ''] = forest.getRootIds();
    await forest.expand(aRootId);
    await forest.expand(dRootId);
    forest.collapse(aRootId);

    const { contentEl, promise } = openModal(forest);
    castTo<HTMLElement>(contentEl.querySelector('.advanced-markdown-export-repeat')).click();

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    await promise;
  });

  it('should jump to the owner when a repeat is clicked', async () => {
    createExampleGraph();
    const forest = createForest(['Example/A.md']);
    const rootId = forest.getRootIds()[0] ?? '';
    await forest.expand(rootId);
    const bId = forest.getNode(rootId).childIds.find((id) => forest.getNode(id).path === 'Example/B.md') ?? '';
    await forest.expand(bId);

    const { contentEl, promise } = openModal(forest);
    castTo<HTMLElement>(contentEl.querySelector('.advanced-markdown-export-repeat')).click();

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await promise;
  });

  it('should expand a note when its checkbox is ticked, and grow the tree', async () => {
    createExampleGraph();
    const forest = createForest(['Example/A.md']);
    await forest.expand(forest.getRootIds()[0] ?? '');
    const { contentEl, promise } = openModal(forest);

    const noteCheckbox = getCheckboxes(contentEl)[2];
    expect(noteCheckbox?.checked).toBe(false);

    tickCheckbox(noteCheckbox);
    await settle();

    expect(getRowPaths(contentEl)).toContain('Example/B3.png');
    expect(getSummary(contentEl)).toContain('4 files');

    await promise;
  });

  it('should collapse and re-expand a note from its twisty', async () => {
    createExampleGraph();
    const forest = createForest(['Example/A.md']);
    await forest.expand(forest.getRootIds()[0] ?? '');
    const { contentEl, promise } = openModal(forest);

    const twisty = contentEl.querySelector<HTMLElement>('.collapse-icon');
    twisty?.click();
    await settle();

    expect(getRowPaths(contentEl)).toEqual(['Example/A.md']);

    twisty?.click();
    await settle();

    expect(getRowPaths(contentEl)).toContain('Example/A1.png');

    await promise;
  });

  /*
   * Collapsing has to forget the whole subtree, not just its top row - otherwise the row index keeps
   * growing with rows whose elements were thrown away, and a later jump-to-owner would scroll to nothing.
   */
  it('should forget a whole nested subtree when it is collapsed', async () => {
    createExampleGraph();
    const forest = createForest(['Example/A.md']);
    const rootId = forest.getRootIds()[0] ?? '';
    await forest.expand(rootId);
    const bId = forest.getNode(rootId).childIds.find((id) => forest.getNode(id).path === 'Example/B.md') ?? '';
    await forest.expand(bId);

    const { contentEl, promise } = openModal(forest);
    expect(getRowPaths(contentEl)).toContain('Example/B3.png');

    contentEl.querySelector<HTMLElement>('.collapse-icon')?.click();
    await settle();

    expect(getRowPaths(contentEl)).toEqual(['Example/A.md']);

    // The owner of the repeat lived in the discarded subtree, so there is nothing left to jump to.
    await promise;
  });

  describe('the toolbar', () => {
    it('should clear every selection, disabling the export', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      await forest.expand(forest.getRootIds()[0] ?? '');
      const { contentEl, promise } = openModal(forest);

      clickButton('Clear');

      expect(getSummary(contentEl)).toContain('0 files');
      expect(forest.getExportPaths()).toEqual([]);

      await promise;
    });

    it('should invert the selection', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      await forest.expand(forest.getRootIds()[0] ?? '');
      const { promise } = openModal(forest);

      clickButton('Invert');

      expect(forest.getExportPaths()).toEqual(['Example/B.md']);

      await promise;
    });

    it('should check every attachment', async () => {
      settings.shouldCheckAttachmentsByDefault = false;
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      await forest.expand(forest.getRootIds()[0] ?? '');
      const { promise } = openModal(forest);

      clickButton('Check attachments');

      expect(forest.getExportPaths()).toContain('Example/A1.png');

      await promise;
    });

    it('should expand everything, then collapse it again', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const { contentEl, promise } = openModal(forest);

      clickButton('Expand all');
      await settle();

      expect(getRowPaths(contentEl)).toContain('Example/B3.png');

      clickButton('Collapse all');
      await settle();

      expect(getRowPaths(contentEl)).toEqual(['Example/A.md']);

      await promise;
    });
  });

  describe('accepting and cancelling', () => {
    it('should resolve with the export set once Export is pressed', async () => {
      createExampleGraph();
      const { promise } = openModal(createForest(['Example/A.md']));

      clickButton('Export');

      const exported = await promise;
      expect(exported?.map((file) => file.path)).toEqual(['Example/A.md']);
    });

    it('should resolve null when Cancel is pressed', async () => {
      createExampleGraph();
      const { promise } = openModal(createForest(['Example/A.md']));

      clickButton('Cancel');

      expect(await promise).toBeNull();
    });

    it('should resolve null when the modal is dismissed without a choice', async () => {
      createExampleGraph();
      const { promise } = openModal(createForest(['Example/A.md']));

      expect(await promise).toBeNull();
    });
  });
});

const FLASH_DURATION_IN_MILLISECONDS = 1500;
const MACROTASK_TURNS_TO_SETTLE = 3;
