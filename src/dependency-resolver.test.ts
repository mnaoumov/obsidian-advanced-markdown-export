import type { TFile as TFileOriginal } from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  DependencyKind,
  DependencyResolver
} from './dependency-resolver.ts';
import { PluginSettings } from './plugin-settings.ts';

/*
 * Nothing is stubbed: the unit-test project loads `obsidian-test-mocks/obsidian-typings/vitest-setup`,
 * which bridges the `computeMetadataAsync` / `fileCache` / `metadataCache` members `getCacheSafe` reaches
 * for. So these tests run the real `getCacheSafe`, the real `getLinks` and the real link parsing over
 * genuine wikilinks and embeds, rather than over hand-built cache objects.
 */
describe('DependencyResolver', () => {
  let app: App;
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    settings = new PluginSettings();
  });

  function createFile(path: string, content = ''): TFileOriginal {
    return castTo<TFileOriginal>(app.vault.createSync__(path, content).asOriginalType__());
  }

  function createResolver(): DependencyResolver {
    return new DependencyResolver({
      app: app.asOriginalType__(),
      settings
    });
  }

  async function resolve(path: string, content: string): Promise<ReturnType<DependencyResolver['resolve']>> {
    const file = createFile(path, content);
    return createResolver().resolve(file);
  }

  it('should resolve a wikilink to a note', async () => {
    createFile('B.md', '# B');
    const dependencies = await resolve('A.md', 'See [[B]].');

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]).toMatchObject({
      isEmbed: false,
      kind: DependencyKind.Note,
      path: 'B.md',
      subpath: ''
    });
  });

  it('should resolve a markdown link to a note', async () => {
    createFile('B.md', '# B');
    const dependencies = await resolve('A.md', 'See [B](B.md).');

    expect(dependencies.map((dependency) => dependency.path)).toEqual(['B.md']);
    expect(dependencies[0]?.kind).toBe(DependencyKind.Note);
  });

  it('should classify an embedded image as an attachment', async () => {
    createFile('A1.png', 'binary');
    const dependencies = await resolve('A.md', '![[A1.png]]');

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]).toMatchObject({
      isEmbed: true,
      kind: DependencyKind.Attachment,
      path: 'A1.png'
    });
  });

  it('should classify a linked - not embedded - image as an attachment too', async () => {
    createFile('A1.png', 'binary');
    const dependencies = await resolve('A.md', '[[A1.png]]');

    expect(dependencies[0]).toMatchObject({
      isEmbed: false,
      kind: DependencyKind.Attachment
    });
  });

  it('should keep an embedded note a note by default', async () => {
    createFile('B.md', '# B');
    const dependencies = await resolve('A.md', '![[B]]');

    expect(dependencies[0]).toMatchObject({
      isEmbed: true,
      kind: DependencyKind.Note
    });
  });

  /*
   * An embedded note reads as part of its host, so the setting lets it inherit the attachment default
   * instead of the linked-note one.
   */
  it('should treat an embedded note as an attachment when the setting says so', async () => {
    settings.shouldTreatEmbedsAsAttachments = true;
    createFile('B.md', '# B');
    const dependencies = await resolve('A.md', '![[B]]');

    expect(dependencies[0]?.kind).toBe(DependencyKind.Attachment);
  });

  /*
   * Frontmatter links are the single biggest thing every competitor misses, because they all parse raw
   * content with regular expressions rather than reading the metadata cache.
   */
  it('should resolve a frontmatter link', async () => {
    createFile('B.md', '# B');
    const dependencies = await resolve('A.md', '---\nrelated: "[[B]]"\n---\n\nBody with no links.');

    expect(dependencies.map((dependency) => dependency.path)).toEqual(['B.md']);
  });

  it('should split the subpath off a heading link', async () => {
    createFile('B.md', '# B\n\n## Section');
    const dependencies = await resolve('A.md', 'See [[B#Section]].');

    expect(dependencies[0]).toMatchObject({
      path: 'B.md',
      subpath: '#Section'
    });
  });

  it('should report an unresolved link with its link path and no file', async () => {
    const dependencies = await resolve('A.md', 'See [[Missing]].');

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]).toMatchObject({
      file: null,
      kind: DependencyKind.Unresolved,
      path: 'Missing'
    });
  });

  it('should report a file linked twice only once', async () => {
    createFile('B.md', '# B');
    const dependencies = await resolve('A.md', 'See [[B]], and again [[B]], and embedded ![[B]].');

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]?.isEmbed).toBe(false);
  });

  it('should resolve nothing for an attachment, which has no links to walk', async () => {
    const file = createFile('A1.png', 'binary');
    expect(await createResolver().resolve(file)).toEqual([]);
  });

  it('should resolve nothing when the note has no cache', async () => {
    const file = createFile('A.md', 'See [[B]].');
    app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);

    expect(await createResolver().resolve(file)).toEqual([]);
  });

  it('should resolve nothing for a note with no links at all', async () => {
    expect(await resolve('A.md', '# A\n\nJust prose.')).toEqual([]);
  });

  describe('canvas files', () => {
    it('should resolve a canvas file node as an embed', async () => {
      createFile('B.md', '# B');
      const canvasContent = JSON.stringify({
        edges: [],
        nodes: [{
          file: 'B.md',
          height: 100,
          id: 'node-1',
          type: 'file',
          width: 100,
          x: 0,
          y: 0
        }]
      });
      const dependencies = await resolve('Board.canvas', canvasContent);

      expect(dependencies).toHaveLength(1);
      expect(dependencies[0]).toMatchObject({
        isEmbed: true,
        kind: DependencyKind.Note,
        path: 'B.md'
      });
    });

    it('should resolve nothing for a canvas holding no nodes', async () => {
      expect(await resolve('Board.canvas', JSON.stringify({ edges: [], nodes: [] }))).toEqual([]);
    });
  });

  describe('the ignore filters', () => {
    it('should drop a dependency inside an ignored folder', async () => {
      settings.ignoredFolders = ['Archive'];
      app.vault.createFolderSync__('Archive');
      createFile('Archive/B.md', '# B');
      createFile('C.md', '# C');

      const dependencies = await resolve('A.md', 'See [[Archive/B]] and [[C]].');

      expect(dependencies.map((dependency) => dependency.path)).toEqual(['C.md']);
    });

    it('should tolerate a trailing slash on an ignored folder', async () => {
      settings.ignoredFolders = ['Archive/'];
      app.vault.createFolderSync__('Archive');
      createFile('Archive/B.md', '# B');

      expect(await resolve('A.md', 'See [[Archive/B]].')).toEqual([]);
    });

    /*
     * An empty entry would otherwise prefix-match the whole vault and silently drop every dependency.
     */
    it('should ignore an empty ignored-folder entry rather than dropping everything', async () => {
      settings.ignoredFolders = [''];
      createFile('B.md', '# B');

      expect(await resolve('A.md', 'See [[B]].')).toHaveLength(1);
    });

    it('should not treat a folder name as a prefix of a longer sibling', async () => {
      settings.ignoredFolders = ['Arch'];
      app.vault.createFolderSync__('Archive');
      createFile('Archive/B.md', '# B');

      expect(await resolve('A.md', 'See [[Archive/B]].')).toHaveLength(1);
    });

    it('should drop a note carrying an ignored tag, with or without the hash', async () => {
      settings.ignoredTags = ['draft', '#private'];
      createFile('B.md', '# B\n\n#draft');
      createFile('C.md', '# C\n\n#private');
      createFile('D.md', '# D\n\n#keep');

      const dependencies = await resolve('A.md', 'See [[B]], [[C]] and [[D]].');

      expect(dependencies.map((dependency) => dependency.path)).toEqual(['D.md']);
    });

    it('should keep a dependency whose target carries no tags at all', async () => {
      settings.ignoredTags = ['draft'];
      createFile('B.md', '# B\n\nProse with no tags.');

      expect(await resolve('A.md', 'See [[B]].')).toHaveLength(1);
    });

    /*
     * An attachment has no cache to read tags from, which is a different branch from a note whose cache
     * simply holds no tags.
     */
    it('should keep an attachment dependency, which has no cache to carry tags', async () => {
      settings.ignoredTags = ['draft'];
      createFile('A1.png', 'binary');

      expect(await resolve('A.md', '![[A1.png]]')).toHaveLength(1);
    });

    it('should keep a dependency whose target has no cache', async () => {
      settings.ignoredTags = ['draft'];
      const target = createFile('B.md', '# B\n\n#draft');
      const source = createFile('A.md', 'See [[B]].');
      const sourceCache = app.metadataCache.getFileCache(castTo(source));
      app.metadataCache.getFileCache = vi.fn((file: TFile) => file.path === target.path ? null : sourceCache);

      expect(await createResolver().resolve(source)).toHaveLength(1);
    });

    it('should not consult tags for an unresolved link', async () => {
      settings.ignoredTags = ['draft'];

      expect(await resolve('A.md', 'See [[Missing]].')).toHaveLength(1);
    });
  });
});
