import { store } from '../state/store';
import { setFileTabEditing, setFileTabDirty } from '../state/actions';
import { readTextFile, writeTextFile } from '../services/fs-service';
import { showContextMenu } from './context-menu';
import { getGrammar } from '../highlight/languages/index';
import { escapeHtml, tokenize, tokensToHtml } from '../highlight/tokenizer';
import { debounce } from '../utils/debounce';
import type { FileTab } from '../state/types';
import { createElement, clearChildren, $ } from '../utils/dom';

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

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>\s*<(h[1-6]|pre|blockquote|hr|li)/g, '<$1');
  html = html.replace(/<\/(h[1-6]|pre|blockquote|li)>\s*<\/p>/g, '</$1>');
  html = html.replace(/<p>\s*<hr>\s*<\/p>/g, '<hr>');
  html = html.replace(/<p><\/p>/g, '');

  return html;
}

export function initFileTabContent(): void {
  const container = $('#file-tab-container')! as HTMLElement;
  let currentContent = '';
  let editBuffer = '';
  let isBinary = false;
  let lastTabId: string | null = null;
  let lastFilePath: string | null = null;

  function render(projectId: string, tab: FileTab): void {
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
      // Check if a grammar exists for this file type
      const grammar = getGrammar(tab.fileType);

      if (grammar) {
        // Highlighted overlay editor
        const wrap = createElement('div', { className: 'highlighted-editor-wrap' });

        const backdrop = createElement('pre', { className: 'highlighted-editor-backdrop' });
        const code = document.createElement('code');
        backdrop.appendChild(code);

        const textarea = createElement('textarea', { className: 'highlighted-editor-textarea' }) as HTMLTextAreaElement;
        textarea.spellcheck = false;

        const text = tab.dirty ? editBuffer : currentContent;
        textarea.value = text;

        // Initial highlight
        const tokens = tokenize(text, grammar);
        code.innerHTML = tokensToHtml(tokens);

        // Debounced re-highlight
        const rehighlight = debounce(() => {
          const t = tokenize(textarea.value, grammar);
          code.innerHTML = tokensToHtml(t);
        }, 150);

        textarea.addEventListener('input', () => {
          editBuffer = textarea.value;
          if (!tab.dirty) {
            setFileTabDirty(projectId, tab.id, true);
          }
          rehighlight();
        });

        // Scroll sync
        textarea.addEventListener('scroll', () => {
          backdrop.scrollTop = textarea.scrollTop;
          backdrop.scrollLeft = textarea.scrollLeft;
        });

        wrap.appendChild(backdrop);
        wrap.appendChild(textarea);
        content.appendChild(wrap);
      } else {
        // Plain textarea fallback
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
      }
    }

    container.appendChild(content);
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
      render(data.projectId, data.tab);
    },
  );
}
