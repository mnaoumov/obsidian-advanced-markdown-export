import type { MarkdownlintCli2ConfigurationSchema } from '@mnaoumov/typescript-dev-toolkit/linters/markdownlint-types/@types/markdownlint-cli2-config-schema';

import { obsidianMarkdownlintCli2Config } from '@mnaoumov/obsidian-dev-toolkit/linters/markdownlint-cli2-config';

/*
 * `demo-vault/Example/` is the fixture GRAPH the plugin is demonstrated on, not documentation about it.
 * Its notes exist to carry real `[[wikilinks]]` and `![[embeds]]` for the exporter to walk, and
 * markdownlint reads every one of those as an undefined shortcut reference (MD052). Rather than salt the
 * fixtures with disable comments - which would then travel into every exported bundle the demo produces -
 * the folder is excluded outright. It is data; there is no prose in it to lint.
 */
export const config: MarkdownlintCli2ConfigurationSchema = {
  ...obsidianMarkdownlintCli2Config,
  config: {
    ...obsidianMarkdownlintCli2Config.config,
    'no-soft-break-in-paragraph': true
  },
  ignores: [
    ...obsidianMarkdownlintCli2Config.ignores ?? [],
    'demo-vault/Example/**'
  ]
};
