import type { App as AppOriginal } from 'obsidian';
import type { MockInstance } from 'vitest';

import {
  App,
  Component,
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

import {
  findFencedCodeBlocks,
  renderPluginCodeBlocks
} from './code-block-renderer.ts';

type RenderImplementation = (markdown: string, el: HTMLElement) => Promise<void> | void;

const SHORT_SETTLE_IN_MILLISECONDS = 20;
const SHORT_TIMEOUT_IN_MILLISECONDS = 200;

describe('findFencedCodeBlocks', () => {
  it('should find backtick and tilde fences with their language and offsets', () => {
    const content = 'intro\n```dataview\nLIST\n```\nmiddle\n~~~tasks\nnot done\n~~~\nend';
    const blocks = findFencedCodeBlocks(content);

    expect(blocks.map((block) => block.language)).toEqual(['dataview', 'tasks']);
    expect(blocks[0]?.source).toBe('```dataview\nLIST\n```\n');
    expect(content.slice(blocks[0]?.start, blocks[0]?.end)).toBe(blocks[0]?.source);
    expect(blocks[1]?.source).toBe('~~~tasks\nnot done\n~~~\n');
  });

  it('should close a fence only with the same character and at least the same length', () => {
    const content = '````dataview\n```\n~~~~\n````\n';
    const blocks = findFencedCodeBlocks(content);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe(content);
  });

  it('should end a block that closes on the last line without a trailing newline at the end of the content', () => {
    const content = '```dataview\nLIST\n```';
    expect(findFencedCodeBlocks(content)[0]?.end).toBe(content.length);
  });

  it('should ignore an unclosed fence, an indented fence and a backtick fence whose info has a backtick', () => {
    expect(findFencedCodeBlocks('```dataview\nLIST\n')).toEqual([]);
    expect(findFencedCodeBlocks('    ```dataview\n    LIST\n    ```\n')).toEqual([]);
    expect(findFencedCodeBlocks('```data`view\nLIST\n```\n')).toEqual([]);
  });

  it('should read the language as the first word of the info string, and allow none', () => {
    expect(findFencedCodeBlocks('```  dataview extra\nLIST\n```\n')[0]?.language).toBe('dataview');
    expect(findFencedCodeBlocks('```\ncode\n```\n')[0]?.language).toBe('');
  });

  it('should accept CRLF line endings', () => {
    const blocks = findFencedCodeBlocks('```dataview\r\nLIST\r\n```\r\nafter');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe('```dataview\r\nLIST\r\n```\r\n');
  });
});

describe('renderPluginCodeBlocks', () => {
  let app: AppOriginal;

  beforeEach(() => {
    app = App.createConfigured__().asOriginalType__();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockRender(implementation: RenderImplementation): MockInstance<typeof MarkdownRenderer.render> {
    return vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
      await implementation(markdown, el);
    });
  }

  async function render(content: string, languages: readonly string[] = ['dataview']): Promise<string> {
    return await renderPluginCodeBlocks({
      app,
      content,
      languages,
      settleInMilliseconds: SHORT_SETTLE_IN_MILLISECONDS,
      sourcePath: 'Note.md',
      timeoutInMilliseconds: SHORT_TIMEOUT_IN_MILLISECONDS
    });
  }

  it('should return the content untouched and render nothing when no block matches', async () => {
    const renderSpy = mockRender(() => undefined);
    const content = 'text\n```js\ncode\n```\n';

    expect(await render(content)).toBe(content);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('should replace a matching block with its rendered output as markdown', async () => {
    const renderSpy = mockRender((_markdown, el) => {
      el.createEl('p', { text: 'Rendered result' });
    });

    expect(await render('before\n```dataview\nLIST\n```\nafter')).toBe('before\nRendered result\nafter');
    expect(renderSpy).toHaveBeenCalledWith(app, '```dataview\nLIST\n```\n', expect.any(HTMLElement), 'Note.md', expect.any(Component));
  });

  it('should match the language case-insensitively', async () => {
    mockRender((_markdown, el) => {
      el.createEl('p', { text: 'Done' });
    });

    expect(await render('```DataView\nLIST\n```\n', ['dataVIEW'])).toBe('Done\n');
  });

  it('should keep the source of a block that no plugin processed', async () => {
    mockRender((markdown, el) => {
      el.createEl('pre').createEl('code', { text: markdown });
    });
    const content = '```dataview\nLIST\n```\n';

    expect(await render(content)).toBe(content);
  });

  it('should keep the source of a block whose render produced nothing', async () => {
    mockRender(() => undefined);
    const content = '```dataview\nLIST\n```\n';

    expect(await render(content)).toBe(content);
  });

  it('should drop controls that have no markdown meaning', async () => {
    mockRender((_markdown, el) => {
      const paragraph = el.createEl('p', { text: 'Task' });
      paragraph.createEl('button', { text: 'Edit' });
      paragraph.createSvg('svg');
      paragraph.createEl('input', { type: 'text' });
    });

    expect(await render('```dataview\nLIST\n```\n')).toBe('Task\n');
  });

  it('should wait for output a plugin adds after the render call resolves', async () => {
    mockRender((_markdown, el) => {
      window.setTimeout(() => {
        el.createEl('p', { text: 'Late' });
      }, SHORT_SETTLE_IN_MILLISECONDS / 2);
    });

    expect(await render('```dataview\nLIST\n```\n')).toBe('Late\n');
  });

  it('should take what is there once the timeout expires for output that never settles', async () => {
    let intervalId = 0;
    mockRender((_markdown, el) => {
      el.createEl('p', { text: 'Ticking' });
      intervalId = window.setInterval(() => {
        el.toggleClass('tick', !el.hasClass('tick'));
      }, SHORT_SETTLE_IN_MILLISECONDS / 4);
    });

    try {
      expect(await render('```dataview\nLIST\n```\n')).toBe('Ticking\n');
    } finally {
      window.clearInterval(intervalId);
    }
  });

  it('should use the default settle and timeout when none is given', async () => {
    mockRender((_markdown, el) => {
      el.createEl('p', { text: 'Default' });
    });

    expect(
      await renderPluginCodeBlocks({
        app,
        content: '```dataview\nLIST\n```\n',
        languages: ['dataview'],
        sourcePath: 'Note.md'
      })
    ).toBe('Default\n');
  });

  it('should remove the render host and unload the component, even when the render throws', async () => {
    const unloadSpy = vi.spyOn(Component.prototype, 'unload');
    mockRender(() => {
      throw new Error('render failed');
    });

    await expect(render('```dataview\nLIST\n```\n')).rejects.toThrow('render failed');
    expect(document.querySelector('.advanced-markdown-export-render-host')).toBeNull();
    expect(unloadSpy).toHaveBeenCalled();
  });

  it('should render every matching block and keep the text between them', async () => {
    let count = 0;
    mockRender((_markdown, el) => {
      count++;
      el.createEl('p', { text: `result ${String(count)}` });
    });

    expect(await render('a\n```dataview\n1\n```\nb\n```dataview\n2\n```\nc')).toBe('a\nresult 1\nb\nresult 2\nc');
  });
});
