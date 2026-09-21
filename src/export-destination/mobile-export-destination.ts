import { toArrayBuffer } from 'obsidian-dev-utils/array-buffer';
import { getOrCreateFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import {
  dirname,
  join
} from 'obsidian-dev-utils/path';

import type {
  ExportDestination,
  ResolvedExportTarget,
  ResolveExportTargetParams
} from './export-destination.ts';

import { VaultFolderExportTarget } from '../export-targets/vault-folder-export-target.ts';
import { ZipExportTarget } from '../export-targets/zip-export-target.ts';

type MobileExportDestinationResolveTargetParams = ResolveExportTargetParams;

/**
 * Writes the bundle into the vault itself. There is no directory picker on a phone, so the destination is
 * a vault-relative folder - taken from the settings, or asked for once per export when they are empty.
 *
 * On desktop the system directory picker takes over, so this is the mobile story only.
 */
export class MobileExportDestination implements ExportDestination {
  public async resolveTarget(params: MobileExportDestinationResolveTargetParams): Promise<null | ResolvedExportTarget> {
    const outputFolderPath = params.settings.outputFolderPath === ''
      ? await prompt({
        app: params.app,
        defaultValue: params.bundleName,
        placeholder: 'Vault-relative folder',
        title: 'Where should the export go?'
      })
      : join(params.settings.outputFolderPath, params.bundleName);

    if (outputFolderPath === null) {
      return null;
    }

    if (params.settings.shouldCreateZip) {
      const archivePath = `${outputFolderPath}.zip`;
      const archiveFolderPath = dirname(archivePath);
      return {
        description: archivePath,
        target: new ZipExportTarget({
          sink: async (archive: Uint8Array): Promise<void> => {
            /*
             * Create the archive's folder, as all three sibling write paths do. `Vault.createBinary`
             * rejects when the parent is missing and `invokeAsyncSafely` swallows that rejection - so
             * without this an **Output folder** naming a folder the vault has not got exports nothing at
             * all, with no notice and no error on screen. Nothing validates that setting: it is free text.
             *
             * The guard is what the siblings do not need. `dirname` is `posix.dirname`, so a bundle at the
             * vault root - what the prompt branch produces, since it asks for a name and not a path -
             * answers `.`, and a leading slash typed into the setting answers `/`. Neither is a vault path
             * to create, and the root is always there.
             */
            if (!isVaultRoot(archiveFolderPath)) {
              await getOrCreateFolder(params.app, archiveFolderPath);
            }

            await params.app.vault.createBinary(archivePath, toArrayBuffer(archive));
          }
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
