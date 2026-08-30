# Export with Dependencies

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-export-with-dependencies)](https://github.com/mnaoumov/obsidian-export-with-dependencies/releases) [![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-export-with-dependencies/total)](https://github.com/mnaoumov/obsidian-export-with-dependencies/releases)

Send someone a note and it arrives broken: the images are missing and every `[[link]]` is dead. Copying the whole folder over-shares, and copying just the `.md` under-shares. This plugin walks the note's dependencies for you and shows them as a tree of checkboxes, so you decide exactly what travels with it — then writes the bundle out with its links still working.

## What makes it different

**Attachments and linked notes are not the same thing, so they do not get the same default.** An embedded image is part of the note; a linked note is a separate document you may or may not want to hand over. So attachments arrive **checked** and linked notes arrive **unchecked**:

```text
[x] A.md
  [x] A1.jpg
  [x] A2.jpg

  [ ] B.md
```

**Depth is driven by your ticks, not by a number you guess up front.** Tick `B.md` and it expands, applying the same rule one level deeper — `B`'s attachments come in checked, `B`'s own linked notes do not:

```text
[x] A.md
  [x] A1.jpg
  [x] A2.jpg
  [x] B.md
    [x] B3.jpg
    [x] B4.jpg
    [ ] C.md
```

**The export has many roots.** Start from one note, from a multi-selection in the file explorer, or from a whole folder — every note in it becomes a root, and the tree becomes a forest.

**Links that survive the trip.** The bundle keeps its vault-relative structure, so links between included files still resolve after extraction and two files with the same name cannot collide. Links to files you left out are handled by a policy you choose rather than silently breaking.

## Usage

- Right-click a note in the file explorer → **Export with dependencies**.
- Right-click a folder → every note in it becomes a root.
- Select several files, right-click → **Export with dependencies**.
- Command palette → **Export active note with its dependencies**.

## Demo vault

**The documentation is a demo vault.** Every feature has a note that explains what it does, with a worked example graph you can export yourself.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on GitHub with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **Export with Dependencies: Open demo vault** command.
2. Downloading `export-with-dependencies-demo-vault-<version>.zip` (`<version>` is the release version) from the [Releases](https://github.com/mnaoumov/obsidian-export-with-dependencies/releases).
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## Installation

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-export-with-dependencies).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command:

```js
window.DEBUG.enable('export-with-dependencies');
```

For more details, refer to the [documentation](https://mnaoumov.dev/obsidian-dev-utils/guides/debugging/).

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING](./CONTRIBUTING.md) to get set up.

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
