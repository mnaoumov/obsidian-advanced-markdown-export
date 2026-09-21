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

  /*
   * The **Output folder** setting is free text and nothing requires the folder to exist, so this is
   * reachable from a value the settings tab accepts. It does NOT reproduce the symptom: the mock's
   * `Vault.createBinary` writes straight through its adapter with no parent check, which is why the
   * `Exports/A.zip` case above stayed green all the way through the defect. What it pins is the fix's
   * observable effect - the folder is there afterwards. The rejection itself only happens on a device,
   * where `src/export-flow.android.integration.test.ts` covers it.
   */
  it('should create the configured output folder when ZIP is on and the vault has not got it', async () => {
    settings.outputFolderPath = 'Exports/Not/There';
    settings.shouldCreateZip = true;
    const resolved = await resolveTarget();
    await resolved?.target.writeFile('A.md', new TextEncoder().encode('# A'));
    await resolved?.target.finish();

    expect(app.vault.getFolderByPath('Exports/Not/There')).not.toBeNull();
    expect(app.vault.getFileByPath('Exports/Not/There/A.zip')).not.toBeNull();
  });

  // A bundle at the vault root has no folder to create, and the root must never be handed to `createFolder`.
  it('should write an archive at the vault root when nothing is configured', async () => {
    vi.mocked(prompt).mockResolvedValue('A');
    settings.shouldCreateZip = true;
    const resolved = await resolveTarget();
    await resolved?.target.writeFile('A.md', new TextEncoder().encode('# A'));
    await resolved?.target.finish();

    expect(resolved?.description).toBe('A.zip');
    expect(app.vault.getFileByPath('A.zip')).not.toBeNull();
  });
});
