import type {
  App,
  TFile
} from 'obsidian';

import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
import {
  Component,
  getFrontMatterInfo,
  MarkdownRenderer,
  parseLinktext
} from 'obsidian';

import type { ReadonlyPluginSettings } from '../plugin-settings.ts';

import {
  DEFAULT_SETTLE_IN_MILLISECONDS,
  DEFAULT_TIMEOUT_IN_MILLISECONDS,
  waitForDomToSettle
} from '../code-block-renderer.ts';
import { DanglingLinkAction } from '../plugin-settings.ts';

/**
 * Elements that are controls rather than content: copy buttons, fold arrows, the "open link" icon of an
 * embed. None of them means anything on paper or in a book.
 */
const CONTROL_SELECTOR = [
  'button',
  'input:not([type="checkbox"])',
  '.collapse-indicator',
  '.copy-code-button',
  '.heading-collapse-indicator',
  '.markdown-embed-link'
].join(', ');

/**
 * Turns the anchor id of an exported note into the `href` a link to it gets: a fragment inside one PDF,
 * a chapter file inside an EPUB.
 */
export type NoteHrefResolver = (anchorId: string) => string;

/**
 * One note, rendered.
 */
export interface RenderedNote {
  /**
   * A stable id for the note inside the document, which links to it point at.
   */
  readonly anchorId: string;

  /**
   * The rendered note: its title and its body, links already rewritten.
   */
  readonly element: HTMLElement;

  /**
   * The note.
   */
  readonly file: TFile;

  /**
   * The note's title, its base name.
   */
  readonly title: string;
}

/**
 * The rendered notes, and how to throw them away.
 */
export interface RenderedNotes {
  /**
   * Unloads every renderer child and removes the off-screen host.
   */
  readonly dispose: () => void;

  /**
   * The notes, in export order.
   */
  readonly notes: readonly RenderedNote[];
}

/**
 * The parameters for {@link renderNotes}.
 */
export interface RenderNotesParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * Every chosen file. The notes among them are rendered; every file decides whether a link or an embed
   * still has its target in the export.
   */
  readonly files: readonly TFile[];

  /**
   * How a link to an exported note is written.
   */
  readonly noteHrefResolver: NoteHrefResolver;

  /**
   * The settings, read for the dangling-link policy.
   */
  readonly settings: ReadonlyPluginSettings;

  /**
   * How long a note's DOM must stay unchanged before it counts as rendered.
   */
  readonly settleInMilliseconds?: number;

  /**
   * The most a single note may take to render.
   */
  readonly timeoutInMilliseconds?: number;
}

interface PolicyParams {
  readonly anchorIdsByPath: ReadonlyMap<string, string>;
  readonly app: App;
  readonly exportedPaths: ReadonlySet<string>;
  readonly noteHrefResolver: NoteHrefResolver;
  readonly settings: ReadonlyPluginSettings;
  readonly sourcePath: string;
}

/**
 * Renders the chosen notes the way Reading view shows them, for a document format - a PDF or an EPUB.
 *
 * Each note is rendered with `MarkdownRenderer.render` into a host attached off-screen, and taken once its
 * DOM has gone quiet: plugins such as `Dataview` render after `render` resolves, and Obsidian has no
 * render-complete signal. Its frontmatter is left out and its base name becomes its `h1`.
 *
 * Then the links are settled, because a document has no vault to resolve them in. A link to a note in the
 * export points at that note inside the document. A link or embed whose target is not in it obeys the
 * dangling-link setting: kept (a link becomes an `obsidian://open` URL, an embed stays rendered), replaced
 * by its text, or removed. A link to nothing becomes its text.
 *
 * The caller owns the result and must dispose of it, which unloads every renderer child and removes the
 * host.
 *
 * @param params - The parameters.
 * @returns The rendered notes.
 */
