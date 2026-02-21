import { store } from '../state/store';
import { setFileTabEditing, setFileTabDirty } from '../state/actions';
import { readTextFile, writeTextFile, getFileMtime } from '../services/fs-service';
import { showContextMenu } from './context-menu';
import { showConfirmDialog } from './confirm-dialog';
import { getGrammar } from '../highlight/languages/index';
import { escapeHtml, tokenize, tokensToHtml } from '../highlight/tokenizer';
import { debounce } from '../utils/debounce';
import type { AppState, FileTab, Project } from '../state/types';
import { createElement, clearChildren, $ } from '../utils/dom';
import { createFindController, type RenderMode } from './find-in-document';

export interface FileTabContentApi {
  openSearch(): void;
}

interface ListItem {
  indent: number;
  ordered: boolean;
  content: string;
  spaceBefore?: boolean;
}

const LIST_LINE_RE = /^(\s*)([-*]|\d+\.)\s+(.+)$/;

/** Create a ListItem from a LIST_LINE_RE match. */
function parseListMatch(m: RegExpMatchArray, spaceBefore?: boolean): ListItem {
  const item: ListItem = {
    indent: m[1].length,
    ordered: /^\d+\.$/.test(m[2]),
    content: m[3],
  };
  if (spaceBefore) item.spaceBefore = true;
  return item;
}

/** Build nested HTML lists from parsed list items. */
function buildNestedList(items: ListItem[]): string {
  let html = '';
  const stack: { indent: number; tag: 'ol' | 'ul' }[] = [];

  for (const item of items) {
    const tag = item.ordered ? 'ol' : 'ul';

    // Close deeper nesting levels when returning to a shallower indent
    while (stack.length > 0 && stack[stack.length - 1].indent > item.indent) {
      const closed = stack.pop()!;
      html += `</li></${closed.tag}>`;
    }

    if (stack.length === 0 || stack[stack.length - 1].indent < item.indent) {
      html += `<${tag}>`;
      stack.push({ indent: item.indent, tag });
    } else {
      html += '</li>';
      // If list type changed at the same indent, close and reopen
      const cur = stack[stack.length - 1];
      if (cur.tag !== tag) {
        html += `</${cur.tag}><${tag}>`;
        cur.tag = tag;
      }
    }

    const cls = item.spaceBefore ? ' class="md-list-spaced"' : '';
    html += `<li${cls}>${item.content}`;
  }

  while (stack.length > 0) {
    const closed = stack.pop()!;
    html += `</li></${closed.tag}>`;
  }

  return html;
}

/** Skip blank lines starting at index `from`, returning the next non-blank index. */
function skipBlankLines(lines: string[], from: number): number {
  let j = from;
  while (j < lines.length && lines[j].trim() === '') j++;
  return j;
}

/** Convert markdown list lines (including nested) into HTML lists. */
function renderLists(html: string): string {
  const lines = html.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const firstMatch = lines[i].match(LIST_LINE_RE);
    if (!firstMatch) {
      result.push(lines[i]);
      i++;
      continue;
    }

    const items: ListItem[] = [parseListMatch(firstMatch)];
    i++;

    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(LIST_LINE_RE);
      if (m) {
        items.push(parseListMatch(m));
        i++;
      } else if (line.trim() === '') {
        // Blank line -- peek past consecutive blanks for more list items
        const j = skipBlankLines(lines, i + 1);
        const next = j < lines.length ? lines[j].match(LIST_LINE_RE) : null;
        if (next) {
          items.push(parseListMatch(next, true));
          i = j + 1;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    result.push(buildNestedList(items));
  }

  return result.join('\n');
}

type TableAlign = 'left' | 'center' | 'right' | null;

/** Check if a line looks like a markdown table row (starts and ends with |). */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.length > 1 && t[0] === '|' && t[t.length - 1] === '|';
}

/** Split a table row into its raw cell strings (outer pipes removed). */
function splitRowCells(line: string): string[] {
  return line.trim().slice(1, -1).split('|');
}

