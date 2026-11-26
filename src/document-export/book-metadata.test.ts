import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import {
  App,
  getLanguage
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { resolveBookMetadata } from './book-metadata.ts';

describe('resolveBookMetadata', () => {
  let app: AppOriginal;
  let mockApp: App;

  beforeEach(async () => {
    mockApp = App.createConfigured__();
    app = mockApp.asOriginalType__();
    await app.vault.createFolder('Images');
    await app.vault.createBinary('Images/Cover.png', new Uint8Array([1]).buffer);
    mockApp.vault.createSync__('Images/Not an image.md', 'x');
  });

  function resolve(frontmatter: null | string): ReturnType<typeof resolveBookMetadata> {
    const rootNote = mockApp.vault.createSync__('Root.md', frontmatter === null ? 'Body' : `---\n${frontmatter}\n---\nBody`).asOriginalType__() as TFile;
    return resolveBookMetadata({ app, fallbackTitle: 'Fallback', rootNote });
  }

  it('should fall back on every field when the export has no root note', () => {
    expect(resolveBookMetadata({ app, fallbackTitle: 'Fallback', rootNote: null })).toEqual({
      authors: [],
      coverFile: null,
      language: getLanguage(),
      title: 'Fallback'
    });
  });

  it('should fall back on every field when the root note has no properties', () => {
    expect(resolve(null)).toEqual({
      authors: [],
      coverFile: null,
      language: getLanguage(),
      title: 'Fallback'
    });
  });

  it('should read the title, the authors, the language and the cover', () => {
    const metadata = resolve('title: "  The Book "\nauthor:\n  - Ann\n  - "[[People/Bo Smith|Bo]]"\n  - "[[Cy]]"\n  - ""\nlanguage: pt-BR\ncover: "[[Cover.png]]"');

    expect(metadata.title).toBe('The Book');
    expect(metadata.authors).toEqual(['Ann', 'Bo', 'Cy']);
    expect(metadata.language).toBe('pt-BR');
    expect(metadata.coverFile?.path).toBe('Images/Cover.png');
  });

  it('should read the alternative keys, and a single author', () => {
    const metadata = resolve('authors: Ann\nlang: uk');

    expect(metadata.authors).toEqual(['Ann']);
    expect(metadata.language).toBe('uk');
  });

  it.each([
    ['an embed', '"![[Cover.png]]"'],
    ['a path', 'Images/Cover.png'],
    ['a markdown link', '"![cover](Images/Cover.png)"'],
    ['an angle-bracketed markdown link', '"[c](<Images/Cover.png>)"'],
    ['a percent-encoded markdown link', '"[c](Images%2FCover.png)"']
  ])('should resolve a cover given as %s', (_label, value) => {
    expect(resolve(`cover: ${value}`).coverFile?.path).toBe('Images/Cover.png');
  });

  it.each([
    ['a file that is not an image', '"[[Not an image]]"'],
    ['a missing file', 'Missing.png'],
    ['a remote URL', 'https://example.com/cover.png'],
    ['an empty value', '""'],
    ['a markdown link that is not valid percent-encoding', '"[c](Images/Cover%.png)"']
  ])('should give no cover for %s', (_label, value) => {
    expect(resolve(`cover: ${value}`).coverFile).toBeNull();
  });

  it('should fall back to the interface language for a value that is not a language tag', () => {
    expect(resolve('language: English (US)').language).toBe(getLanguage());
  });
});
