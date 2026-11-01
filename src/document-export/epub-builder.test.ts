import {
  strFromU8,
  unzipSync
} from 'fflate';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { BuildEpubParams } from './epub-builder.ts';

import {
  buildEpub,
  escapeXml,
  getMediaType
} from './epub-builder.ts';

const MIMETYPE_DATA_OFFSET = 38;

function createParams(): BuildEpubParams {
  return {
    chapters: [
      { bodyXhtml: '<p>One</p>', fileName: 'note-1.xhtml', title: 'A & B' },
      { bodyXhtml: '<p>Two</p>', fileName: 'note-2.xhtml', title: 'C' }
    ],
    identifier: 'urn:uuid:1234',
    language: 'en',
    modified: new Date('2026-11-01T14:43:24.567Z'),
    resources: [{ data: new Uint8Array([1, 2, 3]), fileName: 'media-1.png' }],
    title: 'Book <1>'
  };
}

describe('buildEpub', () => {
  it('should store the mimetype first and uncompressed, so a reader recognizes the file', () => {
    const epub = buildEpub(createParams());
    const header = strFromU8(epub.slice(0, MIMETYPE_DATA_OFFSET + 'application/epub+zip'.length));

    expect(header.slice(30, MIMETYPE_DATA_OFFSET)).toBe('mimetype');
    expect(header.slice(MIMETYPE_DATA_OFFSET)).toBe('application/epub+zip');
  });

  it('should pack the container, package, navigation, NCX, stylesheet, chapters and media', () => {
    const entries = unzipSync(buildEpub(createParams()));

    expect(Object.keys(entries).sort()).toEqual([
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/style.css',
      'OEBPS/text/media/media-1.png',
      'OEBPS/text/note-1.xhtml',
      'OEBPS/text/note-2.xhtml',
      'OEBPS/toc.ncx',
      'mimetype'
    ]);
    expect(entries['OEBPS/text/media/media-1.png']).toEqual(new Uint8Array([1, 2, 3]));
    expect(strFromU8(entries['META-INF/container.xml'] ?? new Uint8Array())).toContain('full-path="OEBPS/content.opf"');
  });

  it('should list every chapter and resource in the package, in reading order, with the modified time to the second', () => {
    const opf = strFromU8(unzipSync(buildEpub(createParams()))['OEBPS/content.opf'] ?? new Uint8Array());

    expect(opf).toContain('<dc:identifier id="book-id">urn:uuid:1234</dc:identifier>');
    expect(opf).toContain('<dc:title>Book &lt;1&gt;</dc:title>');
    expect(opf).toContain('<meta property="dcterms:modified">2026-11-01T14:43:24Z</meta>');
    expect(opf).toContain('<item id="chapter-1" href="text/note-1.xhtml" media-type="application/xhtml+xml"/>');
    expect(opf).toContain('<item id="resource-1" href="text/media/media-1.png" media-type="image/png"/>');
    expect(opf.indexOf('idref="chapter-1"')).toBeLessThan(opf.indexOf('idref="chapter-2"'));
  });

  it('should give both tables of contents an entry per chapter', () => {
    const entries = unzipSync(buildEpub(createParams()));
    const nav = strFromU8(entries['OEBPS/nav.xhtml'] ?? new Uint8Array());
    const ncx = strFromU8(entries['OEBPS/toc.ncx'] ?? new Uint8Array());

    expect(nav).toContain('<li><a href="text/note-1.xhtml">A &amp; B</a></li>');
    expect(ncx).toContain('<navPoint id="navpoint-2" playOrder="2"><navLabel><text>C</text></navLabel><content src="text/note-2.xhtml"/></navPoint>');
  });

  it('should wrap each chapter body in an XHTML document linking the stylesheet', () => {
    const chapter = strFromU8(unzipSync(buildEpub(createParams()))['OEBPS/text/note-1.xhtml'] ?? new Uint8Array());

    expect(chapter).toContain('<title>A &amp; B</title>');
    expect(chapter).toContain('href="../style.css"');
    expect(chapter).toContain('<body>\n<p>One</p>\n</body>');
  });
});

describe('escapeXml', () => {
  it('should escape the five XML specials', () => {
    expect(escapeXml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });
});

describe('getMediaType', () => {
  it('should know the image types by extension, in any case', () => {
    expect(getMediaType('a.PNG')).toBe('image/png');
    expect(getMediaType('a.jpg')).toBe('image/jpeg');
    expect(getMediaType('a.svg')).toBe('image/svg+xml');
  });

  it('should fall back to octet-stream for an unknown or missing extension', () => {
    expect(getMediaType('a.xyz')).toBe('application/octet-stream');
    expect(getMediaType('README')).toBe('application/octet-stream');
  });
});
