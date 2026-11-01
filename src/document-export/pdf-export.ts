import type { RenderedNote } from './note-renderer.ts';

/**
 * Lets the popup lay out its moved content before it is printed. Obsidian's own **Export to PDF** waits
 * the same 200 ms at the same point.
 */
const LAYOUT_DELAY_IN_MILLISECONDS = 200;

/**
 * The parameters for {@link printNotesToPdf}.
 */
export interface PrintNotesToPdfParams {
  /**
   * The rendered notes, in page order. They are MOVED into the print window, so the caller must not use
   * them afterwards except to dispose of them.
   */
  readonly notes: readonly RenderedNote[];

  /**
   * A paper size `printToPDF` knows by name.
   */
  readonly pageSize: string;

  /**
   * The document's title.
   */
  readonly title: string;
}

/**
 * Prints rendered notes into one PDF, the way Obsidian's own **Export to PDF** prints one note: a hidden
 * popup window gets the app's stylesheets and a light theme, the content goes into a `div.print` (which
 * Obsidian's print styles target), and Electron prints that window's web contents.
 *
 * Desktop only: it needs Electron, so it is imported dynamically behind `Platform.isDesktopApp`, like the
 * desktop destination.
 *
 * @param params - The parameters.
 * @returns The PDF's bytes.
 */
export async function printNotesToPdf(params: PrintNotesToPdfParams): Promise<Uint8Array> {
  const popup = window.open('about:blank', '_blank', 'popup,hide=true');

  if (!popup) {
    throw new Error('Could not open the window the PDF is printed from.');
  }

  try {
    const popupDocument = popup.document;
    /*
     * Every element is created in THIS window and moved across: the popup is a bare `about:blank` that
     * Obsidian never set up, so its own nodes lack the `createEl` helpers Obsidian adds to its windows.
     * The base element makes the app's relative URLs - fonts, images - resolve as they do here.
     */
    popupDocument.head.append(popupDocument.adoptNode(createEl('base', { href: location.href })));

    /*
     * A bare popup has no `electron` of its own either, so its web contents are found from THIS window's
     * `remote`, by a title nothing else carries. The real title replaces it once they are found.
     */
    const titleToken = `advanced-markdown-export-print-${String(Date.now())}-${String(Math.random())}`;
    popupDocument.title = titleToken;

    /*
     * The app's stylesheets, this plugin's own among them: its `styles.css` carries the page break between
     * notes.
     */
    for (const styleEl of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
      popupDocument.head.append(popupDocument.importNode(styleEl, true));
    }

    popupDocument.body.className = document.body.className;
    popupDocument.body.classList.remove('theme-dark');
    popupDocument.body.classList.add('theme-light');
    popupDocument.body.setAttribute('style', document.body.getAttribute('style') ?? '');

    const printEl = popupDocument.adoptNode(createDiv({ cls: 'print' }));
    popupDocument.body.append(printEl);

    for (const note of params.notes) {
      printEl.append(popupDocument.adoptNode(note.element));
    }

    await new Promise<void>((resolve) => {
      popup.setTimeout(resolve, LAYOUT_DELAY_IN_MILLISECONDS);
    });

    const popupWebContents = window.electron.remote.webContents.getAllWebContents().find((webContents) => webContents.getTitle() === titleToken);

    if (!popupWebContents) {
      throw new Error('Could not find the window the PDF is printed from.');
    }

    popupDocument.title = params.title;
    const pdf = await popupWebContents.printToPDF({
      pageSize: params.pageSize,
      printBackground: true
    });
    return new Uint8Array(pdf);
  } finally {
    popup.close();
  }
}
