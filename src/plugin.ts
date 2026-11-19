/* eslint-disable @typescript-eslint/no-unsafe-class-instance-assignment -- A false positive on every `this` and settings tab
 * here: `PluginBase` and the settings tab base extend a mixin (`mixinAsyncEvents()(Plugin)`), whose declared base is an
 * intersection the rule does not walk, so it cannot see that they ARE `Plugin` and `PluginSettingTab` instances. */
import { OpenBugReportCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-bug-report-command-handler';
import { OpenDemoVaultCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-demo-vault-command-handler';
import { PluginCommandRegistrar } from '@mnaoumov/obsidian-lib/command-registrar';
import { MenuEventRegistrarComponent } from '@mnaoumov/obsidian-lib/components/menu-event-registrar-component';
import { PluginSettingsTabComponent } from '@mnaoumov/obsidian-lib/components/plugin-settings-tab-component';
import { PluginDataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { PluginEventSourceImpl } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';

import type { ReadonlyPluginSettings } from './plugin-settings.ts';

import { AdvancedMarkdownExportComponent } from './advanced-markdown-export-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

export class Plugin extends PluginBase {
  protected override async onloadImpl(): Promise<void> {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;
    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab: new PluginSettingsTab({
          plugin: this,
          pluginSettingsComponent
        })
      })
    );

    this.addChild(
      new AdvancedMarkdownExportComponent({
        app: this.app,
        commandRegistrar: new PluginCommandRegistrar(this),
        menuEventRegistrar: this.addChild(new MenuEventRegistrarComponent(this.app)),
        pluginNoticeComponent: this.pluginNoticeComponent,
        // Read per export rather than captured, so a settings change takes effect without a reload.
        settingsProvider: (): ReadonlyPluginSettings => pluginSettingsComponent.settings
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenBugReportCommandHandler({
        app: this.app,
        gitHubRepo: 'mnaoumov/obsidian-advanced-markdown-export',
        pluginId: this.manifest.id
      }),
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-class-instance-assignment -- Ends the mixin false-positive block above. */
