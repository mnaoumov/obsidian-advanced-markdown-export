import type { MarkdownlintCli2ConfigurationSchema } from 'obsidian-dev-utils/script-utils/linters/markdownlint-types/@types/markdownlint-cli2-config-schema';

import { obsidianDevUtilsConfig } from 'obsidian-dev-utils/script-utils/linters/markdownlint-cli2-config';

/*
 * `demo-vault/Example/` is the fixture GRAPH the plugin is demonstrated on, not documentation about it.
 * Its notes exist to carry real `[[wikilinks]]` and `![[embeds]]` for the exporter to walk, and
 * markdownlint reads every one of those as an undefined shortcut reference (MD052). Rather than salt the
 * fixtures with disable comments - which would then travel into every exported bundle the demo produces -
 * the folder is excluded outright. It is data; there is no prose in it to lint.
 */
export const config: MarkdownlintCli2ConfigurationSchema = {
  ...obsidianDevUtilsConfig,
  ignores: [
    ...obsidianDevUtilsConfig.ignores ?? [],
    'demo-vault/Example/**'
  ]
};
