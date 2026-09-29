import type { App } from 'obsidian';

import { toArrayBuffer } from 'obsidian-dev-utils/array-buffer';

/**
 * How many writes a file gets before the export gives up on it: the create, then this many rewrites less one.
 */
const MAX_WRITE_ATTEMPTS = 3;

/**
 * Creates a binary file in the vault and checks that its bytes actually reached the disk.
 *
 * On Android, `Vault.createBinary` of a NEW file sometimes resolves having written nothing. The file exists
 * with 0 bytes, stays that way, and no error is raised. It was measured on the `obsidian_test` emulator at
 * about 1 write in 120 into a folder created just before. That is the exact shape of every mobile export,
 * so an unchecked write occasionally shipped an empty archive or an empty note with a success notice.
 *
 * The check has to ask the adapter: the `TFile` Obsidian hands back records the size it was asked to write,
 * not the size on disk. A rewrite of the existing file brought back every lost write on the emulator. A
 * file still short after that is reported rather than left behind looking exported.
 *
 * @param app - The Obsidian app.
 * @param path - The vault-relative path of the file to create.
 * @param data - The bytes to write.
 * @returns A {@link Promise} that resolves once the file on disk holds all of `data`.
 */
export async function createBinaryVerified(app: App, path: string, data: Uint8Array): Promise<void> {
  const file = await app.vault.createBinary(path, toArrayBuffer(data));

  let size: number | undefined;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await app.vault.modifyBinary(file, toArrayBuffer(data));
    }

    const stat = await app.vault.adapter.stat(path);
    size = stat?.size;
    if (size === data.byteLength) {
      return;
    }
  }

  throw new Error(`Writing ${path} left ${String(size)} of its ${String(data.byteLength)} bytes on disk after ${String(MAX_WRITE_ATTEMPTS)} attempts.`);
}
