/*
 * The `/browser` subpath is deliberate and load-bearing - never shorten it to plain `fflate`.
 *
 * `fflate`'s `exports['.']` map lists its `node` condition FIRST, and the plugin bundler runs esbuild with
 * `platform: 'node'`, which puts `node` back into the active conditions even though `conditions: ['browser']`
 * asks for the browser build. Bare `fflate` therefore bundles `esm/index.mjs`, whose first two lines are
 * `import { createRequire } from 'module'` - so the module body throws `createRequire is not a function` the
 * moment its body loads on a phone, taking the whole mobile export path down with it.
 *
 * The `/browser` subpath has no `node` condition to lose to, and nothing here needs the Node build:
 * `zipSync` is synchronous and touches none of the `worker_threads` machinery that build exists to add.
 */
import { zipSync } from 'fflate/browser';
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