export async function renderNotes(params: RenderNotesParams): Promise<RenderedNotes> {
  const exportedPaths = new Set(params.files.map((file) => file.path));
  const noteFiles = params.files.filter((file) => isMarkdownFile(file));
  const anchorIdsByPath = new Map(noteFiles.map((file, index) => [file.path, getAnchorId(index)]));
  const hostEl = activeDocument.body.createDiv({ cls: 'advanced-markdown-export-render-host' });
  const component = new Component();
  component.load();
  const notes: RenderedNote[] = [];

  function dispose(): void {
    component.unload();
    hostEl.remove();
  }

  try {
    for (const [index, file] of noteFiles.entries()) {
      const anchorId = getAnchorId(index);
      const element = hostEl.createDiv({ cls: 'advanced-markdown-export-document-note markdown-preview-view markdown-rendered' });
      element.id = anchorId;
      element.createEl('h1', { cls: 'advanced-markdown-export-document-title', text: file.basename });
      const bodyEl = element.createDiv({ cls: 'advanced-markdown-export-document-body' });
      const content = await params.app.vault.read(file);
      const settled = waitForDomToSettle(
        bodyEl,
        params.settleInMilliseconds ?? DEFAULT_SETTLE_IN_MILLISECONDS,
        params.timeoutInMilliseconds ?? DEFAULT_TIMEOUT_IN_MILLISECONDS
      );
      await MarkdownRenderer.render(params.app, content.slice(getFrontMatterInfo(content).contentStart), bodyEl, file.path, component);
      await settled;

      for (const controlEl of bodyEl.querySelectorAll(CONTROL_SELECTOR)) {
        controlEl.remove();
      }

      const policyParams: PolicyParams = {
        anchorIdsByPath,
        app: params.app,
        exportedPaths,
        noteHrefResolver: params.noteHrefResolver,
        settings: params.settings,
        sourcePath: file.path
      };
      applyEmbedPolicy(bodyEl, policyParams);
      applyLinkPolicy(bodyEl, policyParams);
      notes.push({ anchorId, element, file, title: file.basename });
    }
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    dispose,
    notes
  };
}

/**
 * Settles each embed whose target did not make the export. An embed of an exported file - and an embed
 * that resolves to nothing, which Obsidian already shows as such - is left as rendered.
 */
function applyEmbedPolicy(bodyEl: HTMLElement, params: PolicyParams): void {
  if (params.settings.danglingLinkAction === DanglingLinkAction.KeepAsIs) {
    return;
  }

  for (const embedEl of bodyEl.querySelectorAll<HTMLElement>('.internal-embed')) {
    // A nested embed may already have gone with the embed holding it.
    if (!embedEl.isConnected) {
      continue;
    }

    const targetFile = resolveLinkTarget(embedEl.getAttribute('src') ?? '', params);

    if (!targetFile || params.exportedPaths.has(targetFile.path)) {
      continue;
    }

    if (params.settings.danglingLinkAction === DanglingLinkAction.Remove) {
      embedEl.remove();
    } else {
      embedEl.replaceWith(embedEl.getAttribute('alt') ?? '');
    }
  }
}

function applyLinkPolicy(bodyEl: HTMLElement, params: PolicyParams): void {
  for (const linkEl of bodyEl.querySelectorAll<HTMLAnchorElement>('a.internal-link')) {
    const targetFile = resolveLinkTarget(linkEl.dataset['href'] ?? '', params);
    const anchorId = targetFile && params.anchorIdsByPath.get(targetFile.path);
    linkEl.removeAttribute('target');

    if (anchorId) {
      linkEl.setAttribute('href', params.noteHrefResolver(anchorId));
      continue;
    }

    if (!targetFile || params.settings.danglingLinkAction === DanglingLinkAction.ReplaceWithDisplayText) {
      linkEl.replaceWith(linkEl.textContent);
      continue;
    }

    if (params.settings.danglingLinkAction === DanglingLinkAction.Remove) {
      linkEl.remove();
      continue;
    }

    linkEl.setAttribute(
      'href',
      `obsidian://open?vault=${encodeURIComponent(params.app.vault.getName())}&file=${encodeURIComponent(targetFile.path)}`
    );
  }
}

function getAnchorId(index: number): string {
  return `note-${String(index + 1)}`;
}

function resolveLinkTarget(linkText: string, params: PolicyParams): null | TFile {
  return params.app.metadataCache.getFirstLinkpathDest(parseLinktext(linkText).path, params.sourcePath);
}
