import type { PluginManifest } from 'obsidian';

import { Component } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { AdvancedMarkdownExportComponent } from './advanced-markdown-export-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

/*
 * The real `PluginBase` (from `obsidian-dev-utils`) drives the lifecycle here —
 * it is NOT mocked. `await plugin.onload()` registers the base's universal
 * components, runs the plugin's `onloadImpl`, then loads every queued child via
 * the real children-first lifecycle. Each child the plugin adds must therefore
 * be a real loadable `Component`, so every sibling/collaborator stub below that
 * is added as a child returns a real `Component`.
 */

// The shared command handler component is now constructed and registered by PluginBase itself, so the mock exposes the registerCommandHandlers spy the base calls at load.
const { registerCommandHandlers, settingsDouble } = vi.hoisted(() => ({
  registerCommandHandlers: vi.fn(),
  settingsDouble: {}
}));

vi.mock('obsidian-dev-utils/obsidian/command-handlers/command-handler-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a loadable Component exposing registerCommandHandlers.
  CommandHandlerComponent: vi.fn(function (): Component {
    return Object.assign(new Component(), { registerCommandHandlers });
  })
}));

vi.mock('obsidian-dev-utils/obsidian/components/menu-event-registrar-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a loadable Component.
  MenuEventRegistrarComponent: vi.fn(function (): Component {
    return new Component();
  })
}));

vi.mock('obsidian-dev-utils/obsidian/active-file-provider', () => ({
  AppActiveFileProvider: vi.fn()
}));

// `PluginDataHandler` and `PluginEventSourceImpl` are NOT stubbed: since obsidian-dev-utils 93.2 the base
// Builds its own settings component out of them during `onload`, and that component really calls
// `pluginEventSource.on`, so a bare `vi.fn()` double makes the base throw before `onloadImpl` runs.

vi.mock('obsidian-dev-utils/obsidian/command-registrar', () => ({
  PluginCommandRegistrar: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/components/plugin-settings-tab-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PluginSettingsTabComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./plugin-settings-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component carrying the settings the plugin reads.
  PluginSettingsComponent: vi.fn(function () {
    return Object.assign(new Component(), { settings: settingsDouble });
  })
}));

vi.mock('./plugin-settings-tab.ts', () => ({
  PluginSettingsTab: vi.fn()
}));

vi.mock('./advanced-markdown-export-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  AdvancedMarkdownExportComponent: vi.fn(function () {
    return new Component();
  })
}));

// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { Plugin } from './plugin.ts';

describe('Plugin', () => {
  let app: App;
  let manifest: PluginManifest;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();

    // Fire layout-ready synchronously so the real lifecycle completes within the test.
    appOriginal.workspace.onLayoutReady = vi.fn((callback: () => void) => {
      callback();
    });

    manifest = {
      author: 'test',
      description: 'test',
      id: 'test-plugin',
      minAppVersion: '0.0.0',
      name: 'Test Plugin',
      version: '1.0.0'
    };
  });

  it('should wire up all child components on load', async () => {
    const appOriginal = app.asOriginalType__();
    const plugin = new Plugin(appOriginal, manifest);
    await plugin.onload();

    expect(plugin).toBeInstanceOf(Plugin);
    expect(PluginSettingsComponent).toHaveBeenCalledOnce();
    expect(PluginSettingsTab).toHaveBeenCalledOnce();
    expect(PluginSettingsTabComponent).toHaveBeenCalledOnce();
    expect(AdvancedMarkdownExportComponent).toHaveBeenCalledOnce();
  });

  /*
   * The settings are read per export rather than captured at load, so changing one takes effect without
   * reloading the plugin.
   */
  it('should hand the export component a live view of the settings', async () => {
    const plugin = new Plugin(app.asOriginalType__(), manifest);
    await plugin.onload();

    const params = vi.mocked(AdvancedMarkdownExportComponent).mock.calls[0]?.[0];
    expect(params?.settingsProvider()).toBe(settingsDouble);
  });

  it('should register the open demo vault command handler', async () => {
    const plugin = new Plugin(app.asOriginalType__(), manifest);
    await plugin.onload();

    // Since obsidian-dev-utils 89.0.0 the handlers are built lazily by a factory, and the base registers
    // Its own batch through the same spy - so build every batch and look across them.
    const commandHandlers = registerCommandHandlers.mock.calls
      .flatMap(([commandHandlerFactory]) => castTo<() => unknown[]>(commandHandlerFactory)());
    expect(commandHandlers).toEqual(expect.arrayContaining([expect.any(OpenDemoVaultCommandHandler)]));
  });
});
