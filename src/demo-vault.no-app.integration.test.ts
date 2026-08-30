import process from 'node:process';
import { registerDemoVaultCoverageSuite } from 'obsidian-dev-utils/script-utils/demo-vault-coverage';
import { getRootFolder } from 'obsidian-dev-utils/script-utils/root';

// Keeps the in-repo `demo-vault/` in sync with the plugin's public surface WITHOUT
// Launching Obsidian: it reflects the real config from source and asserts every
// Setting is documented in a note, and that the guard note/member still exist
// (rename drift).
//
// The `Example/` notes are the fixture graph the plugin is demonstrated ON, not lessons about it, so
// They sit outside the authoring checks - they deliberately carry wikilinks and no explanatory prose,
// Because that is what makes them a realistic thing to export.
registerDemoVaultCoverageSuite({
  authoring: {
    excludedNotes: [
      'README.md',
      'Example/A.md',
      'Example/B.md',
      'Example/C.md'
    ]
  },
  configInterfaces: [{ interfaceName: 'PluginSettings', sourcePath: 'src/plugin-settings.ts' }],
  interfaces: [],
  nonTrivialGuard: {
    expectDemoNote: '03 Settings.md',
    expectMember: 'shouldCheckAttachmentsByDefault',
    interfaceName: 'PluginSettings',
    sourcePath: 'src/plugin-settings.ts'
  },
  rootFolder: getRootFolder() ?? process.cwd()
});
