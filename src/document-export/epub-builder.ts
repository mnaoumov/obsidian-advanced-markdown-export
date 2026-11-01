import type { Zippable } from 'fflate/browser';

import {
  strToU8,
  zipSync
} from 'fflate/browser';

/**
 * The media types EPUB 3 readers must support, plus the common ones they mostly do. Anything else is
 * packed as `application/octet-stream`.
 */
const MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp'
};

const STYLESHEET = `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; word-wrap: break-word; }
code { font-family: monospace; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #999; }
table { border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 0.25em 0.5em; }
`;

/**
 * The parameters for {@link buildEpub}.
 */
export interface BuildEpubParams {
  /**
   * The book's chapters, in reading order.
   */
  readonly chapters: readonly EpubChapter[];

  /**
   * The book's unique identifier, a URN.
   */
  readonly identifier: string;

  /**
   * The book's language, an ISO code.
   */
  readonly language: string;

  /**
   * When the book was made. EPUB 3 requires it, to the second.
   */
  readonly modified: Date;

  /**
   * The files the chapters refer to: images.
   */
  readonly resources: readonly EpubResource[];

  /**
   * The book's title.
   */
  readonly title: string;
}

/**
 * One chapter of a book.
 */
export interface EpubChapter {
  /**
   * The chapter's body content, well-formed XHTML.
   */
  readonly bodyXhtml: string;

  /**
   * The chapter's file name, unique in the book, e.g. `note-1.xhtml`.
   */
  readonly fileName: string;

  /**
   * The chapter's title, for the table of contents.
   */
  readonly title: string;
}

/**
 * One file the chapters refer to.
 */
export interface EpubResource {
  /**
   * The file's bytes.
   */
  readonly data: Uint8Array;

  /**
   * The file's name, unique in the book, e.g. `media-1.png`. A chapter refers to it as `media/<fileName>`.
   */
  readonly fileName: string;
}

/**
 * Packs chapters and their images into an EPUB 3 book, with an NCX table of contents beside the EPUB 3
 * navigation document, so readers that only know EPUB 2 still get one.
 *
 * The container's first entry is `mimetype`, stored uncompressed, which is how a reader recognizes the
 * file. `fflate` writes entries in insertion order, which is what guarantees it.
 *
 * @param params - The parameters.
 * @returns The book's bytes.
 */
export function buildEpub(params: BuildEpubParams): Uint8Array {
  // A list of entries rather than an object literal, so no key sort can ever move `mimetype` off the front.
  const entries: [string, Zippable[string]][] = [
    ['mimetype', [strToU8('application/epub+zip'), { level: 0 }]],
    ['META-INF/container.xml', strToU8(buildContainerXml())],
    ['OEBPS/content.opf', strToU8(buildPackageDocument(params))],
    ['OEBPS/nav.xhtml', strToU8(buildNavigationDocument(params))],
    ['OEBPS/style.css', strToU8(STYLESHEET)],
    ['OEBPS/toc.ncx', strToU8(buildNcx(params))],
    ...params.chapters.map((chapter): [string, Uint8Array] => [
      `OEBPS/text/${chapter.fileName}`,
      strToU8(buildChapterDocument(chapter, params.language))
    ]),
    ...params.resources.map((resource): [string, Uint8Array] => [`OEBPS/text/media/${resource.fileName}`, resource.data])
  ];

  return zipSync(Object.fromEntries(entries));
}

/**
 * Escapes text for an XML text node or attribute value.
 *
 * @param text - The text.
 * @returns The escaped text.
 */
export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}

/**
 * The media type a resource is packed with, from its extension.
 *
 * @param fileName - The resource's file name.
 * @returns The media type.
 */
export function getMediaType(fileName: string): string {
  const extension = /\.(?<extension>[^.]+)$/.exec(fileName)?.groups?.['extension']?.toLowerCase() ?? '';
  return MEDIA_TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

function buildChapterDocument(chapter: EpubChapter, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(chapter.title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
${chapter.bodyXhtml}
</body>
</html>
`;
}

function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;
}

function buildNavigationDocument(params: BuildEpubParams): string {
  const items = params.chapters
    .map((chapter) => `<li><a href="text/${escapeXml(chapter.fileName)}">${escapeXml(chapter.title)}</a></li>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(params.language)}" lang="${escapeXml(params.language)}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(params.title)}</title>
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>${escapeXml(params.title)}</h1>
<ol>
${items}
</ol>
</nav>
</body>
</html>
`;
}

function buildNcx(params: BuildEpubParams): string {
  const navPoints = params.chapters
    .map((chapter, index) => {
      const order = String(index + 1);
      return `<navPoint id="navpoint-${order}" playOrder="${order}"><navLabel><text>${escapeXml(chapter.title)}</text></navLabel><content src="text/${escapeXml(chapter.fileName)}"/></navPoint>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${escapeXml(params.identifier)}"/>
</head>
<docTitle><text>${escapeXml(params.title)}</text></docTitle>
<navMap>
${navPoints}
</navMap>
</ncx>
`;
}

function buildPackageDocument(params: BuildEpubParams): string {
  const chapterItems = params.chapters.map((chapter, index) => `<item id="chapter-${String(index + 1)}" href="text/${escapeXml(chapter.fileName)}" media-type="application/xhtml+xml"/>`);
  const resourceItems = params.resources.map((resource, index) => `<item id="resource-${String(index + 1)}" href="text/media/${escapeXml(resource.fileName)}" media-type="${getMediaType(resource.fileName)}"/>`);
  const spineItems = params.chapters.map((_chapter, index) => `<itemref idref="chapter-${String(index + 1)}"/>`);
  const modified = `${params.modified.toISOString().slice(0, '2000-01-01T00:00:00'.length)}Z`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(params.language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeXml(params.identifier)}</dc:identifier>
<dc:title>${escapeXml(params.title)}</dc:title>
<dc:language>${escapeXml(params.language)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="style" href="style.css" media-type="text/css"/>
${[...chapterItems, ...resourceItems].join('\n')}
</manifest>
<spine toc="ncx">
${spineItems.join('\n')}
</spine>
</package>
`;
}
