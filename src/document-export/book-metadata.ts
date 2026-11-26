/*
 * Reading the book's metadata from the root note's properties follows Inkbound
 * (https://github.com/kidpeterpan/inkbound, `src/core/book/metadata.ts`), MIT License,
 * Copyright (c) 2026 kidpeterpan.
 */

import type {
  App,
  TFile
} from 'obsidian';

import { getLanguage } from 'obsidian';

import { getMediaType } from './epub-builder.ts';

/**
 * The shape of a language tag: a two- or three-letter language code, then any number of hyphenated parts.
 */
const LANGUAGE_TAG_REGEXP = /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i;

const WIKILINK_REGEXP = /^!?\[\[(?<target>[^\]|#]*)(?:#[^\]|]*)?(?:\|(?<alias>[^\]]*))?\]\]$/;

const MARKDOWN_LINK_REGEXP = /^!?\[(?<text>[^\]]*)\]\((?<target>[^)]*)\)$/;

/**
 * The book's metadata.
 */
export interface BookMetadata {
  /**
   * The book's authors, in the order the note lists them. Empty when the note names none.
   */
  readonly authors: readonly string[];

  /**
   * The vault image the book's cover is made from, or `null` for a book with no cover.
   */
  readonly coverFile: null | TFile;

  /**
   * The book's language, a language tag.
   */
  readonly language: string;

  /**
   * The book's title.
   */
  readonly title: string;
}

/**
 * The parameters for {@link resolveBookMetadata}.
 */
export interface ResolveBookMetadataParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * The title the book takes when the root note gives none.
   */
  readonly fallbackTitle: string;

  /**
   * The note the export was started from, or `null` when it was started from a folder or a selection.
   */
  readonly rootNote: null | TFile;
}

/**
 * Reads the book's metadata from the root note's properties:
 *
 * - `title`: the book's title;
 * - `author` or `authors`: one name or a list of them;
 * - `language` or `lang`: a language tag such as `en` or `pt-BR`;
 * - `cover`: an image in the vault, as a path, a wikilink or an embed.
 *
 * Each one that is missing, empty or unusable falls back on its own: the title to `fallbackTitle`, the
 * authors to none, the language to Obsidian's interface language, and the cover to none.
 *
 * @param params - The parameters.
 * @returns The book's metadata.
 */
export function resolveBookMetadata(params: ResolveBookMetadataParams): BookMetadata {
  const frontmatter: Record<string, unknown> = params.rootNote ? params.app.metadataCache.getFileCache(params.rootNote)?.frontmatter ?? {} : {};

  return {
    authors: toStrings(frontmatter['author'] ?? frontmatter['authors']).map((author) => toDisplayText(author)).filter((author) => author !== ''),
    coverFile: params.rootNote ? resolveCoverFile(params.app, frontmatter['cover'], params.rootNote.path) : null,
    language: resolveLanguage(frontmatter['language'] ?? frontmatter['lang']),
    title: firstString(frontmatter['title']) ?? params.fallbackTitle
  };
}

function firstString(value: unknown): null | string {
  return toStrings(value)[0] ?? null;
}

/**
 * The link target a property value names: the target of a wikilink or a markdown link, or the value itself.
 */
function getLinkTarget(value: string): string {
  const wikilinkTarget = WIKILINK_REGEXP.exec(value)?.groups?.['target'];

  if (wikilinkTarget !== undefined) {
    return wikilinkTarget.trim();
  }

  const markdownLinkTarget = MARKDOWN_LINK_REGEXP.exec(value)?.groups?.['target'];

  if (markdownLinkTarget !== undefined) {
    const target = markdownLinkTarget.trim().replace(/^<(?<inner>.*)>$/, '$<inner>');

    try {
      return decodeURIComponent(target);
    } catch {
      return target;
    }
  }

  return value;
}

function resolveCoverFile(app: App, value: unknown, sourcePath: string): null | TFile {
  const cover = firstString(value);

  if (cover === null || /^[a-z][a-z0-9+.-]*:/i.test(cover)) {
    return null;
  }

  const file = app.metadataCache.getFirstLinkpathDest(getLinkTarget(cover), sourcePath);
  return file && getMediaType(file.name).startsWith('image/') ? file : null;
}

function resolveLanguage(value: unknown): string {
  const language = firstString(value);
  return language !== null && LANGUAGE_TAG_REGEXP.test(language) ? language : getLanguage();
}

/**
 * The text a reader sees for a property value: a wikilink's alias or target, a markdown link's text.
 */
function toDisplayText(value: string): string {
  const wikilinkGroups = WIKILINK_REGEXP.exec(value)?.groups;

  const text = wikilinkGroups
    // The target group always takes part in a match, if only as an empty string.
    ? wikilinkGroups['alias'] ?? String(wikilinkGroups['target'])
    : MARKDOWN_LINK_REGEXP.exec(value)?.groups?.['text'] ?? value;
  return text.trim();
}

/**
 * The non-empty, trimmed strings in a property value, which may be one string or a list.
 */
function toStrings(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item !== '');
}