/** Check if a line is a table separator (| --- | --- |). */
function isTableSeparator(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = splitRowCells(line);
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

/** Extract trimmed cell contents from a table row. */
function parseTableCells(line: string): string[] {
  return splitRowCells(line).map((c) => c.trim());
}

/** Parse alignment hints from a separator row. */
function parseAlignments(line: string): TableAlign[] {
  return splitRowCells(line).map((c) => {
    const s = c.trim();
    const left = s.startsWith(':');
    const right = s.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return left ? 'left' : null;
  });
}

/** Build an inline style attribute for a table cell alignment (empty string if none). */
function alignAttr(align: TableAlign): string {
  return align ? ` style="text-align:${align}"` : '';
}

/** Convert markdown table blocks into HTML tables. */
function renderTables(html: string): string {
  const lines = html.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (i + 1 < lines.length && isTableRow(lines[i]) && isTableSeparator(lines[i + 1])) {
      const headers = parseTableCells(lines[i]);
      const aligns = parseAlignments(lines[i + 1]);
      i += 2;

      let table = '<table class="md-table"><thead><tr>';
      for (let c = 0; c < headers.length; c++) {
        table += `<th${alignAttr(aligns[c])}>${headers[c]}</th>`;
      }
      table += '</tr></thead><tbody>';

      while (i < lines.length && isTableRow(lines[i])) {
        const cells = parseTableCells(lines[i]);
        table += '<tr>';
        for (let c = 0; c < headers.length; c++) {
          table += `<td${alignAttr(aligns[c])}>${c < cells.length ? cells[c] : ''}</td>`;
        }
        table += '</tr>';
        i++;
      }

      table += '</tbody></table>';
      result.push(table);
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

// Precompiled regexes for cleaning up paragraph/br artifacts around block elements
const BLOCK_ELS = 'h[1-6]|pre|blockquote|hr|li|ol|ul|table';
const RE_P_OPEN_BEFORE_BLOCK = new RegExp(`<p>\\s*<(${BLOCK_ELS})`, 'g');
const RE_P_CLOSE_AFTER_BLOCK = new RegExp(`</(${BLOCK_ELS})>\\s*</p>`, 'g');
const RE_BR_BEFORE_BLOCK = new RegExp(`<br>\\s*<(${BLOCK_ELS})`, 'g');
const RE_BR_AFTER_BLOCK = new RegExp(`</(${BLOCK_ELS})>\\s*<br>`, 'g');

function renderMarkdown(source: string): string {
  const normalised = source.replace(/\r\n?/g, '\n');
  const escaped = escapeHtml(normalised);
  let html = escaped;

  // Extract code blocks and inline code into placeholders so that subsequent
  // transformations (headings, bold, italic, etc.) never touch code content.
  const placeholders: string[] = [];
  function addPlaceholder(content: string): string {
    const index = placeholders.length;
    placeholders.push(content);
    return `\x00PH${index}\x00`;
  }

  // Fenced code blocks (```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    addPlaceholder(`<pre class="md-code-block"><code>${code}</code></pre>`),
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) =>
    addPlaceholder(`<code class="md-inline-code">${code}</code>`),
  );

  // Headings (h1-h6)
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Lists (ordered and unordered, with nesting support)
  html = renderLists(html);

  // Tables (GFM-style: header | separator | rows)
  html = renderTables(html);

  // Links: [text](url) — only allow http(s) and mailto protocols
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
    const decoded = href.replace(/&amp;/g, '&');
    if (/^https?:|^mailto:/i.test(decoded)) {
      return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    }
    return `${text} (${href})`;
  });

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Paragraphs: double newlines become paragraph breaks
  html = html.replace(/\n\n/g, '</p><p>');

  // Single newlines become visible line breaks
  html = html.replace(/\n/g, '<br>\n');

  html = `<p>${html}</p>`;

  // Clean up empty paragraphs around block elements
  html = html.replace(RE_P_OPEN_BEFORE_BLOCK, '<$1');
  html = html.replace(RE_P_CLOSE_AFTER_BLOCK, '</$1>');
  html = html.replace(/<p>\s*<hr>\s*<\/p>/g, '<hr>');
  html = html.replace(/<p><\/p>/g, '');

  // Strip stray <br> adjacent to block elements
  html = html.replace(RE_BR_BEFORE_BLOCK, '<$1');
  html = html.replace(RE_BR_AFTER_BLOCK, '</$1>');
  html = html.replace(/<br>\s*<\/(p)>/g, '</$1>');

  // Restore placeholders
  html = html.replace(/\x00PH(\d+)\x00/g, (_m, idx) => placeholders[Number(idx)]);

  return html;
}

/** Look up the active project and its active tab from state. */
function getActiveTab(s: AppState): { project: Project; tab: FileTab } | null {
  const project = s.projects.find((p) => p.id === s.activeProjectId);
  if (!project || !project.activeTabId) return null;
  const tab = project.tabs.find((t) => t.id === project.activeTabId);
  if (!tab) return null;
  return { project, tab };
}

