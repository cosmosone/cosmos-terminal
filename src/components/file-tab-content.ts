import { store } from '../state/store';
import { setFileTabEditing, setFileTabDirty } from '../state/actions';
import { readTextFile, writeTextFile, writeTextFileIfUnmodified, getFileMtime, onFsChange } from '../services/fs-service';
import { showContextMenu, type MenuItem } from './context-menu';
import { showConfirmDialog } from './confirm-dialog';
import { getGrammar } from '../highlight/languages/index';
import { tokenize, tokensToHtml } from '../highlight/tokenizer';
import { renderMarkdownCached } from '../services/markdown-renderer';
import { logger } from '../services/logger';
import { debounce } from '../utils/debounce';
import { normalizeFsPath, isPathWithinDirectory } from '../utils/path';
import type { AppState, FileTab, Project } from '../state/types';
import type { Grammar } from '../highlight/types';
import { createElement, clearChildren, $ } from '../utils/dom';
import { createFindController, type RenderMode } from './find-in-document';

export interface FileTabContentApi {
  openSearch(): void;
}

let externalChangePollTimer: ReturnType<typeof setInterval> | null = null;

let hlCache: { key: string; html: string } | null = null;

function highlightCached(filePath: string, fileType: string, content: string, mtime: number, grammar: Grammar): string {
  const key = `${filePath}|${mtime}|${fileType}`;
  if (hlCache?.key === key) return hlCache.html;
  const html = tokensToHtml(tokenize(content, grammar));
  hlCache = { key, html };
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
  let externalCheckInFlight = false;
  const scrollPositions = new Map<string, number>();

  const findController = createFindController(
    () => currentContent,
    () => currentMode,
  );

  function renderFileLoadError(projectId: string, tab: FileTab, message: string): void {
    if (tab.id !== activeTabId) return;
    isBinary = false;
    currentContent = `Error loading file: ${message}`;
    editBuffer = '';
    lastMtime = 0;
    render(projectId, tab);
  }

  function isCurrentActiveTab(projectId: string, tabId: string): boolean {
    const state = store.getState();
    const activeProject = state.projects.find((p) => p.id === state.activeProjectId);
    return activeProject?.id === projectId && activeProject?.activeTabId === tabId && activeTabId === tabId;
  }

  async function saveTab(projectId: string, tabId: string, filePath: string): Promise<void> {
    try {
      let expectedMtime = lastMtime;
      if (expectedMtime <= 0) {
        expectedMtime = await getFileMtime(filePath).catch(() => 0);
      }

      if (expectedMtime > 0) {
        const writeResult = await writeTextFileIfUnmodified(filePath, editBuffer, expectedMtime);
        if (!writeResult.written) {
          if (!isCurrentActiveTab(projectId, tabId)) return;
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          const { confirmed: shouldReload } = await showConfirmDialog({
            title: 'Save Conflict',
            message: `"${fileName}" changed on disk. Reload latest file and discard your changes?`,
            confirmText: 'Reload',
            danger: true,
          });

          if (shouldReload) {
            const found = getActiveTab(store.getState());
            if (!found || found.project.id !== projectId || found.tab.id !== tabId) return;
            const reloaded = await reloadFileContent(projectId, found.tab, writeResult.mtime);
            if (reloaded) setFileTabDirty(projectId, tabId, false);
            return;
          }

          const { confirmed: shouldOverwrite } = await showConfirmDialog({
            title: 'Save Conflict',
            message: `"${fileName}" changed on disk. Overwrite disk contents with your editor changes?`,
            confirmText: 'Overwrite',
            danger: true,
          });
          if (!shouldOverwrite) {
            if (isCurrentActiveTab(projectId, tabId)) {
              lastMtime = writeResult.mtime;
            }
            return;
          }

          await writeTextFile(filePath, editBuffer);
          if (isCurrentActiveTab(projectId, tabId)) {
            lastMtime = await getFileMtime(filePath).catch(() => writeResult.mtime);
          }
        } else {
          if (isCurrentActiveTab(projectId, tabId)) {
            lastMtime = writeResult.mtime;
          }
        }
      } else {
        await writeTextFile(filePath, editBuffer);
        if (isCurrentActiveTab(projectId, tabId)) {
          lastMtime = await getFileMtime(filePath).catch(() => lastMtime);
        }
      }

      if (isCurrentActiveTab(projectId, tabId)) {
        currentContent = editBuffer;
      }
      setFileTabDirty(projectId, tabId, false);
    } catch (err: unknown) {
      logger.error('fs', 'Failed to save file', err instanceof Error ? err.message : String(err));
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
      logger.debug('fs', 'FileTab: reloadFileContent (will re-render)', {
        tabId: tab.id,
        newMtime: mtime,
        prevMtime: lastMtime,
        contentLen: result.content.length,
      });
      isBinary = result.binary;
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
    if (externalCheckInFlight) return;
    externalCheckInFlight = true;

    const found = getActiveTab(store.getState());
    try {
      if (!found || isBinary) return;
      const { project, tab } = found;
      if (tab.id !== activeTabId) {
        logger.debug('fs', 'FileTab: checkExternal skipped (tab mismatch)', {
          tabId: tab.id,
          activeTabId,
        });
        return;
      }

      let currentMtime: number;
      try {
        currentMtime = await getFileMtime(tab.filePath);
      } catch {
        if (!tab.dirty) {
          renderFileLoadError(project.id, tab, 'File was removed or is no longer accessible.');
        }
        return;
      }

      if (currentMtime <= lastMtime) {
        logger.debug('fs', 'FileTab: checkExternal no change', {
          currentMtime,
          lastMtime,
        });
        return;
      }

      logger.debug('fs', 'FileTab: checkExternal detected change', {
        currentMtime,
        lastMtime,
        dirty: tab.dirty,
      });

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
    } finally {
      externalCheckInFlight = false;
    }
  }

  const scheduleExternalChangeCheck = debounce(() => {
    void checkForExternalChanges();
  }, 120);

  function shouldCheckExternalChangeForDir(affectedDir: string): boolean {
    const found = getActiveTab(store.getState());
    if (!found || isBinary) return false;
    const { tab } = found;
    if (tab.id !== activeTabId) return false;
    const normalizedDir = normalizeFsPath(affectedDir);
    if (!normalizedDir) return false;
    return isPathWithinDirectory(tab.filePath, normalizedDir);
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
      if (found) void saveTab(projectId, tabId, found.tab.filePath);
    });
    actions.appendChild(saveBtn);

    return actions;
  }

  container.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const found = getActiveTab(store.getState());
      if (!found || !found.tab.dirty) return;
      void saveTab(found.project.id, found.tab.id, found.tab.filePath);
    }
  });

  function render(projectId: string, tab: FileTab): void {
    logger.debug('fs', 'FileTab: render', {
      tabId: tab.id,
      filePath: tab.filePath,
      fileType: tab.fileType,
      editing: tab.editing,
      dirty: tab.dirty,
      lastMtime,
      contentLen: currentContent.length,
      prevMode: currentMode,
    });
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

    const grammar = tab.fileType !== 'markdown' ? getGrammar(tab.fileType) : null;
    const hasViewMode = tab.fileType === 'markdown' || !!grammar;

    if (tab.fileType === 'markdown' && !tab.editing) {
      currentMode = 'markdown';
      const mdView = createElement('div', { className: 'file-tab-markdown' });
      mdView.innerHTML = renderMarkdownCached(tab.filePath, currentContent, lastMtime);
      content.appendChild(mdView);
    } else if (grammar && !tab.editing) {
      currentMode = 'highlighted';
      const pre = createElement('pre', { className: 'file-tab-code' });
      const code = createElement('code');
      code.innerHTML = highlightCached(tab.filePath, tab.fileType, currentContent, lastMtime, grammar);
      pre.appendChild(code);
      content.appendChild(pre);
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

    content.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const items: MenuItem[] = [];
      if (hasViewMode && !tab.editing) {
        items.push({
          label: 'Edit',
          action: () => {
            editBuffer = currentContent;
            setFileTabEditing(projectId, tab.id, true);
          },
        });
      } else if (hasViewMode) {
        items.push({
          label: 'View',
          action: () => { setFileTabEditing(projectId, tab.id, false); },
        });
      }
      items.push({
        label: 'Copy All',
        action: () => { void navigator.clipboard.writeText(currentContent); },
      });
      showContextMenu(e.clientX, e.clientY, items);
    });

    container.appendChild(content);
    findController.attach(content);

    // Track scroll position so it can be restored across tab switches
    content.addEventListener('scroll', () => {
      scrollPositions.set(tab.id, content.scrollTop);
    });

    // Restore saved scroll position
    const saved = scrollPositions.get(tab.id);
    if (saved !== undefined) content.scrollTop = saved;

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
      return `${project.id}|${tab.id}|${tab.filePath}|${tab.fileType}|${tab.editing}|${project.tabActivationSeq ?? 0}`;
    },
    async (key) => {
      if (!key) {
        logger.debug('fs', 'FileTab: identity null (tab deactivated)', {
          prevTabId: lastTabId,
          prevActiveTabId: activeTabId,
          lastMtime,
        });
        container.classList.add('hidden');
        activeTabId = null;
        lastIdentityKey = null;
        return;
      }
      container.classList.remove('hidden');

      const found = getActiveTab(store.getState());
      if (!found) return;
      const { project, tab } = found;

      const isTabSwitch = lastTabId !== null && tab.id !== lastTabId;
      const isSameTab = tab.filePath === lastFilePath && tab.id === lastTabId;
      logger.debug('fs', 'FileTab: identity changed', {
        tabId: tab.id,
        lastTabId,
        isTabSwitch,
        isSameTab,
        activeTabId,
        lastMtime,
        fileType: tab.fileType,
      });

      // Close the find dialog when switching to a different file tab.
      // The dialog belongs to the tab that opened it.
      if (isTabSwitch) {
        findController.close();
      }

      const version = ++loadVersion;

      if (!isSameTab) {
        // Prune scroll positions for tabs that no longer exist
        const tabIds = new Set(project.tabs.map((t) => t.id));
        for (const id of scrollPositions.keys()) {
          if (!tabIds.has(id)) scrollPositions.delete(id);
        }

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

  onFsChange((affectedDir) => {
    if (!shouldCheckExternalChangeForDir(affectedDir)) return;
    scheduleExternalChangeCheck();
  }).catch(() => {
    // File watcher unavailable; focus and tab-activation checks still run.
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeTabId) {
      void checkForExternalChanges();
    }
  });

  // Fallback polling catches missed watcher events on platforms/filesystems
  // where native notifications are lossy.
  if (externalChangePollTimer) {
    clearInterval(externalChangePollTimer);
  }
  externalChangePollTimer = window.setInterval(() => {
    if (document.hidden || activeTabId === null) return;
    void checkForExternalChanges();
  }, 2000);

  return {
    openSearch() {
      if (activeTabId === null) return;
      findController.open();
    },
  };
}
