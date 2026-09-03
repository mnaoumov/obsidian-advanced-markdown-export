import { unzipSync } from 'fflate';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolvedExportTarget } from './export-destination.ts';

import { PluginSettings } from '../plugin-settings.ts';
import { MobileExportDestination } from './mobile-export-destination.ts';

// The one place the flow waits for a human, and the only thing stubbed here.
vi.mock('obsidian-dev-utils/obsidian/modals/prompt', () => ({ prompt: vi.fn() }));

describe('MobileExportDestination', () => {
  let app: App;
  let destination: MobileExportDestination;
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    destination = new MobileExportDestination();
    settings = new PluginSettings();
  });

  async function resolveTarget(): Promise<null | ResolvedExportTarget> {
    return destination.resolveTarget({
      app: app.asOriginalType__(),
      bundleName: 'A',
      settings
    });
  }

  it('should write under the configured output folder without asking', async () => {
    settings.outputFolderPath = 'Exports';
    const resolved = await resolveTarget();

    expect(prompt).not.toHaveBeenCalled();
    expect(resolved?.description).toBe('Exports/A');
  });

  it('should ask where to write when no output folder is configured', async () => {
    vi.mocked(prompt).mockResolvedValue('Somewhere');
    const resolved = await resolveTarget();

    expect(prompt).toHaveBeenCalled();
    expect(resolved?.description).toBe('Somewhere');
  });

  it('should back out when the prompt is cancelled', async () => {
    vi.mocked(prompt).mockResolvedValue(null);

    expect(await resolveTarget()).toBeNull();
  });

  it('should write a folder into the vault by default', async () => {
    settings.outputFolderPath = 'Exports';
    const resolved = await resolveTarget();
    await resolved?.target.writeFile('A.md', new TextEncoder().encode('# A'));
    await resolved?.target.finish();

    expect(app.vault.getFileByPath('Exports/A/A.md')).not.toBeNull();
  });

  it('should write a single archive into the vault when ZIP is on', async () => {
    settings.outputFolderPath = 'Exports';
    settings.shouldCreateZip = true;
    const resolved = await resolveTarget();
    await resolved?.target.writeFile('A.md', new TextEncoder().encode('# A'));
    await resolved?.target.finish();

    expect(resolved?.description).toBe('Exports/A.zip');
    const archive = app.vault.getFileByPath('Exports/A.zip');
    expect(archive).not.toBeNull();

    if (!archive) {
      return;
    }

    const unzipped = unzipSync(new Uint8Array(await app.vault.readBinary(archive)));
    expect(Object.keys(unzipped)).toEqual(['A.md']);
  });
});
