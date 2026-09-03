import type {
  TAbstractFile as TAbstractFileOriginal,
  TFile as TFileOriginal,
  TFolder as TFolderOriginal
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { NodeId } from './export-forest.ts';

import {
  DependencyKind,
  DependencyResolver
} from './dependency-resolver.ts';
import { ExportForest } from './export-forest.ts';
import { PluginSettings } from './plugin-settings.ts';

/*
 * Nothing is stubbed but the resolver call counter, and even that delegates to a real
 * {@link DependencyResolver} - so these tests walk a genuine link graph.
 */
describe('ExportForest', () => {
  let app: App;
  let resolvedPaths: string[];
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    settings = new PluginSettings();
    resolvedPaths = [];
  });

  /**
   * The demo vault's worked example: `A` and `B` link each other (a cycle) and both `A` and `C` embed
   * `A1.png` (a diamond).
   */
  function createExampleGraph(): void {
    app.vault.createFolderSync__('Example');
    app.vault.createFolderSync__('Example/Attachments');
    app.vault.createSync__('Example/Attachments/A1.png', 'a1');
    app.vault.createSync__('Example/Attachments/A2.png', 'a2');
    app.vault.createSync__('Example/Attachments/B3.png', 'b3');
    app.vault.createSync__('Example/Attachments/B4.png', 'b4');
    /*
     * Vault-absolute link targets: `obsidian-test-mocks` resolves a link by full path or by basename, not
     * relative to the linking note, so `[[Attachments/A1.png]]` would read as unresolved here even though
     * a real Obsidian resolves it. The graph SHAPE is what these tests are about, and it is identical.
     */
    app.vault.createSync__(
      'Example/A.md',
      '![[Example/Attachments/A1.png]]\n![[Example/Attachments/A2.png]]\nSee [[B]].'
    );
    app.vault.createSync__(
      'Example/B.md',
      '![[Example/Attachments/B3.png]]\n![[Example/Attachments/B4.png]]\nSee [[C]], and back to [[A]].'
    );
    app.vault.createSync__('Example/C.md', '![[Example/Attachments/A1.png]]');
  }

  function createForest(rootPaths: string[]): ExportForest {
    return new ExportForest({
      resolver: createCountingResolver(),
      roots: rootPaths.map((rootPath) => getAbstractFile(rootPath)),
      settings
    });
  }

  function createCountingResolver(): DependencyResolver {
    const realResolver = new DependencyResolver({
      app: app.asOriginalType__(),
      settings
    });

    return strictProxy<DependencyResolver>({
      resolve: (file: TFileOriginal) => {
        resolvedPaths.push(file.path);
        return realResolver.resolve(file);
      }
    });
  }

  function getAbstractFile(path: string): TAbstractFileOriginal {
    const folder = app.vault.getFolderByPath(path);

    if (folder) {
      return castTo<TFolderOriginal>(folder.asOriginalType2__());
    }

    const file = app.vault.getFileByPath(path);

    if (!file) {
      throw new Error(`No such file: ${path}`);
    }

    return castTo<TFileOriginal>(file.asOriginalType__());
  }

  /**
   * Finds the node a path occupies under a parent, so tests can talk about "the `A` under `B`" rather
   * than about node ids.
   */
  function findChild(forest: ExportForest, parentId: NodeId, path: string): NodeId {
    const childId = forest.getNode(parentId).childIds.find((id) => forest.getNode(id).path === path);

    if (childId === undefined) {
      throw new Error(`No child ${path} under ${parentId}`);
    }

    return childId;
  }

  function getCheckedPaths(forest: ExportForest, parentId: NodeId): string[] {
    return forest.getNode(parentId).childIds
      .filter((id) => forest.isChecked(id))
      .map((id) => forest.getNode(id).path);
  }

  describe('roots', () => {
    it('should take a note root as a checked root of its own', () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootIds = forest.getRootIds();

      expect(rootIds).toHaveLength(1);
      expect(forest.getNode(rootIds[0] ?? '')).toMatchObject({
        depth: 0,
        kind: DependencyKind.Note,
        path: 'Example/A.md'
      });
      expect(forest.isChecked(rootIds[0] ?? '')).toBe(true);
    });

    it('should take an attachment root as a root too', () => {
      createExampleGraph();
      const forest = createForest(['Example/Attachments/A1.png']);

      expect(forest.getNode(forest.getRootIds()[0] ?? '').kind).toBe(DependencyKind.Attachment);
      expect(forest.getExportPaths()).toEqual(['Example/Attachments/A1.png']);
    });

    it('should keep several roots in the order the user supplied them', () => {
      createExampleGraph();
      const forest = createForest(['Example/C.md', 'Example/A.md']);

      expect(forest.getRootIds().map((id) => forest.getNode(id).path)).toEqual(['Example/C.md', 'Example/A.md']);
    });

    it('should expand a folder root into its notes, leaving its attachments out', () => {
      createExampleGraph();
      const forest = createForest(['Example']);

      expect(forest.getRootIds().map((id) => forest.getNode(id).path)).toEqual([
        'Example/A.md',
        'Example/B.md',
        'Example/C.md'
      ]);
    });

    it('should not descend into subfolders when the setting is off', () => {
      settings.shouldIncludeSubfolders = false;
      app.vault.createFolderSync__('Docs');
      app.vault.createFolderSync__('Docs/Nested');
      app.vault.createSync__('Docs/Top.md', '# Top');
      app.vault.createSync__('Docs/Nested/Deep.md', '# Deep');

      expect(createForest(['Docs']).getRootIds()).toHaveLength(1);
    });

    it('should descend into subfolders when the setting is on', () => {
      app.vault.createFolderSync__('Docs');
      app.vault.createFolderSync__('Docs/Nested');
      app.vault.createSync__('Docs/Top.md', '# Top');
      app.vault.createSync__('Docs/Nested/Deep.md', '# Deep');

      expect(createForest(['Docs']).getRootIds().map((id) => createForest(['Docs']).getNode(id).path)).toHaveLength(2);
    });

    /*
     * The same note picked twice - say as a root and inside a folder root - must not get two live
     * checkboxes.
     */
    it('should make a repeated root a mirror of the first occurrence', () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md', 'Example']);
      const rootIds = forest.getRootIds();

      expect(forest.isOwner(rootIds[0] ?? '')).toBe(true);
      expect(forest.isOwner(rootIds[1] ?? '')).toBe(false);
      expect(forest.getNode(rootIds[1] ?? '').ownerId).toBe(rootIds[0]);
    });
  });

  describe('the default check policy', () => {
    it('should bring attachments in checked and linked notes in unchecked', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      expect(getCheckedPaths(forest, rootId)).toEqual([
        'Example/Attachments/A1.png',
        'Example/Attachments/A2.png'
      ]);
      expect(forest.isChecked(findChild(forest, rootId, 'Example/B.md'))).toBe(false);
    });

    it('should honour the per-category settings when they are flipped', async () => {
      settings.shouldCheckAttachmentsByDefault = false;
      settings.shouldCheckLinkedNotesByDefault = true;
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      expect(getCheckedPaths(forest, rootId)).toEqual(['Example/B.md']);
    });

    it('should never check an unresolved link, which has no file to export', async () => {
      app.vault.createSync__('A.md', 'See [[Missing]].');
      const forest = createForest(['A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const missingId = findChild(forest, rootId, 'Missing');
      expect(forest.getNode(missingId).kind).toBe(DependencyKind.Unresolved);
      expect(forest.isChecked(missingId)).toBe(false);
      expect(forest.getExportPaths()).toEqual(['A.md']);
    });

    it('should refuse to check an unresolved link even when asked directly', async () => {
      app.vault.createSync__('A.md', 'See [[Missing]].');
      const forest = createForest(['A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const missingId = findChild(forest, rootId, 'Missing');
      await forest.setChecked(missingId, true);

      expect(forest.isChecked(missingId)).toBe(false);
    });
  });

  describe('expand on tick', () => {
    it('should expand a note when it is ticked, applying the defaults one level deeper', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.setChecked(bId, true);

      expect(forest.getNode(bId).isExpanded).toBe(true);

      /*
       * `A` is in there because `B` links back to it and that repeat mirrors the checked root - the
       * per-category defaults only ever apply to a path being seen for the first time.
       */
      expect(getCheckedPaths(forest, bId)).toEqual([
        'Example/Attachments/B3.png',
        'Example/Attachments/B4.png',
        'Example/A.md'
      ]);
      expect(forest.isChecked(findChild(forest, bId, 'Example/C.md'))).toBe(false);
    });

    /*
     * The premise of the whole plugin: a folder root can be thousands of notes, so the closure must never
     * be computed up front.
     */
    it('should never resolve a node the user has not opened', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);

      expect(resolvedPaths).toEqual([]);

      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      expect(resolvedPaths).toEqual(['Example/A.md']);

      await forest.setChecked(findChild(forest, rootId, 'Example/B.md'), true);

      expect(resolvedPaths).toEqual(['Example/A.md', 'Example/B.md']);
      expect(resolvedPaths).not.toContain('Example/C.md');
    });

    it('should resolve a node only once however often it is expanded', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';

      await forest.expand(rootId);
      forest.collapse(rootId);
      await forest.expand(rootId);

      expect(resolvedPaths).toEqual(['Example/A.md']);
    });

    it('should never resolve an attachment, which has no links to walk', async () => {
      createExampleGraph();
      const forest = createForest(['Example/Attachments/A1.png']);
      await forest.expand(forest.getRootIds()[0] ?? '');

      expect(resolvedPaths).toEqual([]);
    });

    it('should stop expanding at the traversal cap', async () => {
      settings.maxTraversalDepth = 1;
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.expand(bId);

      expect(forest.getNode(bId).childIds).toEqual([]);
      expect(resolvedPaths).toEqual(['Example/A.md']);
    });
  });

  describe('cycles, diamonds and repeats', () => {
    it('should render the cycle back to A as a disabled repeat that does not expand', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.expand(bId);

      const repeatedAId = findChild(forest, bId, 'Example/A.md');
      expect(forest.isOwner(repeatedAId)).toBe(false);
      expect(forest.getNode(repeatedAId).ownerId).toBe(rootId);

      await forest.expand(repeatedAId);

      expect(forest.getNode(repeatedAId).childIds).toEqual([]);
      expect(forest.getNode(repeatedAId).isExpanded).toBe(false);
    });

    it('should mirror the owner state on a repeat, including when the owner is unchecked', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.expand(bId);
      const repeatedAId = findChild(forest, bId, 'Example/A.md');

      expect(forest.isChecked(repeatedAId)).toBe(true);

      await forest.setChecked(rootId, false);

      expect(forest.isChecked(repeatedAId)).toBe(false);
    });

    it('should export a diamond target once, owned by the first occurrence', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.setChecked(bId, true);
      const cId = findChild(forest, bId, 'Example/C.md');
      await forest.setChecked(cId, true);

      const ownedA1Id = findChild(forest, rootId, 'Example/Attachments/A1.png');
      const repeatedA1Id = findChild(forest, cId, 'Example/Attachments/A1.png');

      expect(forest.isOwner(ownedA1Id)).toBe(true);
      expect(forest.isOwner(repeatedA1Id)).toBe(false);
      expect(forest.getExportPaths().filter((path) => path === 'Example/Attachments/A1.png')).toHaveLength(1);
    });

    /*
     * A member of a folder root reached as a sibling's dependency is already a root, so its occurrence
     * under the sibling is a repeat rather than a second subtree.
     */
    it('should not re-expand a folder root member reached through a sibling', async () => {
      createExampleGraph();
      const forest = createForest(['Example']);
      const [aRootId = '', bRootId = ''] = forest.getRootIds();
      await forest.expand(aRootId);

      const bUnderA = findChild(forest, aRootId, 'Example/B.md');
      expect(forest.isOwner(bUnderA)).toBe(false);
      expect(forest.getNode(bUnderA).ownerId).toBe(bRootId);

      await forest.expand(bUnderA);
      expect(resolvedPaths).toEqual(['Example/A.md']);
    });

    it('should give ownership to whichever root comes first', () => {
      createExampleGraph();
      const forest = createForest(['Example/C.md', 'Example/A.md', 'Example/C.md']);
      const rootIds = forest.getRootIds();

      expect(forest.isOwner(rootIds[0] ?? '')).toBe(true);
      expect(forest.isOwner(rootIds[2] ?? '')).toBe(false);
      expect(forest.getNode(rootIds[2] ?? '').ownerId).toBe(rootIds[0]);
    });
  });

  describe('unchecking', () => {
    it('should drop the dependencies the unchecked note had pulled in', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.setChecked(bId, true);

      expect(forest.getExportPaths()).toContain('Example/Attachments/B3.png');

      await forest.setChecked(bId, false);

      expect(forest.getExportPaths()).not.toContain('Example/Attachments/B3.png');
      expect(forest.getExportPaths()).not.toContain('Example/Attachments/B4.png');
    });

    /*
     * `A1.png` hangs off both `A` and `C`. Unchecking `C` must not take it away while `A` still holds it.
     */
    it('should keep a dependency another checked note still holds', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.setChecked(bId, true);
      const cId = findChild(forest, bId, 'Example/C.md');
      await forest.setChecked(cId, true);
      await forest.setChecked(cId, false);

      expect(forest.getExportPaths()).toContain('Example/Attachments/A1.png');
    });

    it('should never drop a path the user picked as a root', async () => {
      createExampleGraph();
      const forest = createForest(['Example']);
      const [aRootId = ''] = forest.getRootIds();
      await forest.expand(aRootId);
      await forest.setChecked(aRootId, false);

      expect(forest.getExportPaths()).toContain('Example/B.md');
    });

    it('should cascade through a chain of dependencies', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);

      const bId = findChild(forest, rootId, 'Example/B.md');
      await forest.setChecked(bId, true);
      const cId = findChild(forest, bId, 'Example/C.md');
      await forest.setChecked(cId, true);

      await forest.setChecked(bId, false);

      expect(forest.isChecked(cId)).toBe(false);
      expect(forest.getExportPaths()).not.toContain('Example/Attachments/B3.png');
    });
  });

  describe('totals and bulk actions', () => {
    it('should count the export and add up its bytes', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      await forest.expand(forest.getRootIds()[0] ?? '');

      const totals = forest.getTotals();
      const expectedBytes = ['Example/A.md', 'Example/Attachments/A1.png', 'Example/Attachments/A2.png']
        .reduce((total, path) => total + (app.vault.getFileByPath(path)?.stat.size ?? 0), 0);

      expect(totals.fileCount).toBe(3);
      expect(totals.totalBytes).toBe(expectedBytes);
    });

    it('should report an empty export when everything is cleared', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      await forest.expand(forest.getRootIds()[0] ?? '');
      forest.clear();

      expect(forest.getExportPaths()).toEqual([]);
      expect(forest.getTotals()).toEqual({
        fileCount: 0,
        totalBytes: 0
      });
    });

    it('should check every attachment in the tree', async () => {
      settings.shouldCheckAttachmentsByDefault = false;
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      await forest.expand(forest.getRootIds()[0] ?? '');
      forest.checkAllAttachments();

      expect(forest.getExportPaths()).toEqual([
        'Example/A.md',
        'Example/Attachments/A1.png',
        'Example/Attachments/A2.png'
      ]);
    });

    it('should invert every path that has a file behind it', async () => {
      app.vault.createSync__('A1.png', 'a1');
      app.vault.createSync__('A.md', '![[A1.png]]\nSee [[Missing]].');
      const forest = createForest(['A.md']);
      await forest.expand(forest.getRootIds()[0] ?? '');
      forest.invert();

      expect(forest.getExportPaths()).toEqual([]);

      forest.invert();

      expect(forest.getExportPaths()).toEqual(['A.md', 'A1.png']);
    });

    it('should collapse every node', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      const rootId = forest.getRootIds()[0] ?? '';
      await forest.expand(rootId);
      forest.collapseAll();

      expect(forest.getNode(rootId).isExpanded).toBe(false);
    });

    it('should expand everything reachable, bounded by the traversal cap', async () => {
      createExampleGraph();
      const forest = createForest(['Example/A.md']);
      await forest.expandAll();

      expect(resolvedPaths).toEqual(['Example/A.md', 'Example/B.md', 'Example/C.md']);
    });
  });

  it('should throw for an unknown node id', () => {
    createExampleGraph();
    expect(() => createForest(['Example/A.md']).getNode('nope')).toThrow('Unknown node: nope');
  });
});
