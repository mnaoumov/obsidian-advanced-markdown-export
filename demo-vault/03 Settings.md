# Settings

Open **Settings -> Community plugins -> Advanced Markdown Export**. Each option below lists the setting key stored in the plugin's `data.json`.

## What arrives checked

- `shouldCheckAttachmentsByDefault`
  - whether an attachment is checked when it first appears. On, because an embedded image is part of the note.
- `shouldCheckLinkedNotesByDefault`
  - whether a linked note is checked when it first appears. Off, because a linked note is a separate document and pulling it in pulls in its dependencies too.
- `shouldTreatEmbedsAsAttachments`
  - whether an embedded markdown note counts as an attachment rather than a linked note, and so takes the attachment default instead. An embed reads as part of its host note, which is the argument for turning this on.

## How far the walk goes

- `maxTraversalDepth`
  - a safety cap on how deep the tree may grow. Not the depth control — depth is driven by which notes you tick. The cap only stops a pathological graph from expanding without bound.
- `shouldIncludeSubfolders`
  - whether a folder root also takes the notes of its subfolders as roots.
- `ignoredFolders`
  - files in these folders are never offered as dependencies.
- `ignoredTags`
  - notes carrying these tags are never offered as dependencies.

## What gets written

- `outputFolderPath`
  - the vault-relative folder bundles are written to **on mobile**, where there is no system directory picker. Leave it empty to be asked to name one each time. On the desktop it is not read at all: choosing Export opens a directory picker, so the bundle can land anywhere, including outside the vault.
- `shouldCreateZip`
  - compress the bundle into a single `.zip` instead of writing a folder.
- `danglingLinkAction`
  - what happens to a link pointing at a file you left out: keep it as it is, replace it with its display text, or remove it entirely.
