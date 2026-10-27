import type { DataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import type { PluginEventSource } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';

import { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import {
  DanglingLinkAction,
  PluginSettings
} from './plugin-settings.ts';

interface ProtectedBase {
  readonly onLoadRecord: (record: unknown) => Promise<void>;
  readonly onSavingRecord: (record: unknown) => Promise<void>;
  readonly registerValidator: (key: string, validator: unknown) => void;
  readonly registerValidators: () => void;
}

interface RegisteredValidator {
  readonly key: string;
  readonly validator: (value: number) => string | undefined;
}

const protectedBasePrototype = castTo<ProtectedBase>(PluginSettingsComponentBase.prototype);

describe('PluginSettingsComponent', () => {
  function createComponent(): PluginSettingsComponent {
    return new PluginSettingsComponent({
      dataHandler: strictProxy<DataHandler>({}),
      pluginEventSource: strictProxy<PluginEventSource>({})
    });
  }

  it('should create an instance', () => {
    const component = createComponent();
    expect(component).toBeInstanceOf(PluginSettingsComponent);
  });

  it('should create default PluginSettings as defaultSettings', () => {
    const component = createComponent();
    expect(component.defaultSettings).toBeInstanceOf(PluginSettings);
  });

  describe('onLoadRecord', () => {
    it('should deserialize danglingLinkAction from its stored name', async () => {
      const component = createComponent();
      const record: Record<string, unknown> = { danglingLinkAction: 'Remove' };
      await component['onLoadRecord'](record);
      expect(record['danglingLinkAction']).toBe(DanglingLinkAction.Remove);
    });

    it('should leave the record alone when danglingLinkAction is absent', async () => {
      const component = createComponent();
      const record: Record<string, unknown> = {};
      await component['onLoadRecord'](record);
      expect(record['danglingLinkAction']).toBeUndefined();
    });

    it('should call super.onLoadRecord', async () => {
      const superSpy = vi.spyOn(protectedBasePrototype, 'onLoadRecord').mockResolvedValue();
      const component = createComponent();
      const record: Record<string, unknown> = {};
      await component['onLoadRecord'](record);
      expect(superSpy).toHaveBeenCalledWith(record);
      superSpy.mockRestore();
    });
  });

  describe('onSavingRecord', () => {
    it('should serialize danglingLinkAction down to its name', async () => {
      const component = createComponent();
      const record: Record<string, unknown> = { danglingLinkAction: DanglingLinkAction.ReplaceWithDisplayText };
      await component['onSavingRecord'](record);
      expect(record['danglingLinkAction']).toBe('ReplaceWithDisplayText');
    });

    it('should call super.onSavingRecord', async () => {
      const superSpy = vi.spyOn(protectedBasePrototype, 'onSavingRecord').mockResolvedValue();
      const component = createComponent();
      const record: Record<string, unknown> = {};
      await component['onSavingRecord'](record);
      expect(superSpy).toHaveBeenCalledWith(record);
      superSpy.mockRestore();
    });
  });

  describe('registerValidators', () => {
    function getRegisteredValidators(): RegisteredValidator[] {
      const registered: RegisteredValidator[] = [];
      const registerValidatorSpy = vi.spyOn(protectedBasePrototype, 'registerValidator')
        .mockImplementation((key, validator) => {
          registered.push({
            key,
            validator: castTo<RegisteredValidator['validator']>(validator)
          });
        });
      const superSpy = vi.spyOn(protectedBasePrototype, 'registerValidators').mockImplementation(() => undefined);
      const component = createComponent();
      component['registerValidators']();
      registerValidatorSpy.mockRestore();
      superSpy.mockRestore();
      return registered;
    }

    it('should reject a traversal cap below one', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'maxTraversalDepth');
      expect(validator).toBeDefined();
      expect(validator?.validator(0)).toBe('The traversal cap must be at least 1');
    });

    it('should accept a traversal cap of one or more', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'maxTraversalDepth');
      expect(validator?.validator(1)).toBeUndefined();
    });
  });
});
