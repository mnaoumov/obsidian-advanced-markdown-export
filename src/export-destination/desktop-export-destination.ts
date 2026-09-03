import {
  mkdir,
  writeFile
} from 'node:fs/promises';
import {
  dirname,
  join
} from 'node:path';
import { noopAsync } from 'obsidian-dev-utils/function';

import type { ExportTarget } from '../export-writer.ts';
import type {
  ExportDestination,
  ResolvedExportTarget,
  ResolveExportTargetParams
} from './export-destination.ts';

import { ZipExportTarget } from '../export-targets/zip-export-target.ts';

type DesktopExportDestinationResolveTargetParams = ResolveExportTargetParams;

/**
 * Writes the bundle as a folder outside the vault, keeping each file's vault-relative path beneath it.
 */
class DesktopFolderExportTarget implements ExportTarget {
  public constructor(private readonly bundleFolderPath: string) {}

  public finish(): Promise<void> {
    // Each file is written as it arrives, so there is nothing left to do.
    return noopAsync();
  }

  public async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    const path = join(this.bundleFolderPath, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
}

/**
 * Writes the bundle wherever the user points the system directory picker - the reason the plugin can hand
 * someone a folder that is not inside their vault.
 *
 * `window.electron` is unofficial API, fully typed by `obsidian-typings`. It needs no presence check here:
 * this module is only ever imported behind `Platform.isDesktopApp`, which is exactly the "running inside
 * Electron" test.
 */
export class DesktopExportDestination implements ExportDestination {
  public async resolveTarget(params: DesktopExportDestinationResolveTargetParams): Promise<null | ResolvedExportTarget> {
    const result = await window.electron.remote.dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose where to write the export'
    });
    const directoryPath = result.canceled ? undefined : result.filePaths[0];

    if (directoryPath === undefined) {
      return null;
    }

    const bundlePath = join(directoryPath, params.bundleName);

    if (params.settings.shouldCreateZip) {
      const archivePath = `${bundlePath}.zip`;
      return {
        description: archivePath,
        target: new ZipExportTarget({
          sink: async (archive: Uint8Array): Promise<void> => {
            await mkdir(dirname(archivePath), { recursive: true });
            await writeFile(archivePath, archive);
          }
        })
      };
    }

    return {
      description: bundlePath,
      target: new DesktopFolderExportTarget(bundlePath)
    };
  }
}
