import type { App } from 'obsidian';

import {
  Component,
  htmlToMarkdown,
  MarkdownRenderer
} from 'obsidian';

/**
 * How long the render host must go without a DOM change before a plugin's output counts as finished.
 * Obsidian has no render-complete signal, and plugins such as `Dataview` render asynchronously after
 * `MarkdownRenderer.render` resolves, so a quiet period is the only thing that works for every plugin.
 */
export const DEFAULT_SETTLE_IN_MILLISECONDS = 500;

/**
 * The most a single block may take. A plugin that keeps mutating its output - a live clock, a spinner -
 * would otherwise never settle, so whatever is there when this expires is taken.
 */
export const DEFAULT_TIMEOUT_IN_MILLISECONDS = 10_000;

/**
 * Elements that are controls rather than content. A rendered Tasks query carries edit and postpone
 * buttons, and neither has a markdown meaning.
 */
const NON_CONTENT_SELECTOR = 'button, svg, input:not([type="checkbox"])';

/**
 * The parameters for {@link renderPluginCodeBlocks}.
 */
export interface RenderPluginCodeBlocksParams {
  /**
   * An Obsidian app instance.
   */
  readonly app: App;

  /**
   * The note's markdown.
   */
  readonly content: string;

  /**
   * The code block languages whose blocks are replaced by their rendered output. Matched
   * case-insensitively.
   */
  readonly languages: readonly string[];

  /**
   * How long the render host must stay unchanged before a block counts as rendered.
   */
  readonly settleInMilliseconds?: number;

  /**
   * The note's vault path, so a query such as `Dataview`'s `this` resolves against the right note.
   */
  readonly sourcePath: string;

  /**
   * The most a single block may take to render.
   */
  readonly timeoutInMilliseconds?: number;
}

interface FencedCodeBlock {
  readonly end: number;
  readonly language: string;
  readonly source: string;
  readonly start: number;
}

interface OpenFence {
  readonly fence: string;
  readonly language: string;
  readonly start: number;
}

interface RenderBlockParams {
  readonly app: App;
  readonly block: FencedCodeBlock;
  readonly settleInMilliseconds: number;
  readonly sourcePath: string;
  readonly timeoutInMilliseconds: number;
}

/**
 * Finds the top-level fenced code blocks of a note.
 *
 * Only fences that start at the margin (up to three spaces of indentation) are found, which is where a
 * `Dataview` or `Tasks` query sits. A fence nested in a list, a quote or a callout is left as it is, and so is
 * a fence that is never closed.
 *
 * @param content - The note's markdown.
 * @returns The blocks, in document order, with their offsets in `content`.
 */
export function findFencedCodeBlocks(content: string): FencedCodeBlock[] {
  const blocks: FencedCodeBlock[] = [];
  const lines = content.split('\n');
  let offset = 0;
  let openFence: null | OpenFence = null;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmedLine = line.replace(/\r$/, '');

    if (openFence) {
      const closingMatch = /^ {0,3}(?<fence>`{3,}|~{3,})\s*$/.exec(trimmedLine);
      const closingFence = closingMatch?.groups?.['fence'];
      // A closing fence uses the same character as the opening one and is at least as long.
      if (closingFence?.startsWith(openFence.fence)) {
        const end = Math.min(offset, content.length);
        blocks.push({
          end,
          language: openFence.language,
          source: content.slice(openFence.start, end),
          start: openFence.start
        });
        openFence = null;
      }
      continue;
    }

    const openingMatch = /^ {0,3}(?<fence>`{3,}|~{3,})(?<info>.*)$/.exec(trimmedLine);
    const fence = openingMatch?.groups?.['fence'];
    const info = openingMatch?.groups?.['info'] ?? '';
    if (fence === undefined || (fence.startsWith('`') && info.includes('`'))) {
      continue;
    }

    openFence = {
      fence,
      language: info.trim().replace(/\s.*$/s, ''),
      start: lineStart
    };
  }

  return blocks;
}

