import type { App } from 'obsidian';

import { Platform } from 'obsidian';

import type { ExportTarget } from '../export-writer.ts';
import type { ReadonlyPluginSettings } from '../plugin-settings.ts';

/**
 * Decides where a bundle goes and produces the target that writes it there.
 */
export interface ExportDestination {
  /**
   * Asks the user where a single-file export - a PDF, an EPUB - should go.
   *
   * @param params - The parameters for the destination.
   * @returns The resolved file, or `null` when the user backed out.
   */
  readonly resolveFile: (params: ResolveExportFileParams) => Promise<null | ResolvedExportFile>;

  /**
   * Asks the user where the bundle should go, if the settings do not already say.
   *
   * @param params - The parameters for the destination.
   * @returns The resolved target, or `null` when the user backed out.
   */
  readonly resolveTarget: (params: ResolveExportTargetParams) => Promise<null | ResolvedExportTarget>;
}

/**
 * A single file an export is written to.
 */
export interface ResolvedExportFile {
  /**
   * Where the file is being written, for the completion notice.
   */
  readonly description: string;

  /**
   * Writes the file, creating its folder when it is missing.
   *
   * @param data - The file's bytes.
   * @returns A {@link Promise} that resolves when the file is written.
   */
  readonly write: (data: Uint8Array) => Promise<void>;
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
 * The parameters for {@link ExportDestination.resolveFile}.
 */
export interface ResolveExportFileParams extends ResolveExportTargetParams {
  /**
   * The file's extension, without the dot.
   */
  readonly extension: string;

  /**
   * The format's name, for the save dialog's file type filter.
   */
  readonly formatName: string;
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