export function initFileTabContent(): FileTabContentApi {
  const container = $('#file-tab-container')! as HTMLElement;
  container.style.position = 'relative';
  let currentContent = '';
  let editBuffer = '';
  let isBinary = false;
  let lastTabId: string | null = null;
  let lastFilePath: string | null = null;
  let activeTabId: string | null = null;
  let currentMode: RenderMode = 'plain-editor';
  let loadVersion = 0;
  let lastMtime = 0;

  const findController = createFindController(
    () => currentContent,
    () => currentMode,
  );

  async function saveTab(projectId: string, tabId: string, filePath: string): Promise<void> {
    try {
      await writeTextFile(filePath, editBuffer);
      currentContent = editBuffer;
      setFileTabDirty(projectId, tabId, false);
      setFileTabEditing(projectId, tabId, false);
      lastMtime = await getFileMtime(filePath).catch(() => lastMtime);
    } catch (err: unknown) {
      console.error('Failed to save file:', err);
    }
  }

  /** Reload file content from disc and re-render. Returns false if the tab changed mid-read. */
  async function reloadFileContent(
    projectId: string,
    tab: FileTab,
    mtime: number,
  ): Promise<boolean> {
    try {
      const result = await readTextFile(tab.filePath);
      if (tab.id !== activeTabId) return false;
      currentContent = result.content;
      editBuffer = result.content;
      lastMtime = mtime;
      render(projectId, tab);
      return true;
    } catch {
      // File may have been deleted; ignore
      return false;
    }
  }

  async function checkForExternalChanges(): Promise<void> {
    const found = getActiveTab(store.getState());
    if (!found || isBinary) return;
    const { project, tab } = found;
    if (tab.id !== activeTabId) return;

    let currentMtime: number;
    try {
      currentMtime = await getFileMtime(tab.filePath);
    } catch {
      return;
    }

    if (currentMtime <= lastMtime) return;

    if (!tab.dirty) {
      await reloadFileContent(project.id, tab, currentMtime);
      return;
    }

    const fileName = tab.filePath.split(/[\\/]/).pop();
    const { confirmed } = await showConfirmDialog({
      title: 'File Changed',
      message: `"${fileName}" has been modified externally. Reload and discard your changes?`,
      confirmText: 'Reload',
      danger: true,
    });

    if (confirmed) {
      const reloaded = await reloadFileContent(project.id, tab, currentMtime);
      if (reloaded) setFileTabDirty(project.id, tab.id, false);
    } else {
      lastMtime = currentMtime;
    }
  }

  /** Build the Save/Cancel action buttons for the header. */
  function createHeaderActions(projectId: string, tabId: string): HTMLElement {
    const actions = createElement('div', { className: 'file-tab-actions' });

    const cancelBtn = createElement('button', { className: 'file-tab-cancel-btn' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      editBuffer = currentContent;
      setFileTabDirty(projectId, tabId, false);
      setFileTabEditing(projectId, tabId, false);
    });
    actions.appendChild(cancelBtn);

    const saveBtn = createElement('button', { className: 'file-tab-save-btn' });
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const found = getActiveTab(store.getState());
      if (found) saveTab(projectId, tabId, found.tab.filePath);
    });
    actions.appendChild(saveBtn);

    return actions;
  }

  container.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const found = getActiveTab(store.getState());
      if (!found || !found.tab.dirty) return;
      saveTab(found.project.id, found.tab.id, found.tab.filePath);
    }
  });

  function render(projectId: string, tab: FileTab): void {
    findController.detach();
    clearChildren(container);

    const header = createElement('div', { className: 'file-tab-header' });
    const pathDisplay = createElement('span', { className: 'file-tab-path' });
    pathDisplay.textContent = tab.filePath;
    pathDisplay.title = tab.filePath;
    header.appendChild(pathDisplay);

    if (tab.dirty) {
      header.appendChild(createHeaderActions(projectId, tab.id));
    }

    container.appendChild(header);

    const content = createElement('div', { className: 'file-tab-content' });

    if (isBinary) {
      const msg = createElement('div', { className: 'file-tab-binary' });
      msg.textContent = 'This file is not displayed because it is a binary file.';
      content.appendChild(msg);
      container.appendChild(content);
      return;
    }

    if (tab.fileType === 'markdown' && !tab.editing) {
      currentMode = 'markdown';
      const mdView = createElement('div', { className: 'file-tab-markdown' });
      mdView.innerHTML = renderMarkdown(currentContent);
      content.appendChild(mdView);

      content.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Edit',
            action: () => {
              editBuffer = currentContent;
              setFileTabEditing(projectId, tab.id, true);
            },
          },
        ]);
      });
    } else {
      const grammar = getGrammar(tab.fileType);

      if (grammar) {
        currentMode = 'highlighted-editor';
        const wrap = createElement('div', { className: 'highlighted-editor-wrap' });

        const backdrop = createElement('pre', { className: 'highlighted-editor-backdrop' });
        const code = document.createElement('code');
        backdrop.appendChild(code);

        const textarea = createElement('textarea', { className: 'highlighted-editor-textarea' }) as HTMLTextAreaElement;
        textarea.spellcheck = false;

        const text = tab.dirty ? editBuffer : currentContent;
        textarea.value = text;

        const tokens = tokenize(text, grammar);
        code.innerHTML = tokensToHtml(tokens);

        const rehighlight = debounce(() => {
          const t = tokenize(textarea.value, grammar);
          code.innerHTML = tokensToHtml(t);
          findController.refreshHighlights();
        }, 150);

        textarea.addEventListener('input', () => {
          editBuffer = textarea.value;
          if (!tab.dirty) {
            setFileTabDirty(projectId, tab.id, true);
          }
          rehighlight();
        });

        textarea.addEventListener('scroll', () => {
          backdrop.scrollTop = textarea.scrollTop;
          backdrop.scrollLeft = textarea.scrollLeft;
        });

        wrap.appendChild(backdrop);
        wrap.appendChild(textarea);
        content.appendChild(wrap);
      } else {
        currentMode = 'plain-editor';
        const textarea = createElement('textarea', { className: 'file-tab-editor' }) as HTMLTextAreaElement;
        textarea.value = tab.dirty ? editBuffer : currentContent;
        textarea.addEventListener('input', () => {
          editBuffer = textarea.value;
          if (!tab.dirty) {
            setFileTabDirty(projectId, tab.id, true);
          }
        });
        content.appendChild(textarea);
      }

      if (tab.fileType === 'markdown') {
        content.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, [
            {
              label: 'View',
              action: () => {
                setFileTabEditing(projectId, tab.id, false);
              },
            },
          ]);
        });
      } else {
        content.addEventListener('contextmenu', (e) => {
          e.preventDefault();
        });
      }
    }

    container.appendChild(content);
    findController.attach(content);

    // Auto-focus textarea when entering edit mode
    if (tab.editing) {
      const textarea = content.querySelector('textarea') as HTMLTextAreaElement | null;
      if (textarea) {
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        });
      }
    }
  }

  /** Update only the header actions (Save/Cancel) without rebuilding content. */
  function updateHeader(projectId: string, tabId: string, dirty: boolean): void {
    const header = container.querySelector('.file-tab-header') as HTMLElement | null;
    if (!header) return;

    const existing = header.querySelector('.file-tab-actions');
    if (existing) existing.remove();

    if (dirty) {
      header.appendChild(createHeaderActions(projectId, tabId));
    }
  }

  let lastIdentityKey: string | null = null;

  // Identity subscription — triggers full re-render when file, tab, or edit mode changes
  store.select(
    (s) => {
      const found = getActiveTab(s);
      if (!found) return null;
      const { project, tab } = found;
      return `${project.id}|${tab.id}|${tab.filePath}|${tab.fileType}|${tab.editing}`;
    },
    async (key) => {
      if (!key) {
        container.classList.add('hidden');
        activeTabId = null;
        lastIdentityKey = null;
        lastMtime = 0;
        return;
      }
      container.classList.remove('hidden');

      const found = getActiveTab(store.getState());
      if (!found) return;
      const { project, tab } = found;

      const version = ++loadVersion;

      if (tab.filePath !== lastFilePath || tab.id !== lastTabId) {
        try {
          const result = await readTextFile(tab.filePath);
          if (version !== loadVersion) return;
          isBinary = result.binary;
          currentContent = result.content;
          editBuffer = result.content;
          lastMtime = await getFileMtime(tab.filePath).catch(() => 0);
        } catch (err: unknown) {
          if (version !== loadVersion) return;
          isBinary = false;
          const message = err instanceof Error ? err.message : 'Unknown error';
          currentContent = `Error loading file: ${message}`;
          editBuffer = '';
          lastMtime = 0;
        }
      } else {
        await checkForExternalChanges();
      }

      if (version !== loadVersion) return;
      lastTabId = tab.id;
      lastFilePath = tab.filePath;
      activeTabId = tab.id;
      lastIdentityKey = key;
      render(project.id, tab);
    },
  );

  // Dirty subscription — only updates header buttons without rebuilding content
  store.select(
    (s) => {
      const found = getActiveTab(s);
      if (!found) return null;
      const { project, tab } = found;
      return `${project.id}|${tab.id}|${tab.dirty}`;
    },
    (key) => {
      if (!key || !lastIdentityKey) return;
      const [projectId, tabId, dirtyStr] = key.split('|');
      updateHeader(projectId, tabId, dirtyStr === 'true');
    },
  );

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeTabId) {
      checkForExternalChanges();
    }
  });

  return {
    openSearch() {
      if (activeTabId === null) return;
      findController.open();
    },
  };
}
