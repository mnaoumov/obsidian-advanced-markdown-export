# Exporting

An export starts from a set of **roots** and grows downwards through their dependencies. You can start one from any of these:

- Right-click a note in the file explorer and choose **Export with dependencies**.
- Right-click a folder — every note inside it becomes a root of its own.
- Select several files, then right-click — each selected file is a root.
- Run the **Export active note with its dependencies** command.

## The defaults, and why

Attachments arrive **checked**; linked notes arrive **unchecked**.

That asymmetry is the point of the plugin. An embedded image is part of the note — send the note without it and the recipient gets a broken page. A linked note is a separate document: it may be relevant background, or it may be a private journal entry you never meant to hand over. Worse, including it drags in *its* attachments and *its* links, so a default of "include everything" quietly turns one note into a hundred.

Both defaults are settings, so if your vault works the other way round you can flip them — see [03 Settings](<./03 Settings.md>).

## Depth is something you do, not something you type

There is no "export to depth 3" box to guess at. Tick a linked note and it expands, applying the same rule one level further down: its attachments come in checked, its own linked notes do not. Keep ticking and the tree keeps growing.

The **Maximum traversal depth** setting is only a safety cap on that growth, not the control. Nothing is walked until you ask for it, which is what keeps a folder of a few thousand notes from freezing the dialog when you open it.

## Files that appear more than once

A graph is not a tree. The same file can be reached by two different paths, or a chain of links can lead back where it started.

The first place a file appears **owns** it: that is the live checkbox, and that is where its dependencies expand. Anywhere else it turns up — down a second path, or looping back on itself — it renders greyed out and disabled, mirroring whatever the first occurrence says. Click it to jump to the one that counts.

So a cycle cannot expand forever, a file is never exported twice, and the checkbox for a given file never moves around on you.

## What you get

The bundle keeps the folder structure it had in the vault. That is deliberate: links between the files you included still resolve after unzipping, and two files that share a name cannot overwrite each other.

Links pointing at files you left out are the one case that needs a decision — the **Dangling links** setting makes it.
