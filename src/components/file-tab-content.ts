import { store } from '../state/store';
import { setFileTabEditing, setFileTabDirty } from '../state/actions';
import { readTextFile, writeTextFile } from '../services/fs-service';
import { showContextMenu } from './context-menu';
import { getGrammar } from '../highlight/languages/index';
import { escapeHtml, tokenize, tokensToHtml } from '../highlight/tokenizer';
import { debounce } from '../utils/debounce';
import type { FileTab } from '../state/types';
import { createElement, clearChildren, $ } from '../utils/dom';
import { createFindController, type RenderMode } from './find-in-document';

export interface FileTabContentApi {
  openSearch(): void;
}

/** Matches consecutive list lines and wraps them in `<ol>` or `<ul>`. */
function wrapListItems(html: string, marker: RegExp, tag: 'ol' | 'ul'): string {
  const blockPattern = new RegExp(`((?:^${marker.source}\\s+.+\\n?)+)`, 'gm');
  const linePattern = new RegExp(`^${marker.source}\\s+(.+)$`);
  return html.replace(blockPattern, (block) => {
    const items = block.trim().split('\n')
      .map(line => line.replace(linePattern, '<li>$1</li>'))
      .join('');
    return `<${tag}>${items}</${tag}>`;
  });
}

function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source);
  let html = escaped;

  // Code blocks (```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre class="md-code-block"><code>${code}</code></pre>`,
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

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

  // Ordered lists (grouped in <ol>)
  html = wrapListItems(html, /\d+\./, 'ol');

  // Unordered lists (grouped in <ul>)
  html = wrapListItems(html, /[-*]/, 'ul');

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

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>\s*<(h[1-6]|pre|blockquote|hr|li|ol|ul)/g, '<$1');
  html = html.replace(/<\/(h[1-6]|pre|blockquote|li|ol|ul)>\s*<\/p>/g, '</$1>');
  html = html.replace(/<p>\s*<hr>\s*<\/p>/g, '<hr>');
  html = html.replace(/<p><\/p>/g, '');

  return html;
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

  const findController = createFindController(
    () => currentContent,
    () => currentMode,
  );

  function render(projectId: string, tab: FileTab): void {
    findController.detach();
    clearChildren(container);

    const header = createElement('div', { className: 'file-tab-header' });
    const pathDisplay = createElement('span', { className: 'file-tab-path' });
    pathDisplay.textContent = tab.filePath;
    pathDisplay.title = tab.filePath;
    header.appendChild(pathDisplay);

    if (tab.dirty) {
      const actions = createElement('div', { className: 'file-tab-actions' });

      const cancelBtn = createElement('button', { className: 'file-tab-cancel-btn' });
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        editBuffer = currentContent;
        setFileTabDirty(projectId, tab.id, false);
        setFileTabEditing(projectId, tab.id, false);
      });
      actions.appendChild(cancelBtn);

      const saveBtn = createElement('button', { className: 'file-tab-save-btn' });
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', async () => {
        try {
          await writeTextFile(tab.filePath, editBuffer);
          currentContent = editBuffer;
          setFileTabDirty(projectId, tab.id, false);
          setFileTabEditing(projectId, tab.id, false);
        } catch (err: unknown) {
          console.error('Failed to save file:', err);
        }
      });
      actions.appendChild(saveBtn);

      header.appendChild(actions);
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
  }

  store.select(
    (s) => {
      const project = s.projects.find((p) => p.id === s.activeProjectId);
      if (!project || !project.activeTabId) return null;
      const tab = project.tabs.find((t) => t.id === project.activeTabId);
      if (!tab) return null;
      return { projectId: project.id, tab };
    },
    async (data) => {
      if (!data) {
        container.classList.add('hidden');
        activeTabId = null;
        return;
      }
      container.classList.remove('hidden');

      if (data.tab.filePath !== lastFilePath || data.tab.id !== lastTabId) {
        try {
          const result = await readTextFile(data.tab.filePath);
          isBinary = result.binary;
          currentContent = result.content;
          editBuffer = result.content;
        } catch (err: unknown) {
          isBinary = false;
          const message = err instanceof Error ? err.message : 'Unknown error';
          currentContent = `Error loading file: ${message}`;
          editBuffer = '';
        }
      }

      lastTabId = data.tab.id;
      lastFilePath = data.tab.filePath;
      activeTabId = data.tab.id;
      render(data.projectId, data.tab);
    },
  );

  return {
    openSearch() {
      if (activeTabId === null) return;
      findController.open();
    },
  };
}
