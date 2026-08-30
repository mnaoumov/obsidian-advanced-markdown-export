/**
 * What to do with a link that points at a file the user chose NOT to export.
 */
export class DanglingLinkAction {
  /**
   * Keep the link exactly as it is. The bundle carries a link that does not resolve, which is the right
   * answer when the recipient has the rest of the vault, or when the export will be re-imported later.
   */
  public static readonly KeepAsIs = new DanglingLinkAction('KeepAsIs');

  /**
   * Remove the link and its display text entirely.
   */
  public static readonly Remove = new DanglingLinkAction('Remove');

  /**
   * Replace the link with just its display text, so the prose still reads correctly and nothing looks
   * clickable that is not.
   */
  public static readonly ReplaceWithDisplayText = new DanglingLinkAction('ReplaceWithDisplayText');

  public constructor(public readonly name: string) {}

  public static deserialize(name: string): DanglingLinkAction {
    const actions = [this.KeepAsIs, this.Remove, this.ReplaceWithDisplayText];
    const action = actions.find((candidate) => candidate.name === name);

    if (action === undefined) {
      throw new Error(`Unknown dangling link action: ${name}`);
    }

    return action;
  }
}

export class PluginSettings {
  /**
   * What happens to a link pointing at a file the user left out of the export.
   */
  public danglingLinkAction: DanglingLinkAction = DanglingLinkAction.KeepAsIs;

  /**
   * Folders whose files are never offered as dependencies. Matched against the file's path.
   */
  public ignoredFolders: readonly string[] = [];

  /**
   * Tags whose notes are never offered as dependencies.
   */
  public ignoredTags: readonly string[] = [];

  /**
   * A hard cap on how deep the tree may grow. This is a safety valve, NOT the depth control — depth is
   * driven by which notes the user ticks. The cap only stops a pathological graph from expanding without
   * bound.
   */
  /* eslint-disable-next-line no-magic-numbers -- In plugin settings magic numbers are allowed. */
  public maxTraversalDepth = 10;

  /**
   * Where bundles are written. Empty means ask every time.
   */
  public outputFolderPath = '';

  /**
   * Whether an attachment arrives already checked. On by default: an embedded image is part of the note.
   */
  public shouldCheckAttachmentsByDefault = true;

  /**
   * Whether a linked note arrives already checked. Off by default: a linked note is a separate document,
   * and pulling it in pulls in its own dependencies too.
   */
  public shouldCheckLinkedNotesByDefault = false;

  /**
   * Whether to compress the bundle into a single `.zip` instead of writing a folder.
   */
  public shouldCreateZip = false;

  /**
   * Whether a folder root pulls in the notes of its subfolders as roots too.
   */
  public shouldIncludeSubfolders = true;

  /**
   * Whether an embedded markdown note counts as an attachment rather than as a linked note, and so
   * inherits the attachment default. An embed reads as part of the host note, which is the argument for
   * turning this on.
   */
  public shouldTreatEmbedsAsAttachments = false;
}
