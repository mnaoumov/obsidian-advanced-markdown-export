import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import {
  strFromU8,
  unzipSync
} from 'fflate';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { RenderedNote } from './note-renderer.ts';

import {
  buildEpubFromNotes,
  getChapterFileName
} from './epub-export.ts';

describe('buildEpubFromNotes', () => {
  let app: AppOriginal;
  let mockApp: App;

  beforeEach(() => {
    mockApp = App.createConfigured__();
    app = mockApp.asOriginalType__();
  });

  function getFile(path: string): TFile {
    const file = app.vault.getFileByPath(path);

    if (!file) {
      throw new Error(`No such file: ${path}`);
    }

    return file;
  }

  function createNote(path: string, anchorId: string, html: string): RenderedNote {
    const element = createDiv({ cls: 'advanced-markdown-export-document-note' });
    element.id = anchorId;
    element.append(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
    const file = getFile(path);
    return { anchorId, element, file, title: file.basename };
  }

  async function build(notes: RenderedNote[]): Promise<Record<string, string>> {
    const entries = unzipSync(await buildEpubFromNotes({ app, modified: new Date(0), notes, title: 'Book' }));
    return Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, path.endsWith('.png') ? String(data.length) : strFromU8(data)]));
  }

  it('should name a chapter after its anchor', () => {
    expect(getChapterFileName('note-3')).toBe('note-3.xhtml');
  });

  it('should write each note as a well-formed XHTML chapter, without what a book cannot carry', async () => {
    mockApp.vault.createSync__('A.md', 'x');
    mockApp.vault.createSync__('B.md', 'y');

    const entries = await build([
      createNote('A.md', 'note-1', '<h1>A</h1><p>One<br>two</p><script>alert(1)</script><iframe></iframe><a href="note-2.xhtml">B</a>'),
      createNote('B.md', 'note-2', '<h1>B</h1>')
    ]);
    const chapter = entries['OEBPS/text/note-1.xhtml'] ?? '';

    expect(chapter).toContain('<p>One<br />two</p>');
    expect(chapter).toContain('<a href="note-2.xhtml">B</a>');
    expect(chapter).not.toContain('script');
    expect(chapter).not.toContain('iframe');
    expect(new DOMParser().parseFromString(chapter, 'application/xhtml+xml').querySelector('parsererror')).toBeNull();
    expect(entries['OEBPS/nav.xhtml']).toContain('<li><a href="text/note-2.xhtml">B</a></li>');
  });

  it('should pack each embedded vault image once, and point every embed of it at the packed copy', async () => {
    mockApp.vault.createSync__('A.md', 'x');
    mockApp.vault.createSync__('B.md', 'y');
    await app.vault.createBinary('Pic.png', new Uint8Array([1, 2, 3]).buffer);

    const embed = '<span class="internal-embed" src="Pic.png"><img src="app://local/Pic.png" srcset="x 2x"></span>';
    const entries = await build([createNote('A.md', 'note-1', embed), createNote('B.md', 'note-2', embed)]);

    expect(entries['OEBPS/text/media/media-1.png']).toBe('3');
    expect(Object.keys(entries).filter((path) => path.includes('/media/'))).toHaveLength(1);
    expect(entries['OEBPS/text/note-2.xhtml']).toContain('<img src="media/media-1.png" />');
  });

  it('should keep a remote image and replace any other image with its alt text', async () => {
    mockApp.vault.createSync__('A.md', 'x');

    const entries = await build([
      createNote(
        'A.md',
        'note-1',
        '<img src="https://example.com/a.png"><img src="app://local/x.png" alt="local alt"><span class="internal-embed" src="Missing.png"><img alt="missing"></span><span class="internal-embed"><img></span>'
      )
    ]);
    const chapter = entries['OEBPS/text/note-1.xhtml'] ?? '';

    expect(chapter).toContain('<img src="https://example.com/a.png" />');
    expect(chapter).toContain('local alt');
    expect(chapter).toContain('missing');
    expect(chapter.match(/<img/g)).toHaveLength(1);
  });
});
