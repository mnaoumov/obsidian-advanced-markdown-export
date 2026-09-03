import type {
  TAbstractFile,
  TFile
} from 'obsidian';

import {
  asFile,
  isFolder,
  isNote
} from 'obsidian-dev-utils/obsidian/file-system';

import type { DependencyResolver } from './dependency-resolver.ts';
import type { ReadonlyPluginSettings } from './plugin-settings.ts';

import { DependencyKind } from './dependency-resolver.ts';

/**
 * One row of the tree.
 */
export interface ExportForestNode {
  /**
   * The ids of this node's children. Always empty until the node is expanded, and always empty on a
   * repeat - a repeat's children live on its owner.
   */
  readonly childIds: readonly NodeId[];

  /**
   * How far below its root this node sits. A root is `0`.
   */
  readonly depth: number;

  /**
   * The file this node stands for, or `null` when the link is unresolved.
   */
  readonly file: null | TFile;

  /**
   * This node's id.
   */
  readonly id: NodeId;

  /**
   * Whether this node has been expanded. Only an owner is ever expanded.
   */
  readonly isExpanded: boolean;

  /**
   * What kind of dependency this node is.
   */
  readonly kind: DependencyKind;

  /**
   * The id of the node that owns this path - itself when this node is the owner, and the first occurrence
   * otherwise.
   */
  readonly ownerId: NodeId;

  /**
   * The node's vault path, or the unresolved link path.
   */
  readonly path: string;

  /**
   * The `#heading` / `^block` part of the link that produced this node.
   */
  readonly subpath: string;
}

/**
 * What the export currently adds up to.
 */
export interface ExportTotals {
  /**
   * How many files the export would write.
   */
  readonly fileCount: number;

  /**
   * How many bytes those files add up to.
   */
  readonly totalBytes: number;
}

/**
 * Identifies one node in the forest. Distinct from the node's path: a file reached twice has two nodes
 * and one path.
 */
export type NodeId = string;

interface ExportForestConstructorParams {
  readonly resolver: DependencyResolver;
  readonly roots: readonly TAbstractFile[];
  readonly settings: ReadonlyPluginSettings;
}

interface ExportForestCreateNodeParams {
  readonly depth: number;
  readonly file: null | TFile;
  readonly kind: DependencyKind;
  readonly path: string;
  readonly subpath: string;
}

interface MutableNode {
  childIds: NodeId[];
  readonly depth: number;
  readonly file: null | TFile;
  readonly id: NodeId;
  isExpanded: boolean;
  isResolved: boolean;
  readonly kind: DependencyKind;
  readonly ownerId: NodeId;

  /**
   * The paths that link to this one, accumulated on the OWNER across every occurrence. This is what lets
   * unchecking a note tell "nothing else wants this dependency" from "another checked note still does".
   */
  readonly parentPaths: Set<string>;
  readonly path: string;
  readonly subpath: string;
}

/**
 * The selection model behind the tree: a forest of roots, first-occurrence ownership, repeats that mirror
 * their owner, and depth driven by the user's ticks rather than by a number typed up front.
 *
 * **Ownership and lazy expansion.** The first node created for a path owns its live checkbox; every later
 * occurrence is a disabled mirror. Roots are all created up front and therefore claim their paths before
 * any dependency can, which is what stops a folder root from re-expanding its own members. Below the
 * roots, nodes only exist once the user opens their parent - the closure is never computed up front,
 * because a folder root can be thousands of notes - so "first occurrence" there means the first the user
 * opened. That is the only ordering a user can observe, and it is the honest reconciliation of
 * first-occurrence ownership with the lazy expansion both are hard requirements.
 */
export class ExportForest {
  private readonly checkedPaths = new Set<string>();

  /**
   * Every exportable path, in ownership order, mapped to its file. An unresolved link never gets an entry,
   * which is what keeps it out of the export without a guard at every read.
   */
  private readonly fileByPath = new Map<string, TFile>();
  private nextNodeIdIndex = 0;
  private readonly nodes = new Map<NodeId, MutableNode>();
  private readonly ownerIdByPath = new Map<string, NodeId>();
  private readonly resolver: DependencyResolver;
  private readonly rootIds: NodeId[] = [];
  private readonly rootPaths = new Set<string>();
  private readonly settings: ReadonlyPluginSettings;

  public constructor(params: ExportForestConstructorParams) {
    this.resolver = params.resolver;
    this.settings = params.settings;

    for (const root of params.roots) {
      for (const file of toRootFiles(root, params.settings.shouldIncludeSubfolders)) {
        const node = this.createNode({
          depth: 0,
          file,
          kind: isNote(file) ? DependencyKind.Note : DependencyKind.Attachment,
          path: file.path,
          subpath: ''
        });
        this.rootIds.push(node.id);
        this.rootPaths.add(node.path);

        // A root is the user's own pick, so it arrives checked regardless of the per-category defaults.
        if (node.ownerId === node.id) {
          this.checkedPaths.add(node.path);
        }
      }
    }
  }

