import type { App } from 'obsidian';

import { Platform } from 'obsidian';

import type { ExportTarget } from '../export-writer.ts';
import type { ReadonlyPluginSettings } from '../plugin-settings.ts';

/**
 * Decides where a bundle goes and produces the target that writes it there.
 */
export interface ExportDestination {
  /**
   * Asks the user where the bundle should go, if the settings do not already say.
   *
   * @param params - The parameters for the destination.
   * @returns The resolved target, or `null` when the user backed out.
   */
  resolveTarget(params: ResolveExportTargetParams): Promise<null | ResolvedExportTarget>;
}

/**
 * A target plus somewhere to tell the user the bundle landed.
 */
export interface ResolvedExportTarget {
  /**
   * Where the bundle is being written, for the completion notice.
   */
  readonly description: string;

  /**
   * The target that writes it.
   */
  readonly target: ExportTarget;
}

/**
 * The parameters for {@link ExportDestination.resolveTarget}.
 */
export interface ResolveExportTargetParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * The bundle's own folder or archive name, without any parent path.
   */
  readonly bundleName: string;

  /**
   * The settings, read for the output folder and the ZIP preference.
   */
  readonly settings: ReadonlyPluginSettings;
}

/**
 * Picks the destination for the platform this is running on.
 *
 * The desktop implementation reaches for `window.electron` and `node:fs`, neither of which exists on a
 * phone - and a static import of that module would break the mobile bundle at LOAD time, long before any
 * `Platform` check could run. So it is pulled in by a conditional dynamic import instead.
 *
 * The gate is `isDesktopApp` rather than `isDesktop`, because what that module actually needs is Electron,
 * and that is the flag which says Electron is there.
 *
 * @returns A {@link Promise} that resolves to the destination for this platform.
 */
export async function createExportDestination(): Promise<ExportDestination> {
  if (Platform.isDesktopApp) {
    const desktopModule = await import('./desktop-export-destination.ts');
    return new desktopModule.DesktopExportDestination();
  }

  const mobileModule = await import('./mobile-export-destination.ts');
  return new mobileModule.MobileExportDestination();
}
