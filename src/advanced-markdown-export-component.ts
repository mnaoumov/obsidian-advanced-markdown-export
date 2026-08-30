import type {
  App,
  Menu,
  TAbstractFile
} from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { MenuEventRegistrar } from 'obsidian-dev-utils/obsidian/menu-event-registrar';

import { TFolder } from 'obsidian';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { isNote } from 'obsidian-dev-utils/obsidian/file-system';

interface AdvancedMarkdownExportComponentConstructorParams {
  readonly app: App;
  readonly commandRegistrar: CommandRegistrar;
  readonly menuEventRegistrar: MenuEventRegistrar;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

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

  public constructor(params: AdvancedMarkdownExportComponentConstructorParams) {
    super();
    this.app = params.app;
    this.commandRegistrar = params.commandRegistrar;
    this.menuEventRegistrar = params.menuEventRegistrar;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
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
    this.pluginNoticeComponent.showNotice(`Export with dependencies: ${String(roots.length)} root(s) selected`);
  }
}