  /**
   * Checks every attachment currently in the tree.
   */
  public checkAllAttachments(): void {
    for (const node of this.nodes.values()) {
      if (node.kind === DependencyKind.Attachment) {
        this.checkedPaths.add(node.path);
      }
    }
  }

  /**
   * Unchecks everything.
   */
  public clear(): void {
    this.checkedPaths.clear();
  }

  /**
   * Collapses a node.
   *
   * @param nodeId - The node to collapse.
   */
  public collapse(nodeId: NodeId): void {
    this.getNodeOrThrow(nodeId).isExpanded = false;
  }

  /**
   * Collapses every node in the tree.
   */
  public collapseAll(): void {
    for (const node of this.nodes.values()) {
      node.isExpanded = false;
    }
  }

  /**
   * Expands a node, resolving its dependencies if they have not been resolved yet.
   *
   * This is the ONLY caller of the resolver. It refuses for a repeat - whose children live on its owner -
   * and for a node already at the traversal cap.
   *
   * @param nodeId - The node to expand.
   * @returns A {@link Promise} that resolves when the node is expanded.
   */
  public async expand(nodeId: NodeId): Promise<void> {
    const node = this.getNodeOrThrow(nodeId);

    if (node.ownerId !== node.id) {
      return;
    }

    node.isExpanded = true;

    if (node.isResolved || !node.file || node.kind === DependencyKind.Attachment) {
      return;
    }

    if (node.depth >= this.settings.maxTraversalDepth) {
      return;
    }

    node.isResolved = true;
    const dependencies = await this.resolver.resolve(node.file);

    for (const dependency of dependencies) {
      const child = this.createNode({
        depth: node.depth + 1,
        file: dependency.file,
        kind: dependency.kind,
        path: dependency.path,
        subpath: dependency.subpath
      });
      node.childIds.push(child.id);
      this.getNodeOrThrow(child.ownerId).parentPaths.add(node.path);

      if (child.ownerId === child.id && this.isCheckedByDefault(dependency.kind)) {
        this.checkedPaths.add(child.path);
      }
    }
  }

  /**
   * Expands everything reachable, bounded by the traversal cap. This is where `maxTraversalDepth` earns
   * its keep - without it, expand-all on a cyclic graph would never finish growing.
   *
   * @returns A {@link Promise} that resolves when nothing is left to expand.
   */
  public async expandAll(): Promise<void> {
    for (;;) {
      const pending = [...this.nodes.values()].filter((node) => node.ownerId === node.id && !node.isExpanded);

      if (pending.length === 0) {
        return;
      }

      for (const node of pending) {
        await this.expand(node.id);
      }
    }
  }

  /**
   * The files the export would write, in ownership order. This is what the writer consumes - handing it
   * files rather than paths means it never has to look one up and never has to handle a miss.
   *
   * @returns The checked paths' files.
   */
  public getExportFiles(): TFile[] {
    const files: TFile[] = [];

    for (const [path, file] of this.fileByPath) {
      if (this.checkedPaths.has(path)) {
        files.push(file);
      }
    }

    return files;
  }

  /**
   * The paths the export would write, in ownership order.
   *
   * @returns The checked paths that have a file behind them.
   */
  public getExportPaths(): string[] {
    return this.getExportFiles().map((file) => file.path);
  }

  /**
   * Reads one node.
   *
   * @param nodeId - The node to read.
   * @returns The node.
   */
  public getNode(nodeId: NodeId): ExportForestNode {
    return this.getNodeOrThrow(nodeId);
  }

  /**
   * The ids of the roots, in the order the user supplied them.
   *
   * @returns The root ids.
   */
  public getRootIds(): NodeId[] {
    return [...this.rootIds];
  }

