import type { App } from 'obsidian';

import { getOrCreateFolder } from '@mnaoumov/obsidian-lib/file-system';
import { prompt } from '@mnaoumov/obsidian-lib/modals/prompt';
import {
  dirname,
  join
} from '@mnaoumov/typescript-lib/path';

import type {
  ExportDestination,
  ResolvedExportFile,
  ResolvedExportTarget,
  ResolveExportFileParams,
  ResolveExportTargetParams
} from './export-destination.ts';

import { createBinaryVerified } from '../export-targets/create-binary-verified.ts';
import { VaultFolderExportTarget } from '../export-targets/vault-folder-export-target.ts';
import { ZipExportTarget } from '../export-targets/zip-export-target.ts';

type MobileExportDestinationResolveFileParams = ResolveExportFileParams;
type MobileExportDestinationResolveTargetParams = ResolveExportTargetParams;

/**
 * Writes the bundle into the vault itself. There is no directory picker on a phone, so the destination is
 * a vault-relative folder - taken from the settings, or asked for once per export when they are empty.
 *
 * On desktop the system directory picker takes over, so this is the mobile story only.
 */
export class MobileExportDestination implements ExportDestination {
  /**
   * A single file lands where a ZIP would: `<output folder>/<bundle name>.<extension>`, or the prompted
   * name when the setting is empty.
   *
   * @param params - The parameters.
   * @returns The resolved file, or `null` when the user backed out.
   */
  public async resolveFile(params: MobileExportDestinationResolveFileParams): Promise<null | ResolvedExportFile> {
    const outputPath = await resolveOutputPath(params);

    if (outputPath === null) {
      return null;
    }

    const filePath = `${outputPath}.${params.extension}`;
    return {
      description: filePath,
      write: (data: Uint8Array): Promise<void> => writeVaultFile(params.app, filePath, data)
    };
  }

  public async resolveTarget(params: MobileExportDestinationResolveTargetParams): Promise<null | ResolvedExportTarget> {
    const outputFolderPath = await resolveOutputPath(params);

    if (outputFolderPath === null) {
      return null;
    }

    if (params.settings.shouldCreateZip) {
      const archivePath = `${outputFolderPath}.zip`;
      return {
        description: archivePath,
        target: new ZipExportTarget({
          sink: (archive: Uint8Array): Promise<void> => writeVaultFile(params.app, archivePath, archive)
        })
      };
    }

    return {
      description: outputFolderPath,
      target: new VaultFolderExportTarget({
        app: params.app,
        bundleFolderPath: outputFolderPath
      })
    };
  }
}

/**
 * Whether a folder path names the vault root, in either of the two spellings `dirname` can answer with.
 *
 * @param folderPath - The vault-relative folder path.
 * @returns `true` when it is the root, which always exists and must never be created.
 */
function isVaultRoot(folderPath: string): boolean {
  return folderPath === '.' || folderPath === '/';
}

/**
 * The vault path an export is written under, without an extension: the configured output folder joined
 * with the bundle name, or whatever the user types when that setting is empty.
 */
async function resolveOutputPath(params: ResolveExportTargetParams): Promise<null | string> {
  return params.settings.outputFolderPath === ''
    ? await prompt({
      app: params.app,
      defaultValue: params.bundleName,
      placeholder: 'Vault-relative folder',
      title: 'Where should the export go?'
    })
    : join(params.settings.outputFolderPath, params.bundleName);
}

/**
 * Writes one file into the vault, creating its folder first.
 *
 * Create the folder, as every sibling write path does. `Vault.createBinary` rejects when the parent is
 * missing and `invokeAsyncSafely` swallows that rejection - so without this an **Output folder** naming a
 * folder the vault has not got exports nothing at all, with no notice and no error on screen. Nothing
 * validates that setting: it is free text.
 *
 * The guard is what the siblings do not need. `dirname` is `posix.dirname`, so a file at the vault root -
 * what the prompt branch produces, since it asks for a name and not a path - answers `.`, and a leading
 * slash typed into the setting answers `/`. Neither is a vault path to create, and the root is always
 * there.
 */
async function writeVaultFile(app: App, filePath: string, data: Uint8Array): Promise<void> {
  const folderPath = dirname(filePath);

  if (!isVaultRoot(folderPath)) {
    await getOrCreateFolder(app, folderPath);
  }

  await createBinaryVerified(app, filePath, data);
}
