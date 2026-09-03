import type {
  App,
  Reference,
  TFile
} from 'obsidian';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/file-system';
import {
  editLinksInContent,
  extractLinkFile,
  splitSubpath
} from 'obsidian-dev-utils/obsidian/link';

import type { ReadonlyPluginSettings } from './plugin-settings.ts';

import { DanglingLinkAction } from './plugin-settings.ts';

/**
 * The parameters for {@link exportBundle}.
 */
export interface ExportBundleParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * The files to write, in the order the tree owns them.
   */
  readonly files: readonly TFile[];

  /**
   * The settings, read for the dangling-link policy.
   */
  readonly settings: ReadonlyPluginSettings;

  /**
   * Where the bundle is written.
   */
  readonly target: ExportTarget;
}

/**
 * Where a bundle goes. The one seam between "which bytes travel" and "where they land", so a folder, a
 * ZIP and an out-of-vault directory all reuse the same traversal and the same link rewriting.
 */
export interface ExportTarget {
  /**
   * Called once, after the last file. A ZIP target compresses here; a folder target has nothing to do.
   *
   * @returns A {@link Promise} that resolves when the bundle is complete.
   */
  finish(): Promise<void>;

  /**
   * Writes one file into the bundle.
   *
   * @param relativePath - The file's vault-relative path, preserved verbatim inside the bundle.
   * @param data - The file's bytes.
   * @returns A {@link Promise} that resolves when the file is written.
   */
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
}

interface ConvertLinkParams {
  readonly app: App;
  readonly exportedPaths: ReadonlySet<string>;
  readonly file: TFile;
  readonly settings: ReadonlyPluginSettings;
}

/**
 * Writes the chosen files into a bundle, keeping every vault-relative path.
 *
 * Preserving the structure is what makes this near-identity work: a link between two included files is
 * still correct in the bundle without being touched at all, and two files with the same name can never
 * collide. Only links pointing OUT of the export need a decision, and that is the dangling-link setting.
 *
 * Link rewriting applies to markdown. Every other file - a canvas included - is copied byte for byte, so
 * a canvas whose node points at an excluded file keeps that node as it was, whatever the dangling-link
 * setting says.
 *
 * @param params - The parameters for the export.
 * @returns A {@link Promise} that resolves when the bundle is complete.
 */
export async function exportBundle(params: ExportBundleParams): Promise<void> {
  const {
    app,
    files,
    settings,
    target
  } = params;
  const exportedPaths = new Set<string>(files.map((file) => file.path));

  for (const file of files) {
    const data = isMarkdownFile(file)
      ? new TextEncoder().encode(
        await rewriteLinks({
          app,
          exportedPaths,
          file,
          settings
        })
      )
      : new Uint8Array(await app.vault.readBinary(file));

    await target.writeFile(file.path, data);
  }

  await target.finish();
}

/**
 * Decides what a single link becomes in the bundle. Returning nothing leaves it exactly as written.
 */
function convertLink(link: Reference, params: ConvertLinkParams): MaybeReturn<string> {
  const targetFile = extractLinkFile({
    app: params.app,
    link,
    sourcePathOrFile: params.file
  });

  /*
   * Nothing to do for a link that already resolves inside the bundle, and nothing sensible to do for one
   * that resolved to nothing in the vault either.
   */
  if (!targetFile || params.exportedPaths.has(targetFile.path)) {
    return;
  }

  if (params.settings.danglingLinkAction === DanglingLinkAction.Remove) {
    return '';
  }

  if (params.settings.danglingLinkAction === DanglingLinkAction.ReplaceWithDisplayText) {
    return link.displayText ?? splitSubpath(link.link).linkPath;
  }
}

async function rewriteLinks(params: ConvertLinkParams): Promise<string> {
  const content = await params.app.vault.read(params.file);
  return editLinksInContent({
    app: params.app,
    content,
    linkConverter: (link) => convertLink(link, params)
  });
}