  /**
   * What the export currently adds up to.
   *
   * @returns The file count and total byte size.
   */
  public getTotals(): ExportTotals {
    const files = this.getExportFiles();
    return {
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.stat.size, 0)
    };
  }

  /**
   * Inverts the checked state of every path in the tree that has a file behind it.
   */
  public invert(): void {
    for (const path of this.fileByPath.keys()) {
      if (this.checkedPaths.has(path)) {
        this.checkedPaths.delete(path);
      } else {
        this.checkedPaths.add(path);
      }
    }
  }

  /**
   * Whether a node's path is in the export.
   *
   * @param nodeId - The node to test.
   * @returns Whether the path is checked.
   */
  public isChecked(nodeId: NodeId): boolean {
    return this.checkedPaths.has(this.getNodeOrThrow(nodeId).path);
  }

  /**
   * Whether a node owns its path's live checkbox, as opposed to mirroring an earlier occurrence.
   *
   * @param nodeId - The node to test.
   * @returns Whether the node is the owner.
   */
  public isOwner(nodeId: NodeId): boolean {
    const node = this.getNodeOrThrow(nodeId);
    return node.ownerId === node.id;
  }

  /**
   * Checks or unchecks a node's path.
   *
   * Checking a note expands it, which is what makes depth follow the user's ticks. Unchecking one drops
   * the dependencies it pulled in - but only those no other checked note still holds on to.
   *
   * @param nodeId - The node to check or uncheck.
   * @param isChecked - Whether the path should be in the export.
   * @returns A {@link Promise} that resolves once any expansion the tick triggered has finished.
   */
  public async setChecked(nodeId: NodeId, isChecked: boolean): Promise<void> {
    const node = this.getNodeOrThrow(nodeId);

    if (!this.fileByPath.has(node.path)) {
      return;
    }

    if (!isChecked) {
      this.checkedPaths.delete(node.path);
      this.pruneOrphanedDescendants(node.ownerId);
      return;
    }

    this.checkedPaths.add(node.path);
    await this.expand(node.ownerId);
  }

  private createNode(params: ExportForestCreateNodeParams): MutableNode {
    const id = `n${String(this.nextNodeIdIndex)}`;
    this.nextNodeIdIndex++;

    const existingOwnerId = this.ownerIdByPath.get(params.path);
    const node: MutableNode = {
      childIds: [],
      depth: params.depth,
      file: params.file,
      id,
      isExpanded: false,
      isResolved: false,
      kind: params.kind,
      ownerId: existingOwnerId ?? id,
      parentPaths: new Set<string>(),
      path: params.path,
      subpath: params.subpath
    };

    if (existingOwnerId === undefined) {
      this.ownerIdByPath.set(params.path, id);

      if (params.file) {
        this.fileByPath.set(params.path, params.file);
      }
    }

    this.nodes.set(id, node);
    return node;
  }

  private getNodeOrThrow(nodeId: NodeId): MutableNode {
    const node = this.nodes.get(nodeId);

    if (!node) {
      throw new Error(`Unknown node: ${nodeId}`);
    }

    return node;
  }

  private isCheckedByDefault(kind: DependencyKind): boolean {
    switch (kind) {
      case DependencyKind.Attachment: {
        return this.settings.shouldCheckAttachmentsByDefault;
      }
      case DependencyKind.Note: {
        return this.settings.shouldCheckLinkedNotesByDefault;
      }
      default: {
        // An unresolved link has no file to export, so it is never checked.
        return false;
      }
    }
  }

  /**
   * Drops the dependencies an unchecked note had pulled in, leaving alone any that another still-checked
   * note also holds, and any the user picked as a root.
   */
  private pruneOrphanedDescendants(uncheckedOwnerId: NodeId): void {
    /*
     * Terminates on any graph, cycles included: it only recurses after deleting a path from
     * `checkedPaths`, and a path can only be deleted once - a second visit stops at the guard below.
     */
    for (const childId of this.getNodeOrThrow(uncheckedOwnerId).childIds) {
      const child = this.getNodeOrThrow(childId);

      if (!this.checkedPaths.has(child.path) || this.rootPaths.has(child.path)) {
        continue;
      }

      const owner = this.getNodeOrThrow(child.ownerId);
      const hasCheckedParent = [...owner.parentPaths].some((parentPath) => this.checkedPaths.has(parentPath));

      if (hasCheckedParent) {
        continue;
      }

      this.checkedPaths.delete(child.path);
      this.pruneOrphanedDescendants(child.ownerId);
    }
  }
}

/**
 * Turns one user-picked root into the files it stands for. A file is itself; a folder is its notes, in
 * Obsidian's own child order, recursing into subfolders when the setting allows.
 */
function toRootFiles(root: TAbstractFile, shouldIncludeSubfolders: boolean): TFile[] {
  /*
   * `asFile` rather than an `isFile` guard: every `TAbstractFile` is one or the other, so an `isFile`
   * branch here would be unreachable and could never be covered.
   */
  if (!isFolder(root)) {
    return [asFile(root)];
  }

  const files: TFile[] = [];

  for (const child of root.children) {
    if (isFolder(child)) {
      if (shouldIncludeSubfolders) {
        files.push(...toRootFiles(child, shouldIncludeSubfolders));
      }

      continue;
    }

    if (isNote(child)) {
      files.push(asFile(child));
    }
  }

  return files;
}
