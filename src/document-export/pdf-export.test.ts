import type {
  ElectronModule,
  ElectronPrintToPDFOptions
} from '@obsidian-typings/obsidian-public-latest';
import type { TFile } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { RenderedNote } from './note-renderer.ts';

import { printNotesToPdf } from './pdf-export.ts';

interface FakePopup {
  readonly close: ReturnType<typeof vi.fn>;
  readonly document: Document;
  readonly setTimeout: (callback: () => void, delay: number) => number;
}

interface WindowWithElectron {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup installs the Electron mock and teardown removes it.
  electron: ElectronModule | undefined;
}

describe('printNotesToPdf', () => {
  let popup: FakePopup;
  let printToPdfMock: ReturnType<typeof vi.fn<(options: ElectronPrintToPDFOptions) => Promise<Uint8Array>>>;
  let printedPageSize: ElectronPrintToPDFOptions['pageSize'];
  let snapshot: string;

  beforeEach(() => {
    printToPdfMock = vi.fn((options: ElectronPrintToPDFOptions) => {
      printedPageSize = options.pageSize;
      snapshot = popup.document.documentElement.outerHTML;
      return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
    });
    popup = {
      close: vi.fn(),
      document: document.implementation.createHTMLDocument(''),

      setTimeout: (callback, delay): number => window.setTimeout(callback, delay)
    };
    vi.spyOn(window, 'open').mockReturnValue(castTo<Window>(popup));
    // The main window's view of every web contents: the app's own, and the popup's, titled by its document.
    castTo<WindowWithElectron>(window).electron = castTo<ElectronModule>({
      remote: {
        webContents: {
          getAllWebContents: (): unknown[] => [
            { getTitle: (): string => 'Obsidian', printToPDF: vi.fn() },
            { getTitle: (): string => popup.document.title, printToPDF: printToPdfMock }
          ]
        }
      }
    });
    // A stylesheet the app loaded, parsed rather than created.
    document.head.append(...new DOMParser().parseFromString('<style>.app { color: red; }</style>', 'text/html').head.childNodes);
    document.body.className = 'theme-dark mod-windows';
    document.body.setCssProps({ '--font-text-size': '16px' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    castTo<WindowWithElectron>(window).electron = undefined;
    document.head.empty();
    document.body.className = '';
    document.body.removeAttribute('style');
  });

  function createNote(anchorId: string, text: string): RenderedNote {
    const element = createDiv({ cls: 'advanced-markdown-export-document-note', text });
    element.id = anchorId;
    return { anchorId, element, file: castTo<TFile>({}), title: anchorId };
  }

  it('should print the notes in a hidden popup carrying the app styles in a light theme, then close it', async () => {
    const pdf = await printNotesToPdf({ notes: [createNote('note-1', 'One'), createNote('note-2', 'Two')], pageSize: 'A4', title: 'Book' });

    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', 'popup,hide=true');
    expect(pdf).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(printToPdfMock).toHaveBeenCalledWith({ pageSize: 'A4', printBackground: true });
    expect(printedPageSize).toBe('A4');
    expect(snapshot).toContain('<title>Book</title>');
    expect(snapshot).toContain('.app { color: red; }');
    expect(snapshot).toContain('class="mod-windows theme-light"');
    expect(snapshot).toContain('style="--font-text-size: 16px;"');
    expect(snapshot).toMatch(/<div class="print"><div [^>]*id="note-1"[^>]*>One<\/div><div [^>]*id="note-2"[^>]*>Two<\/div><\/div>/);
    expect(popup.close).toHaveBeenCalled();
  });

  it('should close the popup when printing fails', async () => {
    printToPdfMock.mockRejectedValue(new Error('print failed'));
    document.body.removeAttribute('style');

    await expect(printNotesToPdf({ notes: [], pageSize: 'Letter', title: 'Book' })).rejects.toThrow('print failed');
    expect(popup.close).toHaveBeenCalled();
  });

  it('should fail plainly, and close the popup, when its web contents cannot be found', async () => {
    castTo<WindowWithElectron>(window).electron = castTo<ElectronModule>({ remote: { webContents: { getAllWebContents: (): unknown[] => [] } } });

    await expect(printNotesToPdf({ notes: [], pageSize: 'Letter', title: 'Book' })).rejects.toThrow(
      'Could not find the window the PDF is printed from.'
    );
    expect(popup.close).toHaveBeenCalled();
  });

  it('should fail plainly when the popup cannot be opened', async () => {
    vi.mocked(window.open).mockReturnValue(null);

    await expect(printNotesToPdf({ notes: [], pageSize: 'Letter', title: 'Book' })).rejects.toThrow(
      'Could not open the window the PDF is printed from.'
    );
  });
});
