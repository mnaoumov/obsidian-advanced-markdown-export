import type {
  ElectronModule,
  ElectronOpenDialogReturnValue
} from '@obsidian-typings/obsidian-public-latest';

import { unzipSync } from 'fflate';
import {
  mkdtemp,
  readFile,
  rm
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolvedExportTarget } from './export-destination.ts';

import { PluginSettings } from '../plugin-settings.ts';
import { DesktopExportDestination } from './desktop-export-destination.ts';

/*
 * Writes into a real temporary directory rather than mocking `node:fs`. Writing out of the vault is the
 * whole reason this module exists, so the test that it actually lands on disk is the one worth having.
 */
interface WindowWithElectron {
  electron: ElectronModule | undefined;
}

describe('DesktopExportDestination', () => {
  let app: App;
  let destination: DesktopExportDestination;
  let outputDirectoryPath: string;
  let settings: PluginSettings;
  let showOpenDialogMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    destination = new DesktopExportDestination();
    settings = new PluginSettings();
    settings.outputFolderPath = 'Exports';
    outputDirectoryPath = await mkdtemp(join(tmpdir(), 'advanced-markdown-export-'));
    showOpenDialogMock = vi.fn().mockResolvedValue(
      {
        canceled: false,
        filePaths: [outputDirectoryPath]
      } satisfies ElectronOpenDialogReturnValue
    );
    setElectron(castTo<ElectronModule>({ remote: { dialog: { showOpenDialog: showOpenDialogMock } } }));
  });

  afterEach(async () => {
    await rm(outputDirectoryPath, {
      force: true,
      recursive: true
    });
    setElectron(undefined);
  });

  async function resolveTarget(): Promise<null | ResolvedExportTarget> {
    return destination.resolveTarget({
      app: app.asOriginalType__(),
      bundleName: 'A',
      settings
    });
  }

  function setElectron(electron: ElectronModule | undefined): void {
    castTo<WindowWithElectron>(window).electron = electron;
  }

  it('should ask for a directory and write the bundle beneath it, structure and all', async () => {
    const resolved = await resolveTarget();

    expect(showOpenDialogMock).toHaveBeenCalled();
    expect(resolved?.description).toBe(join(outputDirectoryPath, 'A'));

    await resolved?.target.writeFile('Example/A.md', new TextEncoder().encode('# A'));
    await resolved?.target.finish();

    const written = await readFile(join(outputDirectoryPath, 'A', 'Example', 'A.md'), 'utf-8');
    expect(written).toBe('# A');
  });

  it('should back out when the directory dialog is cancelled', async () => {
    showOpenDialogMock.mockResolvedValue(
      {
        canceled: true,
        filePaths: []
      } satisfies ElectronOpenDialogReturnValue
    );

    expect(await resolveTarget()).toBeNull();
  });

  /*
   * `canceled: false` with nothing chosen should not happen, but this is unofficial API - treating it as a
   * cancellation beats writing a bundle to `undefined`.
   */
  it('should back out when the dialog reports no directory at all', async () => {
    showOpenDialogMock.mockResolvedValue(
      {
        canceled: false,
        filePaths: []
      } satisfies ElectronOpenDialogReturnValue
    );

    expect(await resolveTarget()).toBeNull();
  });

  it('should write a single archive when ZIP is on', async () => {
    settings.shouldCreateZip = true;
    const resolved = await resolveTarget();
    await resolved?.target.writeFile('Example/A.md', new TextEncoder().encode('# A'));
    await resolved?.target.finish();

    const archivePath = join(outputDirectoryPath, 'A.zip');
    expect(resolved?.description).toBe(archivePath);

    const unzipped = unzipSync(await readFile(archivePath));
    expect(Object.keys(unzipped)).toEqual(['Example/A.md']);
  });
});
