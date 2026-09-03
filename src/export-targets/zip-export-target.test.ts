import { unzipSync } from 'fflate';
import { noopAsync } from 'obsidian-dev-utils/function';
import {
  describe,
  expect,
  it
} from 'vitest';

import { ZipExportTarget } from './zip-export-target.ts';

describe('ZipExportTarget', () => {
  function encode(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  it('should hand the finished archive to its sink exactly once', async () => {
    const archives: Uint8Array[] = [];
    const target = new ZipExportTarget({
      sink: (archive: Uint8Array): Promise<void> => {
        archives.push(archive);
        return noopAsync();
      }
    });

    await target.writeFile('A.md', encode('# A'));
    await target.finish();

    expect(archives).toHaveLength(1);
  });

  /*
   * Each file keeps its vault-relative path INSIDE the archive, so unzipping reproduces the structure the
   * exported links depend on.
   */
  it('should round-trip every entry at its vault-relative path', async () => {
    let archive: Uint8Array = new Uint8Array();
    const target = new ZipExportTarget({
      sink: (finished: Uint8Array): Promise<void> => {
        archive = finished;
        return noopAsync();
      }
    });

    await target.writeFile('Example/A.md', encode('# A'));
    await target.writeFile('Example/Attachments/A1.png', encode('a1'));
    await target.finish();

    const unzipped = unzipSync(archive);
    const decoder = new TextDecoder();

    expect(Object.keys(unzipped).sort()).toEqual([
      'Example/A.md',
      'Example/Attachments/A1.png'
    ]);
    expect(decoder.decode(unzipped['Example/A.md'])).toBe('# A');
    expect(decoder.decode(unzipped['Example/Attachments/A1.png'])).toBe('a1');
  });

  it('should produce an empty archive when nothing was written', async () => {
    let archive: Uint8Array = new Uint8Array();
    const target = new ZipExportTarget({
      sink: (finished: Uint8Array): Promise<void> => {
        archive = finished;
        return noopAsync();
      }
    });

    await target.finish();

    expect(Object.keys(unzipSync(archive))).toEqual([]);
  });
});
