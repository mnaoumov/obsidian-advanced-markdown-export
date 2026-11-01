import type { CommandRegistrar } from '@mnaoumov/obsidian-lib/command-registrar';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  FileMenuEventHandler,
  FilesMenuEventHandler,
  MenuEventRegistrar
} from '@mnaoumov/obsidian-lib/menu-event-registrar';
import type {
  Command,
  Menu as MenuOriginal,
  TAbstractFile as TAbstractFileOriginal
} from 'obsidian';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  App,
  Menu,
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { RenderedNotes } from './document-export/note-renderer.ts';
import type {
  ExportDestination,
  ResolvedExportTarget
} from './export-destination/export-destination.ts';
import type { ExportForest } from './export-forest.ts';
import type { ExportTarget } from './export-writer.ts';

import { AdvancedMarkdownExportComponent } from './advanced-markdown-export-component.ts';
import { buildEpubFromNotes } from './document-export/epub-export.ts';
import { renderNotes } from './document-export/note-renderer.ts';
import { printNotesToPdf } from './document-export/pdf-export.ts';
import { createExportDestination } from './export-destination/export-destination.ts';
import { showExportTreeModal } from './modals/export-tree-modal.ts';
import {
  ExportFormat,
  PdfPageSize,
  PluginSettings
} from './plugin-settings.ts';

const MACROTASK_TURNS_TO_SETTLE_EXPORT = 3;
const MENU_ITEM_TITLE = 'Export with dependencies';

/*
 * The modal and the destination are the two points where the flow waits for a human. Everything between
 * them - the forest, the resolver, the writer - stays real, so these tests exercise the actual wiring.
 */
vi.mock('./modals/export-tree-modal.ts', () => ({ showExportTreeModal: vi.fn() }));
vi.mock('./export-destination/export-destination.ts', () => ({ createExportDestination: vi.fn() }));

/*
 * The document formats are unit-tested in their own modules; here only the hand-off to them is checked.
 */
vi.mock('./document-export/note-renderer.ts', () => ({ renderNotes: vi.fn() }));
vi.mock('./document-export/epub-export.ts', () => ({
  buildEpubFromNotes: vi.fn(),
  getChapterFileName: (anchorId: string): string => `${anchorId}.xhtml`
}));
vi.mock('./document-export/pdf-export.ts', () => ({ printNotesToPdf: vi.fn() }));