/**
 * Replaces each fenced code block of the given languages with what its plugin renders, converted to
 * markdown, so a recipient without `Dataview` or `Tasks` reads the result instead of the query.
 *
 * A block keeps its source when the render produced nothing, or produced only the fence itself - which is
 * what happens when no plugin is registered for the language.
 *
 * @param params - The parameters.
 * @returns The note's markdown with the blocks replaced.
 */
export async function renderPluginCodeBlocks(params: RenderPluginCodeBlocksParams): Promise<string> {
  const languages = new Set(params.languages.map((language) => language.toLowerCase()));
  const blocks = findFencedCodeBlocks(params.content).filter((block) => languages.has(block.language.toLowerCase()));

  if (blocks.length === 0) {
    return params.content;
  }

  let result = '';
  let lastEnd = 0;

  for (const block of blocks) {
    const rendered = await renderBlock({
      app: params.app,
      block,
      settleInMilliseconds: params.settleInMilliseconds ?? DEFAULT_SETTLE_IN_MILLISECONDS,
      sourcePath: params.sourcePath,
      timeoutInMilliseconds: params.timeoutInMilliseconds ?? DEFAULT_TIMEOUT_IN_MILLISECONDS
    });
    result += params.content.slice(lastEnd, block.start);
    result += rendered === null ? block.source : `${rendered}\n`;
    lastEnd = block.end;
  }

  result += params.content.slice(lastEnd);
  return result;
}

/**
 * Waits until an element has gone `settleInMilliseconds` without a DOM change, or `timeoutInMilliseconds` in all.
 *
 * @param el - The element to watch, with its subtree.
 * @param settleInMilliseconds - How long it must stay unchanged.
 * @param timeoutInMilliseconds - The most to wait in all.
 * @returns A {@link Promise} that resolves once it settled or timed out.
 */
export async function waitForDomToSettle(el: HTMLElement, settleInMilliseconds: number, timeoutInMilliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const win = el.win;
    let settleTimer = win.setTimeout(finish, settleInMilliseconds);
    const timeoutTimer = win.setTimeout(finish, timeoutInMilliseconds);
    const observer = new MutationObserver(() => {
      win.clearTimeout(settleTimer);
      settleTimer = win.setTimeout(finish, settleInMilliseconds);
    });
    observer.observe(el, { attributes: true, characterData: true, childList: true, subtree: true });

    function finish(): void {
      observer.disconnect();
      win.clearTimeout(settleTimer);
      win.clearTimeout(timeoutTimer);
      resolve();
    }
  });
}

/**
 * Whether the render left nothing but the code block itself, i.e. no plugin claimed the language.
 */
function isUnprocessedFence(hostEl: HTMLElement): boolean {
  const pres = hostEl.querySelectorAll('pre');
  return pres.length > 0 && hostEl.textContent.trim() === Array.from(pres, (pre) => pre.textContent).join('').trim();
}

async function renderBlock(params: RenderBlockParams): Promise<null | string> {
  /*
   * The host is attached to the document, off-screen, rather than left detached: some plugins measure
   * their container or wait for it to be shown before they render.
   */
  const hostEl = activeDocument.body.createDiv({ cls: 'advanced-markdown-export-render-host' });
  const component = new Component();
  component.load();

  try {
    const settled = waitForDomToSettle(hostEl, params.settleInMilliseconds, params.timeoutInMilliseconds);
    await MarkdownRenderer.render(params.app, params.block.source, hostEl, params.sourcePath, component);
    await settled;

    if (isUnprocessedFence(hostEl)) {
      return null;
    }

    for (const el of hostEl.querySelectorAll(NON_CONTENT_SELECTOR)) {
      el.remove();
    }

    const markdown = htmlToMarkdown(hostEl).trim();
    return markdown === '' ? null : markdown;
  } finally {
    component.unload();
    hostEl.remove();
  }
}
