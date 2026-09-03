import { Platform } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { createExportDestination } from './export-destination.ts';

interface MockIsDesktopApp {
  isDesktopApp: boolean;
}

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  Platform: { isDesktopApp: true }
}));

describe('createExportDestination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setIsDesktopApp(isDesktopApp: boolean): void {
    castTo<MockIsDesktopApp>(Platform).isDesktopApp = isDesktopApp;
  }

  /*
   * The desktop module statically imports `node:fs` and reaches for `window.electron`, so it must never
   * be loaded on a phone - a static import would break the mobile bundle at load time, before any
   * `Platform` check could run.
   */
  it('should pick the out-of-vault destination on desktop', async () => {
    setIsDesktopApp(true);
    const destination = await createExportDestination();

    expect(destination.constructor.name).toBe('DesktopExportDestination');
  });

  it('should pick the in-vault destination on mobile', async () => {
    setIsDesktopApp(false);
    const destination = await createExportDestination();

    expect(destination.constructor.name).toBe('MobileExportDestination');
  });
});
