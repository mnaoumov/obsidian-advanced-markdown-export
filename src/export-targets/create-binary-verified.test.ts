import type { Stat } from 'obsidian';

import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { createBinaryVerified } from './create-binary-verified.ts';

describe('createBinaryVerified', () => {
  let app: App;

  beforeEach(() => {
    app = App.createConfigured__();
  });

  const ARCHIVE_PATH = 'A.zip';

  function encodeArchive(): Uint8Array {
    return new TextEncoder().encode('archive');
  }

  async function readArchive(): Promise<string> {
    const file = app.vault.getFileByPath(ARCHIVE_PATH);
    if (!file) {
      throw new Error(`Nothing written at ${ARCHIVE_PATH}`);
    }

    return new TextDecoder().decode(await app.vault.readBinary(file));
  }

  // What the Android emulator reports for a create that resolved having written nothing.
  const EMPTY_STAT: Stat = { ctime: 0, mtime: 0, size: 0, type: 'file' };

  it('should write the file once when the bytes arrive', async () => {
    const modifyBinarySpy = vi.spyOn(app.vault, 'modifyBinary');

    await createBinaryVerified(app.asOriginalType__(), ARCHIVE_PATH, encodeArchive());

    expect(await readArchive()).toBe('archive');
    expect(modifyBinarySpy).not.toHaveBeenCalled();
  });

  it('should rewrite a file the create left empty', async () => {
    vi.spyOn(app.vault.adapter, 'stat').mockResolvedValueOnce(EMPTY_STAT);
    const modifyBinarySpy = vi.spyOn(app.vault, 'modifyBinary');

    await createBinaryVerified(app.asOriginalType__(), ARCHIVE_PATH, encodeArchive());

    expect(modifyBinarySpy).toHaveBeenCalledOnce();
    expect(await readArchive()).toBe('archive');
  });

  it('should report a file that stays short after every rewrite', async () => {
    vi.spyOn(app.vault.adapter, 'stat').mockResolvedValue(EMPTY_STAT);
    const modifyBinarySpy = vi.spyOn(app.vault, 'modifyBinary');

    await expect(createBinaryVerified(app.asOriginalType__(), ARCHIVE_PATH, encodeArchive()))
      .rejects.toThrow('Writing A.zip left 0 of its 7 bytes on disk after 3 attempts.');
    expect(modifyBinarySpy).toHaveBeenCalledTimes(2);
  });
});
