import type {
  App,
  ButtonComponent,
  TFile
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  Modal,
  setIcon,
  Setting
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { showModal } from 'obsidian-dev-utils/obsidian/modals/modal';
import { basename } from 'obsidian-dev-utils/path';

import type {
  ExportForest,
  NodeId
} from '../export-forest.ts';

import { DependencyKind } from '../dependency-resolver.ts';
import { formatBytes } from '../format-bytes.ts';

/**
 * The parameters for {@link showExportTreeModal}.
 */
export interface ShowExportTreeModalParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * The selection model the tree edits in place.
   */
  readonly forest: ExportForest;
}

interface ExportTreeModalConstructorParams extends ShowExportTreeModalParams {
  readonly promiseResolve: PromiseResolve<null | TFile[]>;
}

interface RenderedRow {
  readonly checkbox: HTMLInputElement;
  readonly childrenEl: HTMLElement;

  /**
   * The rows currently drawn beneath this one, so replacing a subtree can forget them rather than leaving
   * detached elements behind in the row index. Held as entries rather than ids so forgetting one never
   * has to look it up and handle a miss.
   */
  childRows: [NodeId, RenderedRow][];
  readonly selfEl: HTMLElement;
}

const FLASH_DURATION_IN_MILLISECONDS = 1500;

const KIND_ICONS: Record<DependencyKind, string> = {
  [DependencyKind.Attachment]: 'paperclip',
  [DependencyKind.Note]: 'file-text',
  [DependencyKind.Unresolved]: 'file-question'
};

/**
 * The forest, drawn on Obsidian's own `tree-item` classes - `obsidian-dev-utils` has no tree component,
 * so this is the one genuinely hand-built piece of UI in the plugin.
 */
class ExportTreeModal extends Modal {
  private exportButton: ButtonComponent | null = null;
  private readonly forest: ExportForest;
  private hasAccepted = false;
  private readonly promiseResolve: PromiseResolve<null | TFile[]>;
  private readonly rowsById = new Map<NodeId, RenderedRow>();
  private readonly summaryEl: HTMLElement;
  private readonly treeEl: HTMLElement;

  public constructor(params: ExportTreeModalConstructorParams) {
    super(params.app);
    this.forest = params.forest;
    this.promiseResolve = params.promiseResolve;

    /*
     * Built here rather than in `onOpen` so they are never null: Obsidian's `Modal` has its `contentEl`
     * ready from construction, and a nullable field would put an unreachable guard on every read.
     */
    this.modalEl.addClass('advanced-markdown-export-tree-modal');
    this.summaryEl = this.contentEl.createDiv({ cls: 'advanced-markdown-export-summary' });
    this.renderToolbar();
    this.treeEl = this.contentEl.createDiv({ cls: 'advanced-markdown-export-tree' });
    this.renderFooter();
  }

  public override onClose(): void {
    super.onClose();
    this.promiseResolve(this.hasAccepted ? this.forest.getExportFiles() : null);
  }

  public override onOpen(): void {
    super.onOpen();
    this.setTitle('Export with dependencies');
    this.renderTree();
  }

  private accept(): void {
    this.hasAccepted = true;
    this.close();
  }

  /**
   * Forgets a row and everything drawn beneath it, so the index never holds rows whose elements have been
   * thrown away.
   */
  private forgetRow(nodeId: NodeId, row: RenderedRow): void {
    for (const [childNodeId, childRow] of row.childRows) {
      this.forgetRow(childNodeId, childRow);
    }

    this.rowsById.delete(nodeId);
  }

  /**
   * Rebuilds one row's children in place. Rebuilding only the subtree that changed is what keeps a folder
   * root of a few thousand notes responsive when a single checkbox is ticked.
   */
  private renderChildren(row: RenderedRow, nodeId: NodeId): void {
    for (const [childNodeId, childRow] of row.childRows) {
      this.forgetRow(childNodeId, childRow);
    }

    row.childRows = [];
    row.childrenEl.empty();

    const node = this.forest.getNode(nodeId);
    row.childrenEl.toggleClass('is-collapsed', !node.isExpanded);

    if (!node.isExpanded) {
      return;
    }

    for (const childId of node.childIds) {
      row.childRows.push([childId, this.renderNode(row.childrenEl, childId)]);
    }
  }

  private renderFooter(): void {
    new Setting(this.contentEl)
      .addButton((button) => {
        this.exportButton = button;
        button
          .setButtonText('Export')
          .setCta()
          .onClick(() => {
            this.accept();
          });
      })
      .addButton((button) => {
        button
          .setButtonText('Cancel')
          .onClick(() => {
            this.close();
          });
      });
  }

