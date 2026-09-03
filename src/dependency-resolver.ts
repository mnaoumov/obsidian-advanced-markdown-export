import type {
  App,
  Reference,
  TFile
} from 'obsidian';

import { getAllTags } from 'obsidian';
import { getCanvasReferences } from 'obsidian-dev-utils/obsidian/canvas';
import {
  isCanvasFile,
  isNote
} from 'obsidian-dev-utils/obsidian/file-system';
import {
  extractLinkFile,
  splitSubpath
} from 'obsidian-dev-utils/obsidian/link';
import {
  getCacheSafe,
  getLinks
} from 'obsidian-dev-utils/obsidian/metadata-cache';
import { isCanvasFileNodeReference } from 'obsidian-dev-utils/obsidian/reference';

import type { ReadonlyPluginSettings } from './plugin-settings.ts';

/**
 * What a dependency is, which is what decides whether it arrives checked.
 */
export enum DependencyKind {
  /**
   * Anything that is not a note - an image, a PDF, an audio file. Usually part of the note that
   * references it, which is why these default to checked.
   */
  Attachment = 'Attachment',

  /**
   * A note. A separate document, which is why these default to unchecked - including one pulls in its own
   * dependencies too.
   */
  Note = 'Note',

  /**
   * A link that points at nothing. There is no file to export, so the tree greys it out.
   */
  Unresolved = 'Unresolved'
}

/**
 * One direct dependency of a file.
 */
export interface Dependency {
  /**
   * The file the link resolves to, or `null` when the link is unresolved.
   */
  readonly file: null | TFile;

  /**
   * Whether the link that produced this dependency was an embed rather than a plain link.
   */
  readonly isEmbed: boolean;

  /**
   * What kind of dependency this is.
   */
  readonly kind: DependencyKind;

  /**
   * The dependency's vault path, or - when unresolved - the link path that failed to resolve.
   */
  readonly path: string;

  /**
   * The `#heading` / `^block` part of the link, or an empty string when the link had none.
   */
  readonly subpath: string;
}

interface DependencyResolverConstructorParams {
  readonly app: App;
  readonly settings: ReadonlyPluginSettings;
}

interface ResolvedReference {
  readonly isEmbed: boolean;
  readonly reference: Reference;
}

/**
 * Resolves one file's **direct** dependencies, and nothing deeper.
 *
 * Deliberately holds no cache: memoization belongs to {@link ExportForest}, which is what makes its
 * lazy-expansion assertion - that this resolver is never called for a node the user has not opened -
 * meaningful rather than accidental.
 *
 * Every link is read through `obsidian-dev-utils`, never through a regular expression over raw content.
 * That is what makes frontmatter links, code fences and canvas nodes work here when they do not work in
 * the plugins this one was written to replace.
 */
export class DependencyResolver {
  private readonly app: App;
  private readonly settings: ReadonlyPluginSettings;

  public constructor(params: DependencyResolverConstructorParams) {
    this.app = params.app;
    this.settings = params.settings;
  }

  /**
   * Resolves the direct dependencies of a file.
   *
   * @param file - The file to resolve the dependencies of.
   * @returns The dependencies, in link order, de-duplicated by path with the first occurrence kept.
   */
  public async resolve(file: TFile): Promise<Dependency[]> {
    const resolvedReferences = await this.getResolvedReferences(file);
    const dependencies: Dependency[] = [];
    const seenPaths = new Set<string>();

    for (const { isEmbed, reference } of resolvedReferences) {
      const dependency = this.toDependency(file, reference, isEmbed);

      if (seenPaths.has(dependency.path)) {
        continue;
      }

      seenPaths.add(dependency.path);

      if (this.isIgnored(dependency)) {
        continue;
      }

      dependencies.push(dependency);
    }

    return dependencies;
  }

  private async getResolvedReferences(file: TFile): Promise<ResolvedReference[]> {
    if (isCanvasFile(file)) {
      /*
       * Obsidian does not index canvas links into the metadata cache, so the canvas JSON is read directly.
       * A file node displays its file inside the canvas, which is what makes it an embed; a link inside a
       * text node is an ordinary link.
       */
      const canvasReferences = await getCanvasReferences(this.app, file);
      return canvasReferences.map((reference) => ({
        isEmbed: isCanvasFileNodeReference(reference),
        reference
      }));
    }

    if (!isNote(file)) {
      // An attachment has no links to walk.
      return [];
    }

    const cache = await getCacheSafe(this.app, file);

    if (!cache) {
      return [];
    }

    const embeds = new Set<Reference>(cache.embeds);

    // `getLinks` pushes the very objects held by `cache.embeds`, so identity membership marks the embeds.
    return getLinks({ cache }).map((reference) => ({
      isEmbed: embeds.has(reference),
      reference
    }));
  }

  private isIgnored(dependency: Dependency): boolean {
    const isInIgnoredFolder = this.settings.ignoredFolders.some((ignoredFolder) => {
      const normalizedFolder = ignoredFolder.replace(/\/+$/, '');
      return normalizedFolder !== '' && dependency.path.startsWith(`${normalizedFolder}/`);
    });

    if (isInIgnoredFolder) {
      return true;
    }

    if (this.settings.ignoredTags.length === 0 || !dependency.file) {
      return false;
    }

    const cache = this.app.metadataCache.getFileCache(dependency.file);

    if (!cache) {
      return false;
    }

    const tags = getAllTags(cache) ?? [];
    return this.settings.ignoredTags.some((ignoredTag) => tags.includes(normalizeTag(ignoredTag)));
  }

  private toDependency(source: TFile, reference: Reference, isEmbed: boolean): Dependency {
    const { linkPath, subpath } = splitSubpath(reference.link);
    const file = extractLinkFile({
      app: this.app,
      link: reference,
      sourcePathOrFile: source
    });

    return {
      file,
      isEmbed,
      kind: this.toKind(file, isEmbed),
      path: file?.path ?? linkPath,
      subpath
    };
  }

  private toKind(file: null | TFile, isEmbed: boolean): DependencyKind {
    if (!file) {
      return DependencyKind.Unresolved;
    }

    if (!isNote(file)) {
      return DependencyKind.Attachment;
    }

    /*
     * An embedded note reads as part of its host, which is the argument for letting it inherit the
     * attachment default rather than the linked-note one.
     */
    return isEmbed && this.settings.shouldTreatEmbedsAsAttachments ? DependencyKind.Attachment : DependencyKind.Note;
  }
}

function normalizeTag(tag: string): string {
  return tag.startsWith('#') ? tag : `#${tag}`;
}
