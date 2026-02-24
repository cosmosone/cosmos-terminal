import { escapeHtml } from '../highlight/tokenizer';
import { createElement } from '../utils/dom';
import { debounce } from '../utils/debounce';

export type RenderMode = 'markdown' | 'highlighted-editor' | 'plain-editor';

export interface FindController {
  open(): void;
  close(): void;
  attach(contentEl: HTMLElement): void;
  detach(): void;
  refreshHighlights(): void;
}

interface MatchRange {
  start: number;
  length: number;
}

const SVG_CHEVRON_UP =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
const SVG_CHEVRON_DOWN =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const SVG_CLOSE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function matchClassName(index: number, activeIdx: number): string {
  return index === activeIdx ? 'find-match find-match-current' : 'find-match';
}

export function createFindController(
  getTextContent: () => string,
  getMode: () => RenderMode,
): FindController {
  const overlay = createElement('div', { className: 'find-overlay' });
  const input = createElement('input', {
    className: 'find-overlay-input',
    type: 'text',
    placeholder: 'Find...',
  }) as HTMLInputElement;
  const countSpan = createElement('span', { className: 'find-overlay-count' });
  const prevBtn = createElement('button', { className: 'find-overlay-btn', title: 'Previous (Shift+Enter)' });
  prevBtn.innerHTML = SVG_CHEVRON_UP;
  const nextBtn = createElement('button', { className: 'find-overlay-btn', title: 'Next (Enter)' });
  nextBtn.innerHTML = SVG_CHEVRON_DOWN;
  const closeBtn = createElement('button', { className: 'find-overlay-btn', title: 'Close (Escape)' });
  closeBtn.innerHTML = SVG_CLOSE;

  overlay.append(input, countSpan, prevBtn, nextBtn, closeBtn);

  let contentEl: HTMLElement | null = null;
  let opened = false;
  let matches: MatchRange[] = [];
  let currentIndex = -1;

  let plainBackdrop: HTMLPreElement | null = null;
  let plainScrollHandler: (() => void) | null = null;

  // --- Match finding ---

  function findMatches(text: string, query: string): MatchRange[] {
    if (!query) return [];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const results: MatchRange[] = [];
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(q, pos);
      if (idx === -1) break;
      results.push({ start: idx, length: q.length });
      pos = idx + 1;
    }
    return results;
  }

  function updateCount(): void {
    if (matches.length === 0) {
      countSpan.textContent = input.value ? 'No results' : '';
    } else {
      countSpan.textContent = `${currentIndex + 1} of ${matches.length}`;
    }
  }

  // --- DOM-based highlighting (markdown, highlighted-editor) ---

  function getHighlightTarget(): HTMLElement | null {
    if (!contentEl) return null;
    const mode = getMode();
    if (mode === 'markdown') {
      return contentEl.querySelector('.file-tab-markdown');
    }
    if (mode === 'highlighted-editor') {
      return contentEl.querySelector('.highlighted-editor-backdrop code') as HTMLElement | null;
    }
    return null;
  }

  function clearDomHighlights(root: HTMLElement): void {
    const marks = root.querySelectorAll('mark.find-match');
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
      parent.normalize();
    }
  }

  function applyDomHighlights(root: HTMLElement, ranges: MatchRange[], activeIdx: number): void {
    clearDomHighlights(root);
    if (ranges.length === 0) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: { node: Text; start: number; end: number }[] = [];
    let offset = 0;
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const len = node.textContent?.length ?? 0;
      textNodes.push({ node, start: offset, end: offset + len });
      offset += len;
    }

    // Apply marks in reverse order to preserve positions
    for (let i = ranges.length - 1; i >= 0; i--) {
      const range = ranges[i];
      const rangeEnd = range.start + range.length;
      const cls = matchClassName(i, activeIdx);

      for (let j = textNodes.length - 1; j >= 0; j--) {
        const tn = textNodes[j];
        if (tn.end <= range.start || tn.start >= rangeEnd) continue;

        const nodeText = tn.node.textContent ?? '';
        const highlightStart = Math.max(0, range.start - tn.start);
        const highlightEnd = Math.min(nodeText.length, rangeEnd - tn.start);
        if (highlightStart >= highlightEnd) continue;

        const before = nodeText.slice(0, highlightStart);
        const matched = nodeText.slice(highlightStart, highlightEnd);
        const after = nodeText.slice(highlightEnd);

        const mark = document.createElement('mark');
        mark.className = cls;
        mark.textContent = matched;

        const parent = tn.node.parentNode;
        if (!parent) continue;

        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(mark);
        if (after) frag.appendChild(document.createTextNode(after));
        parent.replaceChild(frag, tn.node);
      }
    }
  }

  // --- Plain-editor backdrop highlighting ---

  function getPlainTextarea(): HTMLTextAreaElement | null {
    return contentEl?.querySelector('.file-tab-editor') as HTMLTextAreaElement | null;
  }

  function ensurePlainBackdrop(textarea: HTMLTextAreaElement): HTMLPreElement {
    if (plainBackdrop && plainBackdrop.parentNode) return plainBackdrop;

    const parent = textarea.parentElement!;
    if (!parent.style.position || parent.style.position === 'static') {
      parent.style.position = 'relative';
    }

    plainBackdrop = document.createElement('pre');
    plainBackdrop.className = 'find-plain-backdrop';

    const cs = getComputedStyle(textarea);
    Object.assign(plainBackdrop.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      padding: cs.padding,
      margin: '0',
      border: 'none',
      overflow: 'auto',
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontFamily: cs.fontFamily,
      tabSize: cs.tabSize,
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word',
      boxSizing: 'border-box',
      pointerEvents: 'none',
      color: 'transparent',
      background: 'transparent',
    });

    parent.insertBefore(plainBackdrop, textarea);
    textarea.style.background = 'transparent';

    plainScrollHandler = () => {
      if (plainBackdrop) {
        plainBackdrop.scrollTop = textarea.scrollTop;
        plainBackdrop.scrollLeft = textarea.scrollLeft;
      }
    };
    textarea.addEventListener('scroll', plainScrollHandler);

    return plainBackdrop;
  }

  function removePlainBackdrop(): void {
    const textarea = getPlainTextarea();
    if (plainBackdrop?.parentNode) {
      plainBackdrop.remove();
    }
    if (textarea && plainScrollHandler) {
      textarea.removeEventListener('scroll', plainScrollHandler);
      textarea.style.background = '';
    }
    plainBackdrop = null;
    plainScrollHandler = null;
  }

  function applyPlainHighlights(text: string, ranges: MatchRange[], activeIdx: number): void {
    const textarea = getPlainTextarea();
    if (!textarea) return;

    const backdrop = ensurePlainBackdrop(textarea);

    let html = '';
    let pos = 0;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      html += escapeHtml(text.slice(pos, r.start));
      html += `<mark class="${matchClassName(i, activeIdx)}">${escapeHtml(text.slice(r.start, r.start + r.length))}</mark>`;
      pos = r.start + r.length;
    }
    html += escapeHtml(text.slice(pos));
    backdrop.innerHTML = html;

    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  }

  // --- Shared highlight cleanup ---

  function clearAllHighlights(): void {
    const mode = getMode();
    if (mode === 'plain-editor') {
      removePlainBackdrop();
    } else {
      const target = getHighlightTarget();
      if (target) clearDomHighlights(target);
    }
  }

  // --- Core search logic ---

  /** Read text from the rendered DOM (which may differ from raw source) for accurate highlight offsets. */
  function getSearchableText(): string {
    const target = getHighlightTarget();
    if (target) return target.textContent ?? '';
    return getTextContent();
  }

  function applyHighlights(): void {
    const mode = getMode();
    if (mode === 'plain-editor') {
      if (matches.length > 0) {
        applyPlainHighlights(getTextContent(), matches, currentIndex);
      } else if (plainBackdrop) {
        plainBackdrop.innerHTML = '';
      }
      return;
    }

    const target = getHighlightTarget();
    if (target) {
      applyDomHighlights(target, matches, currentIndex);
    }
  }

  function scrollToCurrentMatch(): void {
    if (currentIndex < 0) return;
    const mode = getMode();

    if (mode === 'plain-editor') {
      const mark = plainBackdrop?.querySelector('mark.find-match-current');
      if (!mark) return;
      mark.scrollIntoView({ block: 'center' });
      const textarea = getPlainTextarea();
      if (plainBackdrop && textarea) {
        textarea.scrollTop = plainBackdrop.scrollTop;
        textarea.scrollLeft = plainBackdrop.scrollLeft;
      }
      return;
    }

    if (mode === 'highlighted-editor') {
      const target = getHighlightTarget();
      const mark = target?.querySelector('mark.find-match-current');
      if (!mark) return;
      mark.scrollIntoView({ block: 'center' });
      const backdrop = contentEl?.querySelector('.highlighted-editor-backdrop') as HTMLElement | null;
      const textarea = contentEl?.querySelector('.highlighted-editor-textarea') as HTMLTextAreaElement | null;
      if (backdrop && textarea) {
        textarea.scrollTop = backdrop.scrollTop;
        textarea.scrollLeft = backdrop.scrollLeft;
      }
      return;
    }

    // Markdown - direct scrollIntoView
    const target = getHighlightTarget();
    const mark = target?.querySelector('mark.find-match-current');
    mark?.scrollIntoView({ block: 'center' });
  }

  function runSearch(): void {
    matches = findMatches(getSearchableText(), input.value);
    currentIndex = matches.length > 0 ? 0 : -1;
    applyHighlights();
    updateCount();
    scrollToCurrentMatch();
  }

  function navigateMatch(direction: 1 | -1): void {
    if (matches.length === 0) return;
    currentIndex = (currentIndex + direction + matches.length) % matches.length;
    applyHighlights();
    updateCount();
    scrollToCurrentMatch();
  }

  // --- Event handlers ---

  const debouncedSearch = debounce(runSearch, 100);

  input.addEventListener('input', debouncedSearch);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      controller.close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateMatch(e.shiftKey ? -1 : 1);
    }
  });

  overlay.addEventListener('keydown', (e) => e.stopPropagation());

  prevBtn.addEventListener('click', () => navigateMatch(-1));
  nextBtn.addEventListener('click', () => navigateMatch(1));
  closeBtn.addEventListener('click', () => controller.close());

  // --- Controller ---

  function appendOverlayToParent(parent: HTMLElement | null): void {
    if (parent && overlay.parentNode !== parent) {
      overlay.remove();
      parent.appendChild(overlay);
    }
  }

  const controller: FindController = {
    open() {
      if (opened) {
        input.focus();
        input.select();
        return;
      }
      opened = true;
      appendOverlayToParent(contentEl?.parentElement ?? null);
      input.focus();
      if (input.value) {
        input.select();
        runSearch();
      }
    },

    close() {
      if (!opened) return;
      opened = false;
      clearAllHighlights();
      matches = [];
      currentIndex = -1;
      countSpan.textContent = '';
      overlay.remove();
    },

    attach(el: HTMLElement) {
      contentEl = el;
      if (opened) {
        appendOverlayToParent(el.parentElement);
        if (input.value) runSearch();
      }
    },

    detach() {
      if (!contentEl) return;
      clearAllHighlights();
      overlay.remove();
      contentEl = null;
    },

    refreshHighlights() {
      if (!opened || !input.value) return;
      matches = findMatches(getSearchableText(), input.value);
      if (currentIndex >= matches.length) {
        currentIndex = matches.length > 0 ? 0 : -1;
      }
      applyHighlights();
      updateCount();
    },
  };

  return controller;
}
