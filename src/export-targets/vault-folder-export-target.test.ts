import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { VaultFolderExportTarget } from './vault-folder-export-target.ts';

describe('VaultFolderExportTarget', () => {
  let app: App;
  let target: VaultFolderExportTarget;

  beforeEach(() => {
    app = App.createConfigured__();
    target = new VaultFolderExportTarget({
      app: app.asOriginalType__(),
      bundleFolderPath: 'Bundle'
    });
  });

  function encode(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  it('should write a file under the bundle folder', async () => {
    await target.writeFile('A.md', encode('# A'));

    expect(app.vault.getFileByPath('Bundle/A.md')).not.toBeNull();
  });

  /*
   * The whole point of the folder target: the vault-relative structure is reproduced verbatim, so the
   * links between exported files keep resolving.
   */
  it('should create the nested folders a vault-relative path needs', async () => {
    await target.writeFile('Example/Attachments/A1.png', encode('a1'));

    expect(app.vault.getFolderByPath('Bundle/Example/Attachments')).not.toBeNull();
    expect(app.vault.getFileByPath('Bundle/Example/Attachments/A1.png')).not.toBeNull();
  });

  it('should write the bytes it was handed', async () => {
    await target.writeFile('A.md', encode('# A'));
    const file = app.vault.getFileByPath('Bundle/A.md');

    if (!file) {
      throw new Error('Nothing written at Bundle/A.md');
    }

    expect(new TextDecoder().decode(await app.vault.readBinary(file))).toBe('# A');
  });

  it('should have nothing left to do at the end', async () => {
    await expect(target.finish()).resolves.toBeUndefined();
  });
});
