# CHANGELOG

## 1.0.2

- chore(deps): update obsidian-test-mocks to 7 and obsidian-integration-testing to 17
- test: restore full branch coverage
- test: warm up the export destination before the integration tests use it
- test(capture): apply the dark theme through applyObsidianTheme
- docs: refresh the developer notes on the ZIP dependency and on re-shot screenshots

## 1.0.1

- fix: export on mobile. The export used to close its dialog and do nothing at all on a phone or tablet; it now opens the destination prompt and writes the bundle
- fix: create the output folder on mobile when the vault does not have it yet, instead of silently writing nothing
- fix(deps): update `devalue` to 5.9.4 (GHSA-9rgm-9g3h-6x36)
- docs: add store screenshots and a README gallery
- chore(deps): update dependencies

## 1.0.0

- Initial implementations
