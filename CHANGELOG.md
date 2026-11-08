# CHANGELOG

## 1.2.0

This release has 2 new features, 1 fix and 2 documentation changes. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- export a folder, a selection or the whole vault as EPUB or PDF
- render `Dataview` and Tasks code blocks into the export

### Fixed

- **pdf:** open the print popup with Obsidian 1.15.1's popup token

### Documentation

- make issue attachments optional and strongly encouraged
- link to the Obsidian resources page

## 1.1.0

This release has 1 new feature and 4 documentation changes. 8 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add a Report a bug command

### Documentation

- **readme:** point bug reports at the Report a bug command
- add issue-filing instructions for AI agents
- **readme:** combine related resources and plugin comparisons
- add a Similar plugins section to the README

## 1.0.3

This release has 3 documentation changes. 5 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Documentation

- **readme:** lead the Debugging section with `Advanced Debug Mode`, and shorten it
- **demo-vault:** add code buttons to the example-graph Try it walkthrough
- mark plugin names as code

## 1.0.2

This release has 1 documentation change. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Documentation

- refresh the developer notes on the ZIP dependency and on re-shot screenshots

## 1.0.1

This release has 3 fixes and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- export on mobile. The export used to close its dialog and do nothing at all on a phone or tablet; it now opens the destination prompt and writes the bundle
- create the output folder on mobile when the vault does not have it yet, instead of silently writing nothing
- **deps:** update `devalue` to 5.9.4 (GHSA-9rgm-9g3h-6x36)

### Documentation

- add store screenshots and a README gallery

## 1.0.0

- Initial implementations
