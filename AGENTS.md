# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Advanced Markdown Export exports a set of notes together with the files they depend on. The user picks what travels in a checkbox tree; the plugin writes the bundle out with its internal links still resolving.

## Architecture

Three layers. The bottom two are headless and unit-testable with no DOM, which is deliberate — the graph rules are where the correctness risk lives.

- `src/dependency-resolver.ts` — one file's **direct** dependencies. Never call it for a node the user has not expanded or ticked; lazy expansion is a hard requirement, not an optimization (a folder root can be thousands of notes). Asserted by a call-counter test in `export-forest.test.ts`.
- `src/export-forest.ts` — the selection model: roots as a set, first-occurrence ownership, repeats as disabled mirrors, tick-driven depth.
- `src/export-writer.ts` — walks the chosen files and rewrites their links. Where the bytes land is behind the `ExportTarget` seam, implemented in `src/export-targets/`.
- `src/export-destination/` — a facade choosing between the desktop directory picker (`window.electron` + `node:fs`) and the in-vault folder used on mobile. The desktop module must never be statically imported: it is reached by a conditional `await import()` gated on `Platform.isDesktopApp`. `isDesktopApp`, not `isDesktop` — the module needs Electron, and that is the flag that says Electron is there, which is also why it needs no `window.electron` presence check of its own.
- `src/modals/` — the tree UI. `obsidian-dev-utils` has no tree component, so this is hand-built on Obsidian's native `tree-item` classes.
- `src/export-flow.desktop.integration.test.ts` — the one test that proves the pieces fit. It mocks only the OS directory dialog and drives the real menu, the real modal DOM and the real writer, then reads the bundle back off disk. It is what caught the bundle being named after a note's *path* rather than its name.
- `src/folder-root-scale.desktop-performance.integration.test.ts` — lazy expansion as a user can see it: a 300-note folder root draws 300 rows and not one more. The fixture notes all embed the same attachment, so an eager-expansion regression shows up as extra rows rather than as a slow test on a slow machine.

## Invariants that are easy to break

- **The first occurrence of a file owns its live checkbox.** Every later occurrence — a cycle, a diamond, a folder member reached through a sibling — renders disabled and mirrors the owner's state, including when the owner is *unchecked*. Never let a repeat become the live checkbox: a checkbox that migrates between rows as the user toggles is worse than one that stays put.
- **`maxTraversalDepth` is a traversal cap, not the depth control.** The user's ticks drive depth. The cap only stops unbounded growth.
- **Attachment/note classification drives the default check state**, and that policy is a setting — never hard-code the attachments-on/notes-off rule at a call site.
- **Unchecking a note drops what it pulled in, but only what nothing else still holds.** `pruneOrphanedDescendants` is what makes the tree tell the truth about the export set; without it an unticked note leaves its auto-ticked attachments behind and they ship anyway. Roots are exempt — they are the user's explicit pick.
- **Link rewriting is markdown-only.** Everything else, a canvas included, is copied byte for byte, so a canvas node pointing out of the export keeps its link whatever the dangling-link setting says. Documented in `demo-vault/01 Exporting.md`; rewriting canvas JSON would mean `referenceToFileChange` + `applyFileChanges` rather than `editLinksInContent`.

## Deviations from the standard plugin architecture

The workspace convention is that all plugins share the same architecture; intentional deviations are documented here.

- **`demo-vault/Example/` is excluded from `lint:md`** in `scripts/markdownlint-cli2-config.ts`. Those notes are the fixture graph the plugin is demonstrated on, so they exist to carry real wikilinks and embeds — every one of which markdownlint reads as an undefined shortcut reference (MD052). Disable comments inside the fixtures would travel into every exported bundle the demo produces, so the folder is excluded instead. The same notes are excluded from the demo-vault authoring checks, for the same reason.
- **Ships a ZIP dependency (`fflate`)** — no other workspace plugin bundles a compression library. It is reached only from `src/export-targets/zip-export-target.ts`, so the folder-output path stays dependency-free. It needs no `overrides` entry; nothing else in the tree pins it.
- **`type-fest` is declared directly**, for the `ReadonlyDeep` view the settings component hands out. Its pre-existing `overrides` entry had to become the self-referencing `"$type-fest"` form: with a literal version there, `npm install type-fest` fails with `EOVERRIDE`. Other fleet plugins use the same form for the same reason.
- **`src/format-bytes.ts` and `src/to-array-buffer.ts` belong in `obsidian-dev-utils`.** Neither is specific to exporting and ODU has no equivalent today. Kept local rather than growing this branch into an ODU release; move them when ODU is next opened.
