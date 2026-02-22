import { store } from '../state/store';
import { setFileTabEditing, setFileTabDirty } from '../state/actions';
import { readTextFile, writeTextFile, getFileMtime } from '../services/fs-service';
import { showContextMenu } from './context-menu';
import { showConfirmDialog } from './confirm-dialog';
import { getGrammar } from '../highlight/languages/index';
import { tokenize, tokensToHtml } from '../highlight/tokenizer';
import { renderMarkdownCached } from '../services/markdown-renderer';
import { debounce } from '../utils/debounce';
import type { AppState, FileTab, Project } from '../state/types';
import { createElement, clearChildren, $ } from '../utils/dom';
import { createFindController, type RenderMode } from './find-in-document';

export interface FileTabContentApi {
  openSearch(): void;
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
      mdView.innerHTML = renderMarkdownCached(tab.filePath, currentContent, lastMtime);
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
      // Markdown editing uses the plain textarea path to avoid overlay
      // hit-testing drift between textarea and syntax backdrop.
      const grammar = tab.fileType === 'markdown' ? null : getGrammar(tab.fileType);

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
        textarea.spellcheck = false;
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
