import type { App } from 'obsidian';

import { getOrCreateFolder } from '@mnaoumov/obsidian-lib/file-system';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import {
  dirname,
  join
} from '@mnaoumov/typescript-lib/path';

import type { ExportTarget } from '../export-writer.ts';

import { createBinaryVerified } from './create-binary-verified.ts';

interface VaultFolderExportTargetConstructorParams {
  readonly app: App;
  readonly bundleFolderPath: string;
}

/**
 * Writes the bundle as a folder inside the vault. The cross-platform target: it needs nothing but the
 * vault API, so it is the whole story on mobile and the fallback on desktop.
 */
export class VaultFolderExportTarget implements ExportTarget {
  private readonly app: App;
  private readonly bundleFolderPath: string;

  public constructor(params: VaultFolderExportTargetConstructorParams) {
    this.app = params.app;
    this.bundleFolderPath = params.bundleFolderPath;
  }

  public finish(): Promise<void> {
    // Each file is written as it arrives, so there is nothing left to do.
    return noopAsync();
  }

  public async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    const path = join(this.bundleFolderPath, relativePath);
    await getOrCreateFolder(this.app, dirname(path));
    await createBinaryVerified(this.app, path, data);
  }
}
