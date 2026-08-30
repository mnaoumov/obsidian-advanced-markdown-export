import type {
  App as AppOriginal,
  Plugin,
  SettingGroup
} from 'obsidian';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import type { MockInstance } from 'vitest';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';
import { SettingEx } from 'obsidian-dev-utils/obsidian/setting-ex';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';

interface BindOptionsExtension {
  componentToPluginSettingsValueConverter?(uiValue: string): unknown;
  onChanged?(newValue: unknown, oldValue: unknown): void;
  pluginSettingsToComponentValueConverter?(pluginSettingsValue: string): unknown;
}

/**
 * Every settings key the tab is expected to expose. Kept as a list rather than one `it` per key so that
 * adding a setting without a row - or a row without a setting - fails loudly on the count assertion too.
 */
const EXPECTED_BOUND_KEYS: (keyof PluginSettings)[] = [
  'danglingLinkAction',
  'ignoredFolders',
  'ignoredTags',
  'maxTraversalDepth',
  'outputFolderPath',
  'shouldCheckAttachmentsByDefault',
  'shouldCheckLinkedNotesByDefault',
  'shouldCreateZip',
  'shouldIncludeSubfolders',
  'shouldTreatEmbedsAsAttachments'
];

describe('PluginSettingsTab', () => {
  let app: AppOriginal;
  let bindSpy: MockInstance<PluginSettingsTab['bind']>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__().asOriginalType__();

    // `PluginSettingsTabBase.bind` duck-types components via a strict-proxy property probe
    // That the real test-mocks components throw on, so neutralize only `bind`'s return value
    // While keeping the real base + real `SettingEx` + real rendered components. The stub also
    // Drives the source-provided option callbacks (converters / onChanged) the way the real
    // `bind` would, so those closures stay exercised.
    bindSpy = vi.spyOn(PluginSettingsTabBase.prototype, 'bind').mockImplementation((params) => {
      const paramsExtension = castTo<BindOptionsExtension>(params);
      paramsExtension.onChanged?.(undefined, undefined);
      paramsExtension.componentToPluginSettingsValueConverter?.('test (converted)');
      paramsExtension.pluginSettingsToComponentValueConverter?.('test');
      return params.valueComponent;
    });
  });

  function createTab(): PluginSettingsTab {
    const plugin = strictProxy<Plugin>({
      app,
      manifest: { id: 'test-plugin' }
    });

    const pluginSettingsComponent = strictProxy<PluginSettingsComponentBase<PluginSettings>>({
      defaultSettings: castTo<PluginSettings>({}),
      on: castTo<PluginSettingsComponentBase<PluginSettings>['on']>(vi.fn(() => ({
        asyncEventSource: { offref: vi.fn() }
      }))),
      settings: castTo<PluginSettings>({}),
      settingsState: castTo<PluginSettingsComponentBase<PluginSettings>['settingsState']>({
        effectiveValues: {},
        inputValues: {},
        validationMessages: {}
      })
    });

    return new PluginSettingsTab({
      plugin,
      pluginSettingsComponent
    });
  }

  /**
   * Invokes every declared row's `render` callback the way Obsidian does when the tab is opened, so the
   * bindings are still exercised now that the rows are declarative.
   *
   * @param tab - The settings tab.
   */
  function callDisplay(tab: PluginSettingsTab): void {
    for (const definition of tab.getSettingDefinitions()) {
      if ('render' in definition) {
        definition.render(new SettingEx(tab.containerEl), castTo<SettingGroup>(null));
      }
    }
  }

  function getBoundKeys(): unknown[] {
    return bindSpy.mock.calls.map((call): unknown => call[0].propertyName);
  }

  it('should create an instance', () => {
    const tab = createTab();
    expect(tab).toBeInstanceOf(PluginSettingsTab);
  });

  it('should render setting elements in containerEl', () => {
    const tab = createTab();
    callDisplay(tab);
    expect(tab.containerEl.children.length).toBeGreaterThan(0);
  });

  it('should declare one row per setting', () => {
    const tab = createTab();
    expect(tab.getSettingDefinitions()).toHaveLength(EXPECTED_BOUND_KEYS.length);
  });

  it('should bind every setting exactly once', () => {
    const tab = createTab();
    callDisplay(tab);
    expect(getBoundKeys().sort()).toEqual([...EXPECTED_BOUND_KEYS].sort());
  });
});
