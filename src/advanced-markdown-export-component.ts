import type {
  App,
  Menu,
  TAbstractFile
} from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { MenuEventRegistrar } from 'obsidian-dev-utils/obsidian/menu-event-registrar';

import { TFolder } from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import {
  isNote,
  trimMarkdownExtension
} from 'obsidian-dev-utils/obsidian/file-system';
import { basename } from 'obsidian-dev-utils/path';

import type { ReadonlyPluginSettings } from './plugin-settings.ts';

import { DependencyResolver } from './dependency-resolver.ts';
import { createExportDestination } from './export-destination/export-destination.ts';
import { ExportForest } from './export-forest.ts';
import { exportBundle } from './export-writer.ts';
import { showExportTreeModal } from './modals/export-tree-modal.ts';

/**
 * A single root is the spec's worked example, and its immediate dependencies are what the user came to
 * see - so that one gets opened for them. Any more than that and the tree stays closed, because a folder
 * root can be thousands of notes and opening them all would resolve the whole vault up front.
 */
const MAX_ROOTS_TO_AUTO_EXPAND = 1;

interface AdvancedMarkdownExportComponentConstructorParams {
  readonly app: App;
  readonly commandRegistrar: CommandRegistrar;
  readonly menuEventRegistrar: MenuEventRegistrar;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly settingsProvider: SettingsProvider;
}

type SettingsProvider = () => ReadonlyPluginSettings;

/**
 * Owns the plugin's entry points. Every one of them funnels into {@link startExport}, which takes the
 * export **roots** as a set — a single note, a multi-selection, and a folder are just different ways of
 * producing that set.
 */
export class AdvancedMarkdownExportComponent extends ComponentEx {
  private readonly app: App;
  private readonly commandRegistrar: CommandRegistrar;
  private readonly menuEventRegistrar: MenuEventRegistrar;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly settingsProvider: SettingsProvider;

  public constructor(params: AdvancedMarkdownExportComponentConstructorParams) {
    super();
    this.app = params.app;
    this.commandRegistrar = params.commandRegistrar;
    this.menuEventRegistrar = params.menuEventRegistrar;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.settingsProvider = params.settingsProvider;
  }

  public override onload(): void {
    super.onload();

    this.commandRegistrar.addCommand({
      checkCallback: this.exportActiveFile.bind(this),
      id: 'export-active-file',
      name: 'Export active note with its dependencies'
    });

    this.registerDisposable(this.menuEventRegistrar.registerFileMenuEventHandler(this.handleFileMenu.bind(this)));
    this.registerDisposable(this.menuEventRegistrar.registerFilesMenuEventHandler(this.handleFilesMenu.bind(this)));
  }

  private addMenuItem(menu: Menu, roots: TAbstractFile[]): void {
    menu.addItem((item) => {
      item
        .setTitle('Export with dependencies')
        .setIcon('package')
        .onClick(() => {
          this.startExport(roots);
        });
    });
  }

  /**
   * Whether this file is worth starting an export FROM. A folder is — every note inside it becomes a
   * root. A note is. A bare attachment is not: it has no links to walk, so offering the command on an
   * image would promise a dependency tree that can only ever hold the image itself.
   *
   * Note that this gates the ENTRY POINT, not what may be exported. An attachment picked as part of a
   * multi-selection is still carried along as a root of its own.
   */
  private canStartExportFrom(abstractFile: TAbstractFile): boolean {
    return abstractFile instanceof TFolder || isNote(abstractFile);
  }

  private exportActiveFile(isChecking: boolean): boolean {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return false;
    }

    if (!isChecking) {
      this.startExport([activeFile]);
    }

    return true;
  }

  private handleFileMenu(menu: Menu, abstractFile: TAbstractFile): void {
    if (!this.canStartExportFrom(abstractFile)) {
      return;
    }

    this.addMenuItem(menu, [abstractFile]);
  }

  private handleFilesMenu(menu: Menu, abstractFiles: TAbstractFile[]): void {
    if (abstractFiles.every((abstractFile) => !this.canStartExportFrom(abstractFile))) {
      return;
    }

    this.addMenuItem(menu, abstractFiles);
  }

  private startExport(roots: TAbstractFile[]): void {
    invokeAsyncSafely(() => this.startExportAsync(roots));
  }

  private async startExportAsync(roots: TAbstractFile[]): Promise<void> {
    const settings = this.settingsProvider();
    const forest = new ExportForest({
      resolver: new DependencyResolver({
        app: this.app,
        settings
      }),
      roots,
      settings
    });
    const rootIds = forest.getRootIds();

    if (rootIds.length === 0) {
      this.pluginNoticeComponent.showNotice('There is nothing to export here.');
      return;
    }

    if (rootIds.length <= MAX_ROOTS_TO_AUTO_EXPAND) {
      for (const rootId of rootIds) {
        await forest.expand(rootId);
      }
    }

    const files = await showExportTreeModal({
      app: this.app,
      forest
    });

    if (files === null) {
      return;
    }

    const destination = await createExportDestination();
    const resolvedTarget = await destination.resolveTarget({
      app: this.app,
      bundleName: getBundleName(roots),
      settings
    });

    if (!resolvedTarget) {
      return;
    }

    await exportBundle({
      app: this.app,
      files,
      settings,
      target: resolvedTarget.target
    });
    this.pluginNoticeComponent.showNotice(
      `Exported ${String(files.length)} ${files.length === 1 ? 'file' : 'files'} to ${resolvedTarget.description}`
    );
  }
}

/**
 * Names the bundle after what the user actually picked, so a single note or folder produces an obvious
 * name and a mixed multi-selection falls back to a neutral one.
 */
function getBundleName(roots: readonly TAbstractFile[]): string {
  const [firstRoot] = roots;

  if (roots.length !== 1 || !firstRoot) {
    return 'Export';
  }

  /*
   * The basename, not the trimmed path: the user picked a directory, so a note nested three folders
   * deep must still produce one bundle folder next to the others, not a chain of empty parents.
   */
  return firstRoot instanceof TFolder ? firstRoot.name : basename(trimMarkdownExtension(firstRoot));
}
