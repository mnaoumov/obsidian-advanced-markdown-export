import { Platform } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  beforeAll,
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

/*
 * Both destinations are reached through a conditional `await import()`, and the first load of each pulls in
 * a large part of `obsidian-dev-utils` (the mobile one `fflate` too, through the ZIP target). Cold, that
 * transform measured 1.7 s for the mobile module against 0.2 s for the desktop one on an idle machine, and
 * once went past vitest's 5 s default on a loaded one - a red gate that reads exactly like a regression.
 * So both modules are loaded once up front, under a budget stated here, and each test times only the choice.
 */
const WARM_UP_TIMEOUT_IN_MILLISECONDS = 30_000;

describe('createExportDestination', () => {
  beforeAll(async () => {
    await import('./desktop-export-destination.ts');
    await import('./mobile-export-destination.ts');
  }, WARM_UP_TIMEOUT_IN_MILLISECONDS);

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
