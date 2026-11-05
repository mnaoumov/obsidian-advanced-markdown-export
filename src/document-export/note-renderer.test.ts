import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import {
  App,
  MarkdownRenderer
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { RenderedNotes } from './note-renderer.ts';

import {
  DanglingLinkAction,
  PluginSettings
} from '../plugin-settings.ts';
import { renderNotes } from './note-renderer.ts';

const SHORT_SETTLE_IN_MILLISECONDS = 10;
const SHORT_TIMEOUT_IN_MILLISECONDS = 100;

describe('renderNotes', () => {
  type RenderImplementation = (markdown: string, el: HTMLElement, sourcePath: string) => void;
  let app: AppOriginal;
  let mockApp: App;
  let rendered: null | RenderedNotes;
  let settings: PluginSettings;

  beforeEach(() => {
    mockApp = App.createConfigured__();
    app = mockApp.asOriginalType__();
    rendered = null;
    settings = new PluginSettings();
  });

  afterEach(() => {
    rendered?.dispose();
    vi.restoreAllMocks();
  });

  function mockRender(implementation: RenderImplementation): void {
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation((_app, markdown, el, sourcePath) => {
      implementation(markdown, el, sourcePath);
      return noopAsync();
    });
  }

  function getFile(path: string): TFile {
    const file = app.vault.getFileByPath(path);

    if (!file) {
      throw new Error(`No such file: ${path}`);
    }

    return file;
  }

  async function render(paths: string[]): Promise<RenderedNotes> {
    rendered = await renderNotes({
      app,
      files: paths.map((path) => getFile(path)),
      noteHrefResolver: (anchorId) => `#${anchorId}`,
      settings,
      settleInMilliseconds: SHORT_SETTLE_IN_MILLISECONDS,
      timeoutInMilliseconds: SHORT_TIMEOUT_IN_MILLISECONDS
    });
    return rendered;
  }

  function getBody(result: RenderedNotes): HTMLElement {
    const bodyEl = result.notes[0]?.element.querySelector<HTMLElement>('.advanced-markdown-export-document-body');

    if (!bodyEl) {
      throw new Error('No rendered body');
    }

    return bodyEl;
  }

  it('should render each note, not attachments, titled and anchored, in export order', async () => {
    mockApp.vault.createSync__('A.md', '# Heading A');
    mockApp.vault.createSync__('B.md', 'Body B');
    mockApp.vault.createSync__('A1.png', 'a1');
    const renderSpy = vi.fn<RenderImplementation>((markdown, el) => {
      el.createEl('p', { text: markdown });
    });
    mockRender(renderSpy);

    const result = await render(['B.md', 'A1.png', 'A.md']);

    expect(result.notes.map((note) => [note.anchorId, note.title, note.file.path])).toEqual([
      ['note-1', 'B', 'B.md'],
      ['note-2', 'A', 'A.md']
    ]);
    expect(result.notes[0]?.element.id).toBe('note-1');
    expect(result.notes[0]?.element.querySelector('h1')?.textContent).toBe('B');
    expect(getBody(result).textContent).toBe('Body B');
    expect(renderSpy).toHaveBeenCalledWith('Body B', expect.any(HTMLElement), 'B.md');
  });

  it('should settle on the default timings when none are given', async () => {
    mockApp.vault.createSync__('A.md', 'x');
    mockRender((markdown, el) => {
      el.createEl('p', { text: markdown });
    });
    rendered = await renderNotes({
      app,
      files: [getFile('A.md')],
      noteHrefResolver: (anchorId) => anchorId,
      settings
    });

    expect(getBody(rendered).textContent).toBe('x');
  });

  it('should leave the frontmatter out', async () => {
    mockApp.vault.createSync__('A.md', '---\ntags: x\n---\nBody');
    const renderSpy = vi.fn<RenderImplementation>();
    mockRender(renderSpy);

    await render(['A.md']);

    expect(renderSpy).toHaveBeenCalledWith('Body', expect.any(HTMLElement), 'A.md');
  });

  it('should wait for content a plugin adds after render resolves', async () => {
    mockApp.vault.createSync__('A.md', 'x');
    mockRender((_markdown, el) => {
      window.setTimeout(() => el.createEl('p', { text: 'Late' }), 1);
    });

    expect(getBody(await render(['A.md'])).textContent).toBe('Late');
  });

  it('should drop controls but keep task checkboxes', async () => {
    mockApp.vault.createSync__('A.md', 'x');
    mockRender((_markdown, el) => {
      el.createEl('button', { text: 'Copy' });
      el.createEl('input', { type: 'checkbox' });
      el.createEl('input', { type: 'text' });
      el.createDiv({ cls: 'collapse-indicator' });
    });

    const bodyEl = getBody(await render(['A.md']));

    expect(bodyEl.querySelectorAll('button, .collapse-indicator, input[type="text"]')).toHaveLength(0);
    expect(bodyEl.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });

  it('should dispose of the host, and clean up when a render throws', async () => {
    mockApp.vault.createSync__('A.md', 'x');
    mockRender(() => undefined);
    const result = await render(['A.md']);

    expect(activeDocument.querySelectorAll('.advanced-markdown-export-render-host')).toHaveLength(1);
    result.dispose();
    rendered = null;
    expect(activeDocument.querySelectorAll('.advanced-markdown-export-render-host')).toHaveLength(0);

    mockRender(() => {
      throw new Error('boom');
    });
    await expect(render(['A.md'])).rejects.toThrow('boom');
    rendered = null;
    expect(activeDocument.querySelectorAll('.advanced-markdown-export-render-host')).toHaveLength(0);
  });

  describe('links', () => {
    beforeEach(() => {
      mockApp.vault.createSync__('A.md', 'x');
      mockApp.vault.createSync__('B.md', 'y');
      mockApp.vault.createSync__('Outside.md', 'z');
    });

    function renderLink(dataHref: null | string, extraClass = ''): void {
      mockRender((_markdown, el, sourcePath) => {
        if (sourcePath !== 'A.md') {
          return;
        }

        const linkEl = el.createEl('a', { cls: `internal-link ${extraClass}`.trim(), text: 'The link' });
        linkEl.setAttribute('target', '_blank');

        if (dataHref !== null) {
          linkEl.dataset['href'] = dataHref;
        }
      });
    }

    it('should point a link to an exported note at that note in the document', async () => {
      renderLink('B#Heading');

      const linkEl = getBody(await render(['A.md', 'B.md'])).querySelector('a');

      expect(linkEl?.getAttribute('href')).toBe('#note-2');
      expect(linkEl?.hasAttribute('target')).toBe(false);
    });

    it('should turn a link to nothing into its text, whatever the setting', async () => {
      renderLink('Missing', 'is-unresolved');

      expect(getBody(await render(['A.md'])).innerHTML).toBe('The link');
    });

    it('should turn a link with no target attribute into its text', async () => {
      renderLink(null);

      expect(getBody(await render(['A.md'])).innerHTML).toBe('The link');
    });

    it('should keep a dangling link as an obsidian:// URL', async () => {
      renderLink('Outside');

      const href = getBody(await render(['A.md'])).querySelector('a')?.getAttribute('href');

      expect(href).toBe(`obsidian://open?vault=${encodeURIComponent(app.vault.getName())}&file=Outside.md`);
    });

    it('should replace a dangling link with its text, or remove it, as the setting says', async () => {
      renderLink('Outside');
      settings.danglingLinkAction = DanglingLinkAction.ReplaceWithDisplayText;
      expect(getBody(await render(['A.md'])).innerHTML).toBe('The link');

      rendered?.dispose();
      settings.danglingLinkAction = DanglingLinkAction.Remove;
      expect(getBody(await render(['A.md'])).innerHTML).toBe('');
    });

    it('should treat a link to an exported attachment as dangling, since a document cannot open it', async () => {
      mockApp.vault.createSync__('Doc.pdf', 'pdf');
      renderLink('Doc.pdf');
      settings.danglingLinkAction = DanglingLinkAction.Remove;

      expect(getBody(await render(['A.md', 'Doc.pdf'])).innerHTML).toBe('');
    });
  });

  describe('embeds', () => {
    beforeEach(() => {
      mockApp.vault.createSync__('A.md', 'x');
      mockApp.vault.createSync__('In.png', 'in');
      mockApp.vault.createSync__('Out.png', 'out');
      mockRender((_markdown, el) => {
        for (const [src, alt] of [['In.png', 'kept'], ['Out.png', 'out alt'], ['Missing.png', 'missing']] as const) {
          const embedEl = el.createSpan({ attr: { alt, src }, cls: 'internal-embed' });
          embedEl.createEl('img');
        }

        // An embed of a dangling note holding an embed of its own, and one without a src at all.
        el.createDiv({ attr: { alt: 'nested', src: 'Out.png' }, cls: 'internal-embed' })
          .createSpan({ attr: { src: 'Out.png' }, cls: 'internal-embed' });
        el.createSpan({ cls: 'internal-embed', text: 'no src' });
      });
    });

    it('should leave every embed rendered when dangling links are kept', async () => {
      const bodyEl = getBody(await render(['A.md', 'In.png']));

      expect(bodyEl.querySelectorAll('.internal-embed')).toHaveLength(6);
    });

    it('should replace a dangling embed with its alt text', async () => {
      settings.danglingLinkAction = DanglingLinkAction.ReplaceWithDisplayText;

      const bodyEl = getBody(await render(['A.md', 'In.png']));

      expect(bodyEl.textContent).toBe(['out alt', 'nested', 'no src'].join(''));
      expect([...bodyEl.querySelectorAll('.internal-embed')].map((embedEl) => embedEl.getAttribute('src'))).toEqual([
        'In.png',
        'Missing.png',
        null
      ]);
    });

    it('should replace a dangling embed with nothing when it has no alt text', async () => {
      settings.danglingLinkAction = DanglingLinkAction.ReplaceWithDisplayText;
      vi.restoreAllMocks();
      mockRender((_markdown, el) => {
        el.createSpan({ attr: { src: 'Out.png' }, cls: 'internal-embed' });
      });

      expect(getBody(await render(['A.md'])).innerHTML).toBe('');
    });

    it('should remove a dangling embed', async () => {
      settings.danglingLinkAction = DanglingLinkAction.Remove;

      const bodyEl = getBody(await render(['A.md', 'In.png']));

      expect([...bodyEl.querySelectorAll('.internal-embed')].map((embedEl) => embedEl.getAttribute('src'))).toEqual([
        'In.png',
        'Missing.png',
        null
      ]);
    });
  });
});
