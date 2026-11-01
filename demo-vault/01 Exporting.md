# Exporting

An export starts from a set of **roots** and grows downwards through their dependencies. You can start one from any of these:

- Right-click a note in the file explorer and choose **Export with dependencies**.
- Right-click a folder — every note inside it becomes a root of its own.
- Select several files, then right-click — each selected file is a root.
- Run the **Export active note with its dependencies** command.
- Run the **Export the whole vault** command — every note in the vault becomes a root.

```code-button
---
caption: Open the export dialog for the example note
---
await require('/demoSetup.ts').openExportDialogForExampleNote(app);
```

Manual equivalent: right-click `Example/A.md` in the file explorer and choose **Export with dependencies**.

## The defaults, and why

Attachments arrive **checked**; linked notes arrive **unchecked**.

That asymmetry is the point of the plugin. An embedded image is part of the note — send the note without it and the recipient gets a broken page. A linked note is a separate document: it may be relevant background, or it may be a private journal entry you never meant to hand over. Worse, including it drags in *its* attachments and *its* links, so a default of "include everything" quietly turns one note into a hundred.

Both defaults are settings, so if your vault works the other way round you can flip them — see [03 Settings](<./03 Settings.md>).

## Depth is something you do, not something you type

There is no "export to depth 3" box to guess at. Tick a linked note and it expands, applying the same rule one level further down: its attachments come in checked, its own linked notes do not. Keep ticking and the tree keeps growing.

The **Maximum traversal depth** setting is only a safety cap on that growth, not the control. Nothing is walked until you ask for it, which is what keeps a folder of a few thousand notes from freezing the dialog when you open it.

## What the dialog tells you

Above the tree is a running **file count and total size**, updated as you tick. It is the answer to "is this export getting huge?" — the question that decides whether you send a folder or reconsider what you included, and the one thing no comparable plugin shows you.

Along the top are the bulk actions:

- **Expand all** / **Collapse all** — expand-all is bounded by the traversal cap, which is the other job that setting does.
- **Check attachments** — ticks every attachment currently in the tree, wherever it sits.
- **Invert** — swaps checked for unchecked across everything that has a file behind it.
- **Clear** — unticks everything. With nothing selected there is nothing to export, so the **Export** button turns itself off.

## Unticking takes back what ticking brought in

Ticking a note pulls its attachments in with it. Unticking it puts them back — but only the ones nothing else still wants. If `A1.png` hangs off both `A` and `C` and you untick `C`, `A1.png` stays, because `A` is still checked and still needs it.

Roots are the exception: those are your explicit picks, so unticking something else never drops one.

## Files that appear more than once

A graph is not a tree. The same file can be reached by two different paths, or a chain of links can lead back where it started.

The first place a file appears **owns** it: that is the live checkbox, and that is where its dependencies expand. Anywhere else it turns up — down a second path, or looping back on itself — it renders greyed out and disabled, mirroring whatever the first occurrence says. Click it to jump to the one that counts.

So a cycle cannot expand forever, a file is never exported twice, and the checkbox for a given file never moves around on you.

## What you get

The bundle keeps the folder structure it had in the vault. That is deliberate: links between the files you included still resolve after unzipping, and two files that share a name cannot overwrite each other.

Links pointing at files you left out are the one case that needs a decision — the **Dangling links** setting makes it.

That rewriting applies to markdown. Every other file is copied byte for byte, a canvas included — so a canvas node pointing at a file you excluded keeps that node as it was, whatever the setting says.

### `Dataview` and `Tasks` queries

A note built on a `Dataview` or `Tasks` query is only a query on disk. Send it to someone without that plugin and they get the query text, not the list it shows you.

Turn on **Render plugin code blocks** and each such block is replaced in the exported note by what it renders, converted to markdown: a table stays a table, a task list stays a list. The **Rendered code block languages** setting says which blocks count; it starts with `dataview`, `dataviewjs` and `tasks`. Links inside the rendered output follow the **Dangling links** setting like any other link.

It is off by default, because a recipient who has the plugin may want the live query rather than a snapshot. Only blocks at the start of a line are rendered: a query inside a list, a quote or a callout stays as written. A block whose plugin is not installed, or that renders nothing, also stays as written.

## One document instead of a bundle: EPUB and PDF

The **Format** dropdown under the tree decides what the selection becomes. **Markdown files** is the bundle described above. The other two turn the checked notes into a single document, rendered the way Reading view shows them:

- **EPUB book** — a chapter per note, in tree order, with a table of contents. Images the notes embed are packed into the book. Works on every platform.
- **PDF document** — each note starts on a new page, printed in the light theme with your theme and snippets applied, on the **PDF page size** you chose. Desktop only, because it is Electron that prints it; on a phone the dropdown does not offer it.

Only notes become chapters or pages. An attachment travels only as what a note embeds, so ticking an image on its own adds nothing.

Links are settled for a document that has no vault around it. A link to another checked note jumps to that note inside the document. A link or embed whose target you left out follows **Dangling links**: kept as it is (a link then opens the note in Obsidian through an `obsidian://` link, and an embed stays rendered), replaced by its text, or removed. A link that points at nothing becomes its text.

`Dataview` and `Tasks` blocks render here whatever **Render plugin code blocks** says, because the document is what Reading view shows.

## Where it goes

On the desktop, choosing **Export** opens a system directory picker, so the bundle can land anywhere — including outside your vault. An EPUB or a PDF gets the system save dialog instead, named after what you exported.

On mobile there is no such picker, so the bundle goes to a vault-relative folder instead: the **Output folder** setting if you have set one, otherwise a folder you are asked to name once per export. Turn on **Create a ZIP archive** and you get a single `.zip` instead of a folder, on either platform. An EPUB lands in the same place, as `<name>.epub`.
