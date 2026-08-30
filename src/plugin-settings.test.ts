import {
  describe,
  expect,
  it
} from 'vitest';

import {
  DanglingLinkAction,
  PluginSettings
} from './plugin-settings.ts';

describe('DanglingLinkAction', () => {
  it('should expose a static instance per action', () => {
    expect(DanglingLinkAction.KeepAsIs.name).toBe('KeepAsIs');
    expect(DanglingLinkAction.Remove.name).toBe('Remove');
    expect(DanglingLinkAction.ReplaceWithDisplayText.name).toBe('ReplaceWithDisplayText');
  });

  it('should deserialize every known action back to its singleton', () => {
    expect(DanglingLinkAction.deserialize('KeepAsIs')).toBe(DanglingLinkAction.KeepAsIs);
    expect(DanglingLinkAction.deserialize('Remove')).toBe(DanglingLinkAction.Remove);
    expect(DanglingLinkAction.deserialize('ReplaceWithDisplayText')).toBe(DanglingLinkAction.ReplaceWithDisplayText);
  });

  it('should throw for an unknown action name', () => {
    expect(() => DanglingLinkAction.deserialize('Unknown')).toThrow('Unknown dangling link action: Unknown');
  });
});

describe('PluginSettings', () => {
  /*
   * The attachments-checked / notes-unchecked pair is the plugin's whole premise, so its defaults are
   * asserted rather than left to the settings tab.
   */
  it('should check attachments but not linked notes by default', () => {
    const settings = new PluginSettings();
    expect(settings.shouldCheckAttachmentsByDefault).toBe(true);
    expect(settings.shouldCheckLinkedNotesByDefault).toBe(false);
  });

  it('should default to keeping dangling links as they are', () => {
    const settings = new PluginSettings();
    expect(settings.danglingLinkAction).toBe(DanglingLinkAction.KeepAsIs);
  });

  it('should default the traversal cap to a finite, usable depth', () => {
    const settings = new PluginSettings();
    expect(settings.maxTraversalDepth).toBeGreaterThan(0);
    expect(Number.isFinite(settings.maxTraversalDepth)).toBe(true);
  });

  it('should default to a folder export, asked-for destination, and subfolders included', () => {
    const settings = new PluginSettings();
    expect(settings.shouldCreateZip).toBe(false);
    expect(settings.outputFolderPath).toBe('');
    expect(settings.shouldIncludeSubfolders).toBe(true);
  });

  it('should not treat embeds as attachments by default', () => {
    const settings = new PluginSettings();
    expect(settings.shouldTreatEmbedsAsAttachments).toBe(false);
  });

  it('should start with no ignore rules', () => {
    const settings = new PluginSettings();
    expect(settings.ignoredFolders).toEqual([]);
    expect(settings.ignoredTags).toEqual([]);
  });
});
