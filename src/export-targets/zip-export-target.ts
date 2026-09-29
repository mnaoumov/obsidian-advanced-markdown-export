/*
 * The `/browser` subpath is deliberate - keep it rather than shortening it to plain `fflate`.
 *
 * `fflate`'s `exports['.']` map lists its `node` condition FIRST. The plugin bundler used to run esbuild with
 * `platform: 'node'`, which put `node` back into the active conditions even though `conditions: ['browser']`
 * asked for the browser build. Bare `fflate` therefore bundled `esm/index.mjs`, whose first two lines are
 * `import { createRequire } from 'module'` - so the module body threw `createRequire is not a function` the
 * moment it loaded on a phone, taking the whole mobile export path down with it (1.0.0).
 *
 * `obsidian-dev-utils` 107.0.0 moved the bundler to `platform: 'neutral'`, which adds no `node` condition, so
 * bare `fflate` would now resolve to the browser build too. The subpath stays anyway: it states the intent at
 * the call site and survives a future bundler regression. Nothing here needs the Node build: `zipSync` is
 * synchronous and touches none of the `worker_threads` machinery that build exists to add.
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
