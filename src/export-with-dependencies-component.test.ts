import type {
  Command,
  Menu as MenuOriginal,
  TAbstractFile as TAbstractFileOriginal
} from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type {
  FileMenuEventHandler,
  FilesMenuEventHandler,
  MenuEventRegistrar
} from 'obsidian-dev-utils/obsidian/menu-event-registrar';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
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

import { ExportWithDependenciesComponent } from './export-with-dependencies-component.ts';

const MENU_ITEM_TITLE = 'Export with dependencies';

describe('ExportWithDependenciesComponent', () => {
  let app: App;
  let commands: Command[];
  let fileMenuHandlers: FileMenuEventHandler[];
  let filesMenuHandlers: FilesMenuEventHandler[];
  let showNoticeMock: PluginNoticeComponent['showNotice'];

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    commands = [];
    fileMenuHandlers = [];
    filesMenuHandlers = [];
    showNoticeMock = vi.fn<PluginNoticeComponent['showNotice']>();
  });

  function createComponent(): ExportWithDependenciesComponent {
    const component = new ExportWithDependenciesComponent({
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
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock })
    });
    component.load();
    return component;
  }

  function createMenu(): Menu {
    return Menu.create2__();
  }

  function createNote(path: string): TAbstractFileOriginal {
    return castTo<TAbstractFileOriginal>(TFile.create__(app.vault, path).asOriginalType__());
  }

  function createFolder(path: string): TAbstractFileOriginal {
    return castTo<TAbstractFileOriginal>(TFolder.create__(app.vault, path).asOriginalType2__());
  }

  function getMenuItemTitles(menu: Menu): (DocumentFragment | string)[] {
    return menu.menuItems__.map((item) => item.title__);
  }

  it('should register one command and both menu handlers', () => {
    createComponent();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.id).toBe('export-active-file');
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
  it('should keep every selected file as a root, attachments included', () => {
    createComponent();
    const menu = createMenu();
    filesMenuHandlers[0]?.(
      castTo<MenuOriginal>(menu),
      [createNote('A.md'), createNote('A1.png')],
      'file-explorer'
    );
    menu.menuItems__[0]?.onClick__?.(castTo<MouseEvent>({}));
    expect(showNoticeMock).toHaveBeenCalledWith('Export with dependencies: 2 root(s) selected');
  });

  describe('the active-note command', () => {
    it('should be unavailable when no note is open', () => {
      createComponent();
      app.workspace.getActiveFile = vi.fn().mockReturnValue(null);
      expect(commands[0]?.checkCallback?.(true)).toBe(false);
      expect(showNoticeMock).not.toHaveBeenCalled();
    });

    it('should be available when a note is open, and only export once invoked', () => {
      createComponent();
      const activeFile = createNote('A.md');
      app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);

      expect(commands[0]?.checkCallback?.(true)).toBe(true);
      expect(showNoticeMock).not.toHaveBeenCalled();

      expect(commands[0]?.checkCallback?.(false)).toBe(true);
      expect(showNoticeMock).toHaveBeenCalledWith('Export with dependencies: 1 root(s) selected');
    });
  });
});
