# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Export with Dependencies exports a set of notes together with the files they depend on. The user picks what travels in a checkbox tree; the plugin writes the bundle out with its internal links still resolving.

## Architecture

Three layers. The bottom two are headless and unit-testable with no DOM, which is deliberate — the graph rules are where the correctness risk lives.

- `src/dependency-resolver.ts` — one file's **direct** dependencies. Never call it for a node the user has not expanded or ticked; lazy expansion is a hard requirement, not an optimization (a folder root can be thousands of notes).
- `src/export-forest.ts` — the selection model: roots as a set, first-occurrence ownership, repeats as disabled mirrors, tick-driven depth.
- `src/export-writer.ts` — writes the bundle, folder or ZIP, preserving vault-relative paths.
- `src/modals/` — the tree UI. `obsidian-dev-utils` has no tree component, so this is hand-built on Obsidian's native `tree-item` classes.

## Invariants that are easy to break

- **The first occurrence of a file owns its live checkbox.** Every later occurrence — a cycle, a diamond, a folder member reached through a sibling — renders disabled and mirrors the owner's state, including when the owner is *unchecked*. Never let a repeat become the live checkbox: a checkbox that migrates between rows as the user toggles is worse than one that stays put.
- **`maxDepth` is a traversal cap, not the depth control.** The user's ticks drive depth. The cap only stops unbounded growth.
- **Attachment/note classification drives the default check state**, and that policy is a setting — never hard-code the attachments-on/notes-off rule at a call site.

## Deviations from the standard plugin architecture

The workspace convention is that all plugins share the same architecture; intentional deviations are documented here.

- **`demo-vault/Example/` is excluded from `lint:md`** in `scripts/markdownlint-cli2-config.ts`. Those notes are the fixture graph the plugin is demonstrated on, so they exist to carry real wikilinks and embeds — every one of which markdownlint reads as an undefined shortcut reference (MD052). Disable comments inside the fixtures would travel into every exported bundle the demo produces, so the folder is excluded instead. The same notes are excluded from the demo-vault authoring checks, for the same reason.
- **Will ship a ZIP dependency (`fflate`)** once `src/export-writer.ts` lands. No other workspace plugin bundles a compression library. It stays behind the writer interface so the folder-output path remains dependency-free.
