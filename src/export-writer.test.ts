import type { TFile as TFileOriginal } from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { ExportTarget } from './export-writer.ts';

import { exportBundle } from './export-writer.ts';
import {
  DanglingLinkAction,
  PluginSettings
} from './plugin-settings.ts';

/**
 * Keeps whatever it is handed, so a test can assert on the bundle rather than on the filesystem.
 */
class RecordingExportTarget implements ExportTarget {
  public finishCount = 0;
  public readonly writtenFiles = new Map<string, Uint8Array>();

  public finish(): Promise<void> {
    this.finishCount++;
    return noopAsync();
  }

  public writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    this.writtenFiles.set(relativePath, data);
    return noopAsync();
  }
}

describe('exportBundle', () => {
  let app: App;
  let settings: PluginSettings;
  let target: RecordingExportTarget;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();
    target = new RecordingExportTarget();
  });

  /**
   * An attachment has to go in through `createBinary`: the in-memory adapter keeps text and binary in
   * separate stores, and the writer reads an attachment with `readBinary`.
   */
  async function createBinaryFile(path: string, content: string): Promise<TFileOriginal> {
    const encoded = new TextEncoder().encode(content);
    const buffer = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(buffer).set(encoded);
    const file = await app.vault.createBinary(path, buffer);
    return castTo<TFileOriginal>(file.asOriginalType__());
  }

  function createFile(path: string, content = ''): TFileOriginal {
    return castTo<TFileOriginal>(app.vault.createSync__(path, content).asOriginalType__());
  }

  async function exportFiles(files: TFileOriginal[]): Promise<void> {
    await exportBundle({
      app: app.asOriginalType__(),
      files,
      settings,
      target
    });
  }

  function getWrittenText(path: string): string {
    const data = target.writtenFiles.get(path);

    if (!data) {
      throw new Error(`Nothing written at ${path}`);
    }

    return new TextDecoder().decode(data);
  }

  it('should keep every vault-relative path, which is what keeps the links valid', async () => {
    app.vault.createFolderSync__('Example');
    app.vault.createFolderSync__('Example/Attachments');
    const attachment = await createBinaryFile('Example/Attachments/A1.png', 'a1');
    const note = createFile('Example/A.md', '![[Example/Attachments/A1.png]]');

    await exportFiles([note, attachment]);

    expect([...target.writtenFiles.keys()]).toEqual([
      'Example/A.md',
      'Example/Attachments/A1.png'
    ]);
  });

  it('should finish the bundle exactly once', async () => {
    await exportFiles([createFile('A.md', '# A')]);

    expect(target.finishCount).toBe(1);
  });

  it('should copy an attachment byte for byte', async () => {
    const attachment = await createBinaryFile('A1.png', 'raw-bytes');

    await exportFiles([attachment]);

    expect(getWrittenText('A1.png')).toBe('raw-bytes');
  });

  /*
   * The near-identity case, and the reason vault-relative paths are preserved rather than flattened: a
   * link between two included files needs no rewriting at all.
   */
  it('should leave a link between two included files exactly as written', async () => {
    settings.danglingLinkAction = DanglingLinkAction.Remove;
    const target1 = createFile('B.md', '# B');
    const note = createFile('A.md', 'See [[B]] for more.');

    await exportFiles([note, target1]);

    expect(getWrittenText('A.md')).toBe('See [[B]] for more.');
  });

  it('should leave an unresolved link alone whatever the policy says', async () => {
    settings.danglingLinkAction = DanglingLinkAction.Remove;
    const note = createFile('A.md', 'See [[Missing]].');

    await exportFiles([note]);

    expect(getWrittenText('A.md')).toBe('See [[Missing]].');
  });

  describe('a link pointing out of the export', () => {
    async function exportWithout(content: string): Promise<string> {
      createFile('B.md', '# B');
      const note = createFile('A.md', content);
      await exportFiles([note]);
      return getWrittenText('A.md');
    }

    it('should keep it as is by default', async () => {
      expect(await exportWithout('See [[B]] for more.')).toBe('See [[B]] for more.');
    });

    it('should remove it entirely when asked to', async () => {
      settings.danglingLinkAction = DanglingLinkAction.Remove;

      expect(await exportWithout('See [[B]] for more.')).toBe('See  for more.');
    });

    it('should leave the display text behind when asked to', async () => {
      settings.danglingLinkAction = DanglingLinkAction.ReplaceWithDisplayText;

      expect(await exportWithout('See [[B|the other note]] for more.')).toBe('See the other note for more.');
    });

    /*
     * A body wikilink always reports a display text, aliased or not. A FRONTMATTER one only does when it
     * carries an explicit alias - so that is where the fallback to the link path actually earns its keep.
     */
    it('should fall back to the link path when the link carries no display text', async () => {
      settings.danglingLinkAction = DanglingLinkAction.ReplaceWithDisplayText;
      const exported = await exportWithout('---\nrelated: "[[B]]"\n---\n\nBody.');

      // Asserted by content rather than verbatim: rewriting a frontmatter value re-serializes the YAML.
      expect(exported).toContain('related: B');
      expect(exported).not.toContain('[[B]]');
    });

    it('should apply the policy to an embed too', async () => {
      settings.danglingLinkAction = DanglingLinkAction.Remove;

      expect(await exportWithout('Before ![[B]] after.')).toBe('Before  after.');
    });
  });
});
