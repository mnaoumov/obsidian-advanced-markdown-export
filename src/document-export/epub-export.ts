import type {
  App,
  TFile
} from 'obsidian';

import {
  getLanguage,
  parseLinktext
} from 'obsidian';

import type {
  EpubChapter,
  EpubResource
} from './epub-builder.ts';
import type { RenderedNote } from './note-renderer.ts';

import { buildEpub } from './epub-builder.ts';

/**
 * Elements a book cannot carry: scripts, live frames and players, and canvases whose pixels do not survive
 * serialization.
 */
const UNSUPPORTED_SELECTOR = 'audio, canvas, embed, iframe, object, script, style, video';

/**
 * The parameters for {@link buildEpubFromNotes}.
 */
export interface BuildEpubFromNotesParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * When the book was made.
   */
  readonly modified: Date;

  /**
   * The rendered notes, in reading order. Their links must already point at `<anchorId>.xhtml`.
   */
  readonly notes: readonly RenderedNote[];

  /**
   * The book's title.
   */
  readonly title: string;
}

/**
 * Turns rendered notes into an EPUB book: one chapter per note, every image embedded from the vault
 * packed in beside it.
 *
 * An image is packed when the embed around it resolves to a vault file; one image file embedded twice is
 * packed once. A remote image keeps its URL, and any other image - one with nothing in the vault behind
 * it - is replaced by its alt text, because a book cannot reach `app://`.
 *
 * @param params - The parameters.
 * @returns The book's bytes.
 */
export async function buildEpubFromNotes(params: BuildEpubFromNotesParams): Promise<Uint8Array> {
  const resourceFileNamesByPath = new Map<string, string>();
  const resources: EpubResource[] = [];
  const chapters: EpubChapter[] = [];
  const serializer = new XMLSerializer();

  for (const note of params.notes) {
    const clone = note.element.cloneNode(true) as HTMLElement;

    for (const el of clone.querySelectorAll(UNSUPPORTED_SELECTOR)) {
      el.remove();
    }

    for (const imgEl of clone.querySelectorAll('img')) {
      const imageFile = resolveEmbeddedFile(params.app, imgEl, note.file.path);

      if (imageFile) {
        let fileName = resourceFileNamesByPath.get(imageFile.path);

        if (fileName === undefined) {
          fileName = `media-${String(resources.length + 1)}.${imageFile.extension}`;
          resourceFileNamesByPath.set(imageFile.path, fileName);
          resources.push({
            data: new Uint8Array(await params.app.vault.readBinary(imageFile)),
            fileName
          });
        }

        imgEl.setAttribute('src', `media/${fileName}`);
        imgEl.removeAttribute('srcset');
        continue;
      }

      if (!/^https?:/i.test(imgEl.getAttribute('src') ?? '')) {
        imgEl.replaceWith(imgEl.alt);
      }
    }

    chapters.push({
      bodyXhtml: serializer.serializeToString(clone),
      fileName: getChapterFileName(note.anchorId),
      title: note.title
    });
  }

  return buildEpub({
    chapters,
    identifier: `urn:advanced-markdown-export:${encodeURIComponent(params.title)}:${String(params.modified.getTime())}`,
    language: getLanguage(),
    modified: params.modified,
    resources,
    title: params.title
  });
}

/**
 * The file name a note's chapter is written under, which is also what a link to it points at.
 *
 * @param anchorId - The note's anchor id.
 * @returns The chapter file name.
 */
export function getChapterFileName(anchorId: string): string {
  return `${anchorId}.xhtml`;
}

/**
 * The vault file behind an image: the target of the embed it was rendered for.
 */
function resolveEmbeddedFile(app: App, imgEl: HTMLImageElement, sourcePath: string): null | TFile {
  const src = imgEl.closest('.internal-embed')?.getAttribute('src');

  return src ? app.metadataCache.getFirstLinkpathDest(parseLinktext(src).path, sourcePath) : null;
}