  private renderNode(parentEl: HTMLElement, nodeId: NodeId): RenderedRow {
    const node = this.forest.getNode(nodeId);
    const isOwner = this.forest.isOwner(nodeId);
    const isUnresolved = node.kind === DependencyKind.Unresolved;
    const itemEl = parentEl.createDiv({ cls: 'tree-item' });
    const selfEl = itemEl.createDiv({ cls: 'tree-item-self' });

    /*
     * Only an owning note can grow a subtree: a repeat's children live on its owner, and an attachment or
     * an unresolved link has nothing to walk.
     */
    const isExpandable = isOwner && node.kind === DependencyKind.Note;
    const twistyEl = isExpandable
      ? selfEl.createDiv({ cls: 'tree-item-icon collapse-icon' })
      : selfEl.createDiv({ cls: 'advanced-markdown-export-twisty-placeholder' });

    if (isExpandable) {
      setIcon(twistyEl, 'right-triangle');
      twistyEl.toggleClass('is-collapsed', !node.isExpanded);
    }

    const checkbox = selfEl.createEl('input', {
      cls: 'advanced-markdown-export-checkbox',
      type: 'checkbox'
    });
    checkbox.checked = this.forest.isChecked(nodeId);

    /*
     * The invariant the whole selection model rests on: the FIRST occurrence of a file owns its live
     * checkbox and every later one - a cycle, a diamond, a folder member reached through a sibling -
     * mirrors it read-only. A checkbox that migrated between rows as the user toggled would be worse.
     */
    checkbox.disabled = !isOwner || isUnresolved;

    const iconEl = selfEl.createSpan({ cls: 'advanced-markdown-export-kind-icon' });
    setIcon(iconEl, KIND_ICONS[node.kind]);

    const innerEl = selfEl.createDiv({ cls: 'tree-item-inner' });
    innerEl.createSpan({
      cls: 'advanced-markdown-export-name',
      text: basename(node.path)
    });
    innerEl.createSpan({
      cls: 'advanced-markdown-export-path',
      text: node.path
    });

    if (node.file) {
      selfEl
        .createDiv({ cls: 'tree-item-flair-outer' })
        .createSpan({
          cls: 'tree-item-flair',
          text: formatBytes(node.file.stat.size)
        });
    }

    if (isUnresolved) {
      selfEl.addClass('advanced-markdown-export-unresolved');
      selfEl.setAttr('title', 'This link points at nothing, so there is no file to export.');
    }

    if (!isOwner) {
      selfEl.addClass('advanced-markdown-export-repeat');
      selfEl.setAttr('title', 'Already included above. Click to jump to the row that owns it.');
      selfEl.addEventListener('click', () => {
        this.revealOwner(node.ownerId);
      });
    }

    const childrenEl = itemEl.createDiv({ cls: 'tree-item-children' });
    const row: RenderedRow = {
      checkbox,
      childrenEl,
      childRows: [],
      selfEl
    };
    this.rowsById.set(nodeId, row);

    // Wired only now, so both handlers can close over the row rather than looking it up and handling a miss.
    checkbox.addEventListener('change', () => {
      invokeAsyncSafely(async () => {
        await this.forest.setChecked(nodeId, checkbox.checked);
        this.renderChildren(row, nodeId);
        this.syncState();
      });
    });

    if (isExpandable) {
      twistyEl.addEventListener('click', () => {
        invokeAsyncSafely(async () => {
          if (this.forest.getNode(nodeId).isExpanded) {
            this.forest.collapse(nodeId);
          } else {
            await this.forest.expand(nodeId);
          }

          twistyEl.toggleClass('is-collapsed', !this.forest.getNode(nodeId).isExpanded);
          this.renderChildren(row, nodeId);
          this.syncState();
        });
      });
    }

    this.renderChildren(row, nodeId);
    return row;
  }

  private renderToolbar(): void {
    new Setting(this.contentEl)
      .setName('Selection')
      .addButton((button) => {
        button.setButtonText('Expand all').onClick(() => {
          invokeAsyncSafely(async () => {
            await this.forest.expandAll();
            this.renderTree();
          });
        });
      })
      .addButton((button) => {
        button.setButtonText('Collapse all').onClick(() => {
          this.forest.collapseAll();
          this.renderTree();
        });
      })
      .addButton((button) => {
        button.setButtonText('Check attachments').onClick(() => {
          this.forest.checkAllAttachments();
          this.renderTree();
        });
      })
      .addButton((button) => {
        button.setButtonText('Invert').onClick(() => {
          this.forest.invert();
          this.renderTree();
        });
      })
      .addButton((button) => {
        button.setButtonText('Clear').onClick(() => {
          this.forest.clear();
          this.renderTree();
        });
      });
  }

  private renderTree(): void {
    this.treeEl.empty();
    this.rowsById.clear();

    for (const rootId of this.forest.getRootIds()) {
      this.renderNode(this.treeEl, rootId);
    }

    this.syncState();
  }

  /**
   * Takes the user to the row that actually owns a repeated file, and flashes it so the jump is visible.
   * The owner may not be on screen at all - it can sit inside a subtree the user has since collapsed -
   * in which case there is nowhere to jump to.
   */
  private revealOwner(ownerId: NodeId): void {
    const ownerRow = this.rowsById.get(ownerId);

    if (!ownerRow) {
      return;
    }

    ownerRow.selfEl.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
    ownerRow.selfEl.addClass('advanced-markdown-export-flash');
    window.setTimeout(() => {
      ownerRow.selfEl.removeClass('advanced-markdown-export-flash');
    }, FLASH_DURATION_IN_MILLISECONDS);
  }

  /**
   * Pushes the forest's state back onto every rendered row plus the summary, so a repeat always shows
   * what its owner shows.
   */
  private syncState(): void {
    for (const [nodeId, row] of this.rowsById) {
      row.checkbox.checked = this.forest.isChecked(nodeId);
    }

    const totals = this.forest.getTotals();
    this.summaryEl.setText(
      `${String(totals.fileCount)} ${totals.fileCount === 1 ? 'file' : 'files'} · ${formatBytes(totals.totalBytes)}`
    );

    // Nothing selected means nothing to export - there is no empty-bundle edge case to design for.
    this.exportButton?.setDisabled(totals.fileCount === 0);
  }
}

/**
 * Shows the export tree and waits for the user to accept or cancel it.
 *
 * The forest is edited in place; the resolved value is the export set read off it at the moment the user
 * accepted, so the caller never has to know that.
 *
 * @param params - The parameters for the modal.
 * @returns A {@link Promise} that resolves to the files to export, or to `null` when the user cancelled.
 */
export async function showExportTreeModal(params: ShowExportTreeModalParams): Promise<null | TFile[]> {
  return showModal<null | TFile[]>((promiseResolve) =>
    new ExportTreeModal({
      ...params,
      promiseResolve
    })
  );
}
