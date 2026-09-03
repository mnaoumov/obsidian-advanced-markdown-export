import { zipSync } from 'fflate';
import { noopAsync } from 'obsidian-dev-utils/function';

import type { ExportTarget } from '../export-writer.ts';

/**
 * Receives the finished archive. Keeping this a callback is what lets the same ZIP target write into the
 * vault on mobile and out to a chosen directory on desktop.
 *
 * @param archive - The archive's bytes.
 * @returns A {@link Promise} that resolves when the archive has been stored.
 */
export type ZipSink = (archive: Uint8Array) => Promise<void>;

interface ZipExportTargetConstructorParams {
  readonly sink: ZipSink;
}

/**
 * Collects the bundle into a single `.zip`, keeping each file at its vault-relative path inside the
 * archive so unzipping reproduces the structure the links rely on.
 */
export class ZipExportTarget implements ExportTarget {
  private readonly entries: Record<string, Uint8Array> = {};
  private readonly sink: ZipSink;

  public constructor(params: ZipExportTargetConstructorParams) {
    this.sink = params.sink;
  }

  public async finish(): Promise<void> {
    await this.sink(zipSync(this.entries));
  }

  public writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    this.entries[relativePath] = data;
    return noopAsync();
  }
}
