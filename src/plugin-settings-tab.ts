import type { SettingDefinitionItem } from 'obsidian';

import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import type { PluginSettings } from './plugin-settings.ts';

import { DanglingLinkAction } from './plugin-settings.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingEx({
        desc: 'What happens to a link pointing at a file you left out of the export.',
        name: 'Dangling links',
        render: (setting) => {
          setting.addTypedDropdown((typedDropdown) => {
            const map = new Map<DanglingLinkAction, string>([
              [DanglingLinkAction.KeepAsIs, 'Keep as is'],
              [DanglingLinkAction.Remove, 'Remove the link and its text'],
              [DanglingLinkAction.ReplaceWithDisplayText, 'Replace with its display text']
            ]);
            typedDropdown.addOptions(map);
            this.bind({ propertyName: 'danglingLinkAction', valueComponent: typedDropdown });
          });
        }
      }),
      this.settingEx({
        desc: 'Files in these folders are never offered as dependencies.',
        name: 'Ignored folders',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({ propertyName: 'ignoredFolders', valueComponent: multipleText });
          });
        }
      }),
      this.settingEx({
        desc: 'Notes carrying these tags are never offered as dependencies.',
        name: 'Ignored tags',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({ propertyName: 'ignoredTags', valueComponent: multipleText });
          });
        }
      }),
      this.settingEx({
        desc: 'A safety cap on how deep the tree may grow. This is not the depth control - depth is driven by which notes you tick. The cap only stops a pathological graph expanding without bound.',
        name: 'Maximum traversal depth',
        render: (setting) => {
          setting.addNumber((number) => {
            this.bind({ propertyName: 'maxTraversalDepth', valueComponent: number });
          });
        }
      }),
      this.settingEx({
        desc: 'Where bundles are written. Leave empty to be asked every time.',
        name: 'Output folder',
        render: (setting) => {
          setting.addText((text) => {
            this.bind({ propertyName: 'outputFolderPath', valueComponent: text });
          });
        }
      }),
      this.settingEx({
        desc: 'An embedded image is part of the note, so it arrives checked.',
        name: 'Check attachments by default',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldCheckAttachmentsByDefault', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'A linked note is a separate document, and pulling it in pulls in its dependencies too - so it arrives unchecked.',
        name: 'Check linked notes by default',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldCheckLinkedNotesByDefault', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'Compress the bundle into a single .zip instead of writing a folder.',
        name: 'Create a ZIP archive',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldCreateZip', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'When a folder is the export root, also take the notes of its subfolders as roots.',
        name: 'Include subfolders',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeSubfolders', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'Treat an embedded markdown note as an attachment rather than a linked note, so it inherits the attachment default.',
        name: 'Treat embeds as attachments',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldTreatEmbedsAsAttachments', valueComponent: toggle });
          });
        }
      })
    ];
  }
}