describe('AdvancedMarkdownExportComponent', () => {
  let app: App;
  let commands: Command[];
  let fileMenuHandlers: FileMenuEventHandler[];
  let filesMenuHandlers: FilesMenuEventHandler[];
  let resolveFileMock: ExportDestination['resolveFile'];
  let resolveTargetMock: ExportDestination['resolveTarget'];
  let settings: PluginSettings;
  let showNoticeMock: PluginNoticeComponent['showNotice'];
  let writtenFiles: Map<string, Uint8Array>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    commands = [];
    fileMenuHandlers = [];
    filesMenuHandlers = [];
    settings = new PluginSettings();
    showNoticeMock = vi.fn<PluginNoticeComponent['showNotice']>();
    writtenFiles = new Map<string, Uint8Array>();

    // Cancelled by default, so a test that only cares about the roots stops right after the modal.
    vi.mocked(showExportTreeModal).mockResolvedValue(null);

    const target: ExportTarget = {
      finish: () => noopAsync(),
      writeFile: (relativePath, data) => {
        writtenFiles.set(relativePath, data);
        return noopAsync();
      }
    };
    resolveTargetMock = vi.fn<ExportDestination['resolveTarget']>().mockResolvedValue(
      {
        description: 'Bundle',
        target
      } satisfies ResolvedExportTarget
    );
    resolveFileMock = vi.fn<ExportDestination['resolveFile']>().mockResolvedValue({
      description: 'Book',
      write: (data) => {
        writtenFiles.set('Book', data);
        return noopAsync();
      }
    });
    vi.mocked(createExportDestination).mockResolvedValue({
      resolveFile: resolveFileMock,
      resolveTarget: resolveTargetMock
    });
  });

  function createComponent(): AdvancedMarkdownExportComponent {
    const component = new AdvancedMarkdownExportComponent({
      app: app.asOriginalType__(),
      commandRegistrar: strictProxy<CommandRegistrar>({
        addCommand: (command: Command) => {
          commands.push(command);
        }
      }),
      menuEventRegistrar: strictProxy<MenuEventRegistrar>({
        registerFileMenuEventHandler: (handler: FileMenuEventHandler) => {
          fileMenuHandlers.push(handler);
          return { dispose: vi.fn(), [Symbol.dispose]: vi.fn() };
        },
        registerFilesMenuEventHandler: (handler: FilesMenuEventHandler) => {
          filesMenuHandlers.push(handler);
          return { dispose: vi.fn(), [Symbol.dispose]: vi.fn() };
        }
      }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock }),
      settingsProvider: (): PluginSettings => settings
    });
    component.load();
    return component;
  }

  function createFolder(path: string): TAbstractFileOriginal {
    return castTo<TAbstractFileOriginal>(TFolder.create__(app.vault, path).asOriginalType2__());
  }

  function createMenu(): Menu {
    return Menu.create2__();
  }

  function createNote(path: string): TAbstractFileOriginal {
    return castTo<TAbstractFileOriginal>(TFile.create__(app.vault, path).asOriginalType__());
  }

  /**
   * The entry points fire the export off with `invokeAsyncSafely`, so the test has to let the resulting
   * promise chain settle before asserting on it. Each `setTimeoutAsync` yields a full macrotask turn,
   * which drains every microtask queued behind it - counting individual `await`s would be guesswork.
   */
  async function flushExport(): Promise<void> {
    for (let index = 0; index < MACROTASK_TURNS_TO_SETTLE_EXPORT; index++) {
      await setTimeoutAsync();
    }
  }

  /*
   * The modal is mocked, so accepting means resolving with what the real one would have: the export set
   * read off the forest it was handed.
   */
  function acceptModal(format = ExportFormat.Markdown): void {
    vi.mocked(showExportTreeModal).mockImplementation((params) =>
      Promise.resolve({
        files: params.forest.getExportFiles(),
        format
      })
    );
  }

  function getMenuItemTitles(menu: Menu): (DocumentFragment | string)[] {
    return menu.menuItems__.map((item) => item.title__);
  }

  /**
   * The root paths the export was actually started with, read off the forest the modal was handed.
   */
  function getStartedRootPaths(): string[] {
    const params = vi.mocked(showExportTreeModal).mock.calls[0]?.[0];

    if (!params) {
      return [];
    }

    const forest: ExportForest = params.forest;
    return forest.getRootIds().map((rootId) => forest.getNode(rootId).path);
  }

  it('should register both commands and both menu handlers', () => {
    createComponent();
    expect(commands.map((command) => command.id)).toEqual(['export-active-file', 'export-vault']);
    expect(fileMenuHandlers).toHaveLength(1);
    expect(filesMenuHandlers).toHaveLength(1);
  });

  /*
   * A folder root is not a convenience - it is how the forest is entered, so a folder must offer the
   * menu item exactly as a note does.
   */
  it('should offer the menu item for a note and for a folder alike', () => {
    createComponent();
    const noteMenu = createMenu();
    fileMenuHandlers[0]?.(castTo<MenuOriginal>(noteMenu), createNote('A.md'), 'file-explorer');
    expect(getMenuItemTitles(noteMenu)).toEqual([MENU_ITEM_TITLE]);

    const folderMenu = createMenu();
    fileMenuHandlers[0]?.(castTo<MenuOriginal>(folderMenu), createFolder('Example'), 'file-explorer');
    expect(getMenuItemTitles(folderMenu)).toEqual([MENU_ITEM_TITLE]);
  });

  /*
   * A bare attachment has no links to walk, so offering the command on one would promise a dependency
   * tree that could only ever hold the image itself.
   */
  it('should not offer the menu item for a bare attachment', () => {
    createComponent();
    const menu = createMenu();
    fileMenuHandlers[0]?.(castTo<MenuOriginal>(menu), createNote('A1.png'), 'file-explorer');
    expect(menu.menuItems__).toHaveLength(0);
  });

  it('should offer a single menu item for a multi-selection', () => {
    createComponent();
    const menu = createMenu();
    filesMenuHandlers[0]?.(
      castTo<MenuOriginal>(menu),
      [createNote('A.md'), createNote('B.md'), createFolder('Example')],
      'file-explorer'
    );
    expect(getMenuItemTitles(menu)).toEqual([MENU_ITEM_TITLE]);
  });

  it('should not offer the menu item for an empty multi-selection', () => {
    createComponent();
    const menu = createMenu();
    filesMenuHandlers[0]?.(castTo<MenuOriginal>(menu), [], 'file-explorer');
    expect(menu.menuItems__).toHaveLength(0);
  });

  it('should not offer the menu item for a multi-selection of nothing but attachments', () => {
    createComponent();
    const menu = createMenu();
    filesMenuHandlers[0]?.(
      castTo<MenuOriginal>(menu),
      [createNote('A1.png'), createNote('A2.png')],
      'file-explorer'
    );
    expect(menu.menuItems__).toHaveLength(0);
  });

  /*
   * The attachment gate is on the ENTRY POINT only: once a note makes the command available, an
   * attachment picked alongside it still travels as a root of its own.
   */
  it('should keep every selected file as a root, attachments included', async () => {
    createComponent();
    app.vault.createSync__('A.md', '# A');
    app.vault.createSync__('A1.png', 'a1');
    const menu = createMenu();
    filesMenuHandlers[0]?.(
      castTo<MenuOriginal>(menu),
      [createNote('A.md'), createNote('A1.png')],
      'file-explorer'
    );
    menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
    await flushExport();

    expect(getStartedRootPaths()).toEqual(['A.md', 'A1.png']);
  });

  it('should turn a folder root into its notes before the tree is shown', async () => {
    createComponent();
    app.vault.createFolderSync__('Example');
    app.vault.createSync__('Example/A.md', '# A');
    app.vault.createSync__('Example/B.md', '# B');
    const menu = createMenu();
    const folder = app.vault.getFolderByPath('Example');
    fileMenuHandlers[0]?.(
      castTo<MenuOriginal>(menu),
      castTo<TAbstractFileOriginal>(folder?.asOriginalType2__()),
      'file-explorer'
    );
    menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
    await flushExport();

    expect(getStartedRootPaths()).toEqual(['Example/A.md', 'Example/B.md']);
  });

  it('should say so rather than opening an empty tree when a folder holds no notes', async () => {
    createComponent();
    app.vault.createFolderSync__('Empty');
    const menu = createMenu();
    const folder = app.vault.getFolderByPath('Empty');
    fileMenuHandlers[0]?.(
      castTo<MenuOriginal>(menu),
      castTo<TAbstractFileOriginal>(folder?.asOriginalType2__()),
      'file-explorer'
    );
    menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
    await flushExport();

    expect(showExportTreeModal).not.toHaveBeenCalled();
    expect(showNoticeMock).toHaveBeenCalledWith('There is nothing to export here.');
  });

  describe('the export flow', () => {
    async function startExportOfA(): Promise<void> {
      createComponent();
      app.vault.createSync__('A.md', '# A');
      const menu = createMenu();
      fileMenuHandlers[0]?.(castTo<MenuOriginal>(menu), createNote('A.md'), 'file-explorer');
      menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
      await flushExport();
    }

    it('should write nothing when the tree is cancelled', async () => {
      await startExportOfA();

      expect(resolveTargetMock).not.toHaveBeenCalled();
      expect(writtenFiles.size).toBe(0);
      expect(showNoticeMock).not.toHaveBeenCalled();
    });

    it('should write the bundle and report where it went', async () => {
      acceptModal();
      await startExportOfA();

      expect([...writtenFiles.keys()]).toEqual(['A.md']);
      expect(showNoticeMock).toHaveBeenCalledWith('Exported 1 file to Bundle');
    });

    it('should name the bundle after a single note root, without its extension', async () => {
      acceptModal();
      await startExportOfA();

      const params = vi.mocked(resolveTargetMock).mock.calls[0]?.[0];
      expect(params?.bundleName).toBe('A');
    });

    /*
     * The user picked a directory to write into, so a note buried in folders still has to produce one
     * bundle folder there - not a chain of empty parents reproducing where it happened to live.
     */
    it('should name the bundle after a nested note without its folders', async () => {
      acceptModal();
      createComponent();
      app.vault.createFolderSync__('Example');
      app.vault.createSync__('Example/A.md', '# A');
      const menu = createMenu();
      fileMenuHandlers[0]?.(castTo<MenuOriginal>(menu), createNote('Example/A.md'), 'file-explorer');
      menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
      await flushExport();

      const params = vi.mocked(resolveTargetMock).mock.calls[0]?.[0];
      expect(params?.bundleName).toBe('A');
    });

    it('should name the bundle after a single folder root', async () => {
      acceptModal();
      createComponent();
      app.vault.createFolderSync__('Example');
      app.vault.createSync__('Example/A.md', '# A');
      const menu = createMenu();
      fileMenuHandlers[0]?.(
        castTo<MenuOriginal>(menu),
        castTo<TAbstractFileOriginal>(app.vault.getFolderByPath('Example')?.asOriginalType2__()),
        'file-explorer'
      );
      menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
      await flushExport();

      const params = vi.mocked(resolveTargetMock).mock.calls[0]?.[0];
      expect(params?.bundleName).toBe('Example');
    });

    /*
     * A multi-selection has no one name to take, so it falls back to a neutral one rather than picking a
     * member arbitrarily.
     */
    it('should fall back to a neutral bundle name for a multi-selection', async () => {
      acceptModal();
      createComponent();
      app.vault.createSync__('A.md', '# A');
      app.vault.createSync__('B.md', '# B');
      const menu = createMenu();
      filesMenuHandlers[0]?.(
        castTo<MenuOriginal>(menu),
        [createNote('A.md'), createNote('B.md')],
        'file-explorer'
      );
      menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
      await flushExport();

      const params = vi.mocked(resolveTargetMock).mock.calls[0]?.[0];
      expect(params?.bundleName).toBe('Export');
    });

    it('should write nothing when the destination is cancelled', async () => {
      acceptModal();
      vi.mocked(resolveTargetMock).mockResolvedValue(null);
      await startExportOfA();

      expect(writtenFiles.size).toBe(0);
      expect(showNoticeMock).not.toHaveBeenCalled();
    });
  });

  describe('the active-note command', () => {
    it('should be unavailable when no note is open', () => {
      createComponent();
      app.workspace.getActiveFile = vi.fn().mockReturnValue(null);
      expect(commands[0]?.checkCallback?.(true)).toBe(false);
      expect(showExportTreeModal).not.toHaveBeenCalled();
    });

    it('should be available when a note is open, and only export once invoked', async () => {
      createComponent();
      app.vault.createSync__('A.md', '# A');
      const activeFile = createNote('A.md');
      app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);

      expect(commands[0]?.checkCallback?.(true)).toBe(true);
      await flushExport();
      expect(showExportTreeModal).not.toHaveBeenCalled();

      expect(commands[0]?.checkCallback?.(false)).toBe(true);
      await flushExport();
      expect(getStartedRootPaths()).toEqual(['A.md']);
    });
  });

  describe('the whole-vault command', () => {
    it('should start the export at the vault root and name the bundle after the vault', async () => {
      acceptModal();
      createComponent();
      app.vault.createSync__('A.md', '# A');
      app.vault.createFolderSync__('Example');
      app.vault.createSync__('Example/B.md', '# B');

      commands[1]?.callback?.();
      await flushExport();

      expect(getStartedRootPaths()).toEqual(['A.md', 'Example/B.md']);
      expect(vi.mocked(resolveTargetMock).mock.calls[0]?.[0].bundleName).toBe(app.vault.getName());
    });
  });

  describe('the document formats', () => {
    let disposeMock: RenderedNotes['dispose'];

    beforeEach(() => {
      disposeMock = vi.fn();
      vi.mocked(renderNotes).mockResolvedValue({ dispose: disposeMock, notes: [] });
      vi.mocked(buildEpubFromNotes).mockResolvedValue(new Uint8Array([1]));
      vi.mocked(printNotesToPdf).mockResolvedValue(new Uint8Array([2]));
    });

    async function startExportOfA(): Promise<void> {
      createComponent();
      app.vault.createSync__('A.md', '# A');
      const menu = createMenu();
      fileMenuHandlers[0]?.(castTo<MenuOriginal>(menu), createNote('A.md'), 'file-explorer');
      menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
      await flushExport();
    }

    it('should start the modal on the configured format', async () => {
      settings.exportFormat = ExportFormat.Epub;
      await startExportOfA();

      expect(vi.mocked(showExportTreeModal).mock.calls[0]?.[0].initialFormat).toBe(ExportFormat.Epub);
    });

    it('should write an EPUB whose links point at chapter files', async () => {
      acceptModal(ExportFormat.Epub);
      await startExportOfA();

      expect(vi.mocked(resolveFileMock).mock.calls[0]?.[0]).toMatchObject({ bundleName: 'A', extension: 'epub', formatName: 'EPUB' });
      expect(vi.mocked(renderNotes).mock.calls[0]?.[0].noteHrefResolver('note-1')).toBe('note-1.xhtml');
      expect(vi.mocked(buildEpubFromNotes).mock.calls[0]?.[0].title).toBe('A');
      expect(writtenFiles.get('Book')).toEqual(new Uint8Array([1]));
      expect(disposeMock).toHaveBeenCalled();
      expect(showNoticeMock).toHaveBeenCalledWith('Rendering 1 note to EPUB...');
      expect(showNoticeMock).toHaveBeenCalledWith('Exported 1 note to Book');
    });

    it('should write a PDF on the configured page size, its links pointing inside the document', async () => {
      acceptModal(ExportFormat.Pdf);
      settings.pdfPageSize = PdfPageSize.A4;
      await startExportOfA();

      expect(vi.mocked(resolveFileMock).mock.calls[0]?.[0]).toMatchObject({ extension: 'pdf', formatName: 'PDF' });
      expect(vi.mocked(renderNotes).mock.calls[0]?.[0].noteHrefResolver('note-1')).toBe('#note-1');
      expect(vi.mocked(printNotesToPdf).mock.calls[0]?.[0]).toMatchObject({ pageSize: 'A4', title: 'A' });
      expect(writtenFiles.get('Book')).toEqual(new Uint8Array([2]));
      expect(disposeMock).toHaveBeenCalled();
    });

    it('should say so when no note is checked', async () => {
      vi.mocked(showExportTreeModal).mockResolvedValue({ files: [], format: ExportFormat.Epub });
      await startExportOfA();

      expect(resolveFileMock).not.toHaveBeenCalled();
      expect(showNoticeMock).toHaveBeenCalledWith('Only notes can be exported to EPUB, and no note is checked.');
    });

    it('should render nothing when the save dialog is cancelled', async () => {
      acceptModal(ExportFormat.Epub);
      vi.mocked(resolveFileMock).mockResolvedValue(null);
      await startExportOfA();

      expect(renderNotes).not.toHaveBeenCalled();
      expect(writtenFiles.size).toBe(0);
    });
  });
});
