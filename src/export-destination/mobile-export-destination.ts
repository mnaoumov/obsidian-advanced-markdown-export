import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import { join } from 'obsidian-dev-utils/path';

import type {
  ExportDestination,
  ResolvedExportTarget,
  ResolveExportTargetParams
} from './export-destination.ts';

import { VaultFolderExportTarget } from '../export-targets/vault-folder-export-target.ts';
import { ZipExportTarget } from '../export-targets/zip-export-target.ts';
import { toArrayBuffer } from '../to-array-buffer.ts';

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
      return {
        description: archivePath,
        target: new ZipExportTarget({
          sink: async (archive: Uint8Array): Promise<void> => {
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
