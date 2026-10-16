import type { DataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import type { PluginEventSource } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';
import type { MaybeReturn } from '@mnaoumov/typescript-lib/type';
import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';

import { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';

import {
  DanglingLinkAction,
  PluginSettings
} from './plugin-settings.ts';

interface PluginSettingsComponentConstructorParams {
  readonly dataHandler: DataHandler;
  readonly pluginEventSource: PluginEventSource;
}

interface SerializedSettings {
  danglingLinkAction: string;
}

export class PluginSettingsComponent extends PluginSettingsComponentBase<PluginSettings> {
  public constructor(params: PluginSettingsComponentConstructorParams) {
    super({
      ...params,
      pluginSettingsClass: PluginSettings
    });
  }

  protected override async onLoadRecord(record: GenericObject): Promise<void> {
    await super.onLoadRecord(record);
    const serializedSettings = record as Partial<SerializedSettings>;
    const pluginSettings = record as Partial<PluginSettings>;

    if (serializedSettings.danglingLinkAction) {
      pluginSettings.danglingLinkAction = DanglingLinkAction.deserialize(serializedSettings.danglingLinkAction);
    }
  }

  protected override async onSavingRecord(record: GenericObject): Promise<void> {
    await super.onSavingRecord(record);
    const serializedSettings = record as Partial<SerializedSettings>;
    const pluginSettings = record as Partial<PluginSettings>;

    if (pluginSettings.danglingLinkAction) {
      serializedSettings.danglingLinkAction = pluginSettings.danglingLinkAction.name;
    }
  }

  protected override registerValidators(): void {
    super.registerValidators();
    this.registerValidator('maxTraversalDepth', (value): MaybeReturn<string> => {
      if (value < 1) {
        return 'The traversal cap must be at least 1';
      }
    });
  }
}
