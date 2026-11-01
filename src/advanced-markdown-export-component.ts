import type { CommandRegistrar } from '@mnaoumov/obsidian-lib/command-registrar';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { MenuEventRegistrar } from '@mnaoumov/obsidian-lib/menu-event-registrar';
import type {
  App,
  Menu,
  TAbstractFile,
  TFile
} from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import {
  isMarkdownFile,
  isNote,
  trimMarkdownExtension
} from '@mnaoumov/obsidian-lib/file-system';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { basename } from '@mnaoumov/typescript-lib/path';
import { TFolder } from 'obsidian';

import type { RenderedNote } from './document-export/note-renderer.ts';
import type { ExportDestination } from './export-destination/export-destination.ts';
import type { ReadonlyPluginSettings } from './plugin-settings.ts';

import { DependencyResolver } from './dependency-resolver.ts';
import {
  buildEpubFromNotes,
  getChapterFileName
} from './document-export/epub-export.ts';
import { renderNotes } from './document-export/note-renderer.ts';
import { createExportDestination } from './export-destination/export-destination.ts';
import { ExportForest } from './export-forest.ts';
import { resolveAvailableExportFormat } from './export-formats.ts';
import { exportBundle } from './export-writer.ts';
import { showExportTreeModal } from './modals/export-tree-modal.ts';
import { ExportFormat } from './plugin-settings.ts';

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

interface AdvancedMarkdownExportComponentExportDocumentParams {
  readonly bundleName: string;
  readonly destination: ExportDestination;
  readonly files: readonly TFile[];
  readonly format: ExportFormat.Epub | ExportFormat.Pdf;
  readonly settings: ReadonlyPluginSettings;
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

    this.commandRegistrar.addCommand({
      callback: () => {
        this.startExport([this.app.vault.getRoot()]);
      },
      id: 'export-vault',
      name: 'Export the whole vault'
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

  /**
   * Writes the chosen notes as one document. Only notes become chapters or pages: an attachment travels
   * only as what a note embeds.
   */
  private async exportDocument(params: AdvancedMarkdownExportComponentExportDocumentParams): Promise<void> {
    const isPdf = params.format === ExportFormat.Pdf;
    const formatName = isPdf ? 'PDF' : 'EPUB';
    const noteCount = params.files.filter((file) => isMarkdownFile(file)).length;

    if (noteCount === 0) {
      this.pluginNoticeComponent.showNotice(`Only notes can be exported to ${formatName}, and no note is checked.`);
      return;
    }

    const resolvedFile = await params.destination.resolveFile({
      app: this.app,
      bundleName: params.bundleName,
      extension: isPdf ? 'pdf' : 'epub',
      formatName,
      settings: params.settings
    });

    if (!resolvedFile) {
      return;
    }

    this.pluginNoticeComponent.showNotice(`Rendering ${formatCount(noteCount, 'note')} to ${formatName}...`);
    const renderedNotes = await renderNotes({
      app: this.app,
      files: params.files,
      noteHrefResolver: isPdf ? (anchorId): string => `#${anchorId}` : getChapterFileName,
      settings: params.settings
    });

    try {
      const data = isPdf
        ? await printPdf(renderedNotes.notes, params)
        : await buildEpubFromNotes({
          app: this.app,
          modified: new Date(),
          notes: renderedNotes.notes,
          title: params.bundleName
        });
      await resolvedFile.write(data);
    } finally {
      renderedNotes.dispose();
    }

    this.pluginNoticeComponent.showNotice(`Exported ${formatCount(noteCount, 'note')} to ${resolvedFile.description}`);
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

    const choice = await showExportTreeModal({
      app: this.app,
      forest,
      initialFormat: resolveAvailableExportFormat(settings.exportFormat)
    });

    if (choice === null) {
      return;
    }

    const destination = await createExportDestination();
    const bundleName = getBundleName(this.app, roots);

    if (choice.format !== ExportFormat.Markdown) {
      await this.exportDocument({
        bundleName,
        destination,
        files: choice.files,
        format: choice.format,
        settings
      });
      return;
    }

    const resolvedTarget = await destination.resolveTarget({
      app: this.app,
      bundleName,
      settings
    });

    if (!resolvedTarget) {
      return;
    }

    await exportBundle({
      app: this.app,
      files: choice.files,
      settings,
      target: resolvedTarget.target
    });
    this.pluginNoticeComponent.showNotice(
      `Exported ${formatCount(choice.files.length, 'file')} to ${resolvedTarget.description}`
    );
  }
}

function formatCount(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Names the bundle after what the user actually picked, so a single note or folder produces an obvious
 * name and a mixed multi-selection falls back to a neutral one. The vault root is named after the vault.
 */
function getBundleName(app: App, roots: readonly TAbstractFile[]): string {
  const [firstRoot] = roots;

  if (roots.length !== 1 || !firstRoot) {
    return 'Export';
  }

  if (firstRoot instanceof TFolder) {
    return firstRoot.isRoot() ? app.vault.getName() : firstRoot.name;
  }

  /*
   * The basename, not the trimmed path: the user picked a directory, so a note nested three folders
   * deep must still produce one bundle folder next to the others, not a chain of empty parents.
   */
  return basename(trimMarkdownExtension(firstRoot));
}

/**
 * Prints through Electron, which only the desktop app has - the modal never offers PDF anywhere else. The
 * module is imported dynamically all the same, so the mobile bundle never evaluates it.
 */
async function printPdf(notes: readonly RenderedNote[], params: AdvancedMarkdownExportComponentExportDocumentParams): Promise<Uint8Array> {
  const pdfModule = await import('./document-export/pdf-export.ts');
  return pdfModule.printNotesToPdf({
    notes,
    pageSize: params.settings.pdfPageSize,
    title: params.bundleName
  });
}
