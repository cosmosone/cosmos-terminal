import { store } from '../state/store';
import {
  toggleFileBrowserSidebar,
  setFileBrowserSidebarWidth,
  toggleFileBrowserPath,
  addFileTab,
} from '../state/actions';
import { listDirectory, searchFiles, showInExplorer, deletePath, onFsChange } from '../services/fs-service';
import type { DirEntry } from '../services/fs-service';
import { createElement, clearChildren, $ } from '../utils/dom';
import { setupSidebarResize } from '../utils/sidebar-resize';
import { normalizeFsPath } from '../utils/path';
import { folderIcon, fileIcon, chevronRightIcon, searchIcon, refreshIcon } from '../utils/icons';
import { showContextMenu } from './context-menu';
import type { MenuItem } from './context-menu';
import { showConfirmDialog } from './confirm-dialog';
import { languageFromExtension } from '../highlight/languages/index';

export interface FileBrowserSidebarApi {
  triggerSearch(): void;
}

export function initFileBrowserSidebar(onLayoutChange: () => void): FileBrowserSidebarApi {
  const container = $('#file-browser-sidebar-container')! as HTMLElement;
  const dirCache = new Map<string, DirEntry[]>();
  let renderRafId = 0;
  let renderGeneration = 0;

  // --- Multi-selection state ---
  const selectedPaths = new Set<string>();
  let anchorPath: string | null = null;
  const entryByPath = new Map<string, DirEntry>();

  // --- File-system event batching ---
  let fsChangeBatchTimer = 0;

  // --- Left-edge resize handle ---
  const resizeHandle = createElement('div', { className: 'fb-sidebar-resize' });
  container.appendChild(resizeHandle);
  setupSidebarResize(resizeHandle, setFileBrowserSidebarWidth, () => container.offsetWidth);

  // --- Header ---
  const header = createElement('div', { className: 'fb-sidebar-header' });
  const headerTitle = createElement('span', { className: 'fb-sidebar-header-title' });
  headerTitle.textContent = 'Explorer';
  const headerActions = createElement('div', { className: 'fb-sidebar-header-actions' });

  const searchBtn = createElement('button', { className: 'fb-sidebar-header-btn', title: 'Search Files' });
  searchBtn.innerHTML = searchIcon();
  headerActions.appendChild(searchBtn);

  const refreshBtn = createElement('button', { className: 'fb-sidebar-header-btn', title: 'Refresh' });
  refreshBtn.innerHTML = refreshIcon();
  refreshBtn.addEventListener('click', () => {
    dirCache.clear();
    scheduleRender();
  });
  headerActions.appendChild(refreshBtn);

  const collapseBtn = createElement('button', { className: 'fb-sidebar-header-btn', title: 'Collapse Sidebar' });
  collapseBtn.innerHTML = chevronRightIcon();
  collapseBtn.addEventListener('click', toggleFileBrowserSidebar);
  headerActions.appendChild(collapseBtn);

  header.appendChild(headerTitle);
  header.appendChild(headerActions);
  container.appendChild(header);

  // --- Body: tree view ---
  const body = createElement('div', { className: 'fb-sidebar-body' });
  container.appendChild(body);

  // --- Search mode ---
  let searchMode = false;
  let searchDebounceTimer = 0;
  const searchContainer = createElement('div', { className: 'fb-search-container' });
  const searchInput = createElement('input', { className: 'fb-search-input' }) as HTMLInputElement;
  searchInput.type = 'text';
  searchInput.placeholder = 'Search files...';
  const searchResults = createElement('div', { className: 'fb-search-results' });
  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(searchResults);

  function getActiveProject(): { id: string; path: string } | null {
    const state = store.getState();
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    return project ?? null;
  }

  function relativePath(filePath: string, rootPath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/?$/, '/');
    return normalized.startsWith(normalizedRoot)
      ? normalized.slice(normalizedRoot.length)
      : normalized;
  }

  function showSearchEmpty(message: string): void {
    clearChildren(searchResults);
    const empty = createElement('div', { className: 'fb-search-empty' });
    empty.textContent = message;
    searchResults.appendChild(empty);
  }

  function renderSearchResults(entries: DirEntry[], projectId: string, rootPath: string): void {
    clearChildren(searchResults);
    for (const entry of entries) {
      const row = createElement('div', { className: 'fb-search-result' });
      const icon = createElement('span', { className: 'fb-tree-icon' });
      icon.innerHTML = fileIcon();
      row.appendChild(icon);

      const info = createElement('div', { className: 'fb-search-result-info' });
      const nameEl = createElement('span', { className: 'fb-search-result-name' });
      nameEl.textContent = entry.name;
      const pathEl = createElement('span', { className: 'fb-search-result-path' });
      pathEl.textContent = relativePath(entry.path, rootPath);
      info.appendChild(nameEl);
      info.appendChild(pathEl);
      row.appendChild(info);

      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        addFileTab(projectId, entry.path, languageFromExtension(entry.extension));
      });

      searchResults.appendChild(row);
    }
  }

  function onSearchInput(): void {
    clearTimeout(searchDebounceTimer);
    const query = searchInput.value.trim();
    if (!query) {
      showSearchEmpty('Type to search...');
      return;
    }
    searchDebounceTimer = window.setTimeout(async () => {
      const project = getActiveProject();
      if (!project) return;
      try {
        const results = await searchFiles(project.path, query);
        if (results.length === 0) {
          showSearchEmpty('No results');
        } else {
          renderSearchResults(results, project.id, project.path);
        }
      } catch {
        showSearchEmpty('No results');
      }
    }, 200);
  }

  searchInput.addEventListener('input', onSearchInput);

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      exitSearchMode();
    }
  });

  function enterSearchMode(): void {
    searchMode = true;
    headerTitle.textContent = 'Search';
    body.style.display = 'none';
    container.appendChild(searchContainer);
    searchInput.value = '';
    showSearchEmpty('Type to search...');
    searchInput.focus();
  }

  function exitSearchMode(): void {
    searchMode = false;
    headerTitle.textContent = 'Explorer';
    clearTimeout(searchDebounceTimer);
    if (searchContainer.parentElement) {
      searchContainer.remove();
    }
    body.style.display = '';
  }

  searchBtn.addEventListener('click', () => searchMode ? exitSearchMode() : enterSearchMode());

  async function fetchDir(path: string): Promise<DirEntry[]> {
    const cacheKey = normalizeFsPath(path);
    const cached = dirCache.get(cacheKey);
    if (cached) return cached;
    try {
      const result = await listDirectory(path);
      dirCache.set(cacheKey, result.entries);
      return result.entries;
    } catch {
      return [];
    }
  }

  async function renderTree(): Promise<void> {
    const gen = ++renderGeneration;
    clearChildren(body);
    entryByPath.clear();
    const state = store.getState();
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (!project) {
      const empty = createElement('div', { className: 'fb-sidebar-empty' });
      empty.textContent = 'No project selected';
      body.appendChild(empty);
      return;
    }

    const entries = await fetchDir(project.path);
    if (gen !== renderGeneration) return; // stale render — a newer one has started
    const expandedPaths = state.fileBrowserSidebar.expandedPaths;

    for (const entry of entries) {
      body.appendChild(renderNode(entry, 0, expandedPaths, project.id));
    }
    applySelection();
  }

  function appendIconAndName(row: HTMLElement, iconHtml: string, name: string): void {
    const icon = createElement('span', { className: 'fb-tree-icon' });
    icon.innerHTML = iconHtml;
    row.appendChild(icon);

    const nameEl = createElement('span', { className: 'fb-tree-name' });
    nameEl.textContent = name;
    row.appendChild(nameEl);
  }

  async function handleDelete(path: string, name: string): Promise<void> {
    const { confirmed } = await showConfirmDialog({
      title: 'Delete',
      message: `Are you sure you want to delete "${name}"?`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deletePath(path);
      dirCache.clear();
      scheduleRender();
    } catch {
      // ignore
    }
  }

  function getVisiblePaths(): string[] {
    const rows = body.querySelectorAll<HTMLElement>('.fb-tree-node[data-path]');
    return Array.from(rows, (r) => r.dataset.path!);
  }

  function clearSelection(): void {
    selectedPaths.clear();
    anchorPath = null;
  }

  function applySelection(): void {
    for (const row of body.querySelectorAll<HTMLElement>('.fb-tree-node[data-path]')) {
      row.classList.toggle('selected', selectedPaths.has(row.dataset.path!));
    }
  }

  function handleSelectionClick(e: MouseEvent, path: string): void {
    if (e.shiftKey && anchorPath) {
      const paths = getVisiblePaths();
      const anchorIdx = paths.indexOf(anchorPath);
      const clickIdx = paths.indexOf(path);
      if (anchorIdx !== -1 && clickIdx !== -1) {
        const start = Math.min(anchorIdx, clickIdx);
        const end = Math.max(anchorIdx, clickIdx);
        selectedPaths.clear();
        for (let i = start; i <= end; i++) {
          selectedPaths.add(paths[i]);
        }
      }
    } else {
      selectedPaths.clear();
      selectedPaths.add(path);
      anchorPath = path;
    }
    applySelection();
  }

  async function handleBulkDelete(): Promise<void> {
    const { confirmed } = await showConfirmDialog({
      title: 'Delete',
      message: `Are you sure you want to delete the selected ${selectedPaths.size} items? This action cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    for (const path of selectedPaths) {
      try {
        await deletePath(path);
      } catch {
        // ignore
      }
    }
    clearSelection();
    dirCache.clear();
    scheduleRender();
  }

  function addContextMenu(
    row: HTMLElement,
    entry: DirEntry,
    projectId: string,
    fileType?: string,
  ): void {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (selectedPaths.size > 1 && selectedPaths.has(entry.path)) {
        showContextMenu(e.clientX, e.clientY, [
          { label: `Delete ${selectedPaths.size} items`, action: handleBulkDelete },
        ]);
        return;
      }

      selectedPaths.clear();
      selectedPaths.add(entry.path);
      anchorPath = entry.path;
      applySelection();

      const items: MenuItem[] = [];
      if (fileType !== undefined) {
        items.push({ label: 'Open', action: () => addFileTab(projectId, entry.path, fileType) });
      }
      items.push({ label: 'Open File Location', action: () => showInExplorer(entry.path) });
      items.push({ label: 'Delete', separator: true, action: () => handleDelete(entry.path, entry.name) });

      showContextMenu(e.clientX, e.clientY, items);
    });
  }

  function renderNode(entry: DirEntry, depth: number, expandedPaths: string[], projectId: string): HTMLElement {
    const wrap = createElement('div', { className: 'fb-tree-node-wrap' });
    const row = createElement('div', { className: 'fb-tree-node' });
    row.dataset.path = entry.path;
    row.style.paddingLeft = `${8 + depth * 16}px`;
    entryByPath.set(entry.path, entry);

    if (entry.isDir) {
      const expanded = expandedPaths.includes(entry.path);
      const arrow = createElement('span', { className: `fb-tree-arrow${expanded ? ' expanded' : ''}` });
      arrow.textContent = '\u25B6';
      row.appendChild(arrow);
      appendIconAndName(row, folderIcon(), entry.name);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSelectionClick(e, entry.path);
        if (!e.shiftKey) {
          toggleFileBrowserPath(entry.path);
          if (!expandedPaths.includes(entry.path)) {
            dirCache.delete(normalizeFsPath(entry.path));
          }
        }
      });

      addContextMenu(row, entry, projectId);
      wrap.appendChild(row);

      if (expanded) {
        const childContainer = createElement('div', { className: 'fb-tree-children' });
        fetchDir(entry.path).then((children) => {
          for (const child of children) {
            childContainer.appendChild(renderNode(child, depth + 1, expandedPaths, projectId));
          }
        });
        wrap.appendChild(childContainer);
      }
    } else {
      const spacer = createElement('span', { className: 'fb-tree-arrow-spacer' });
      row.appendChild(spacer);
      appendIconAndName(row, fileIcon(), entry.name);

      const fileType = languageFromExtension(entry.extension);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSelectionClick(e, entry.path);
      });
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        addFileTab(projectId, entry.path, fileType);
      });

      addContextMenu(row, entry, projectId, fileType);
      wrap.appendChild(row);
    }

    return wrap;
  }

  onFsChange((affectedDir) => {
    const normalizedChangedDir = normalizeFsPath(affectedDir);
    let invalidated = false;

    if (dirCache.delete(normalizedChangedDir)) {
      invalidated = true;
    } else {
      for (const key of Array.from(dirCache.keys())) {
        if (key.startsWith(`${normalizedChangedDir}/`)) {
          dirCache.delete(key);
          invalidated = true;
        }
      }
    }

    if (!invalidated) return;
    clearTimeout(fsChangeBatchTimer);
    fsChangeBatchTimer = window.setTimeout(() => scheduleRender(), 100);
  }).catch(() => {
    // Watcher event stream unavailable — manual refresh still works.
  });

  function applyVisibility(visible: boolean): void {
    container.classList.toggle('hidden', !visible);
    if (visible) {
      if (searchMode) exitSearchMode();
      container.style.width = store.getState().fileBrowserSidebar.width + 'px';
      dirCache.clear();
      renderTree();
    }
    onLayoutChange();
  }

  store.select(
    (s) => s.fileBrowserSidebar.visible,
    applyVisibility,
  );

  store.select(
    (s) => s.fileBrowserSidebar.width,
    (width) => {
      if (store.getState().fileBrowserSidebar.visible) {
        container.style.width = width + 'px';
        onLayoutChange();
      }
    },
  );

  function scheduleRender(): void {
    if (!store.getState().fileBrowserSidebar.visible) return;
    if (!renderRafId) {
      renderRafId = requestAnimationFrame(() => {
        renderRafId = 0;
        renderTree();
      });
    }
  }

  store.select((s) => s.fileBrowserSidebar.expandedPaths, scheduleRender);
  store.select((s) => s.activeProjectId, () => {
    if (searchMode) exitSearchMode();
    dirCache.clear();
    scheduleRender();
  });

  body.addEventListener('click', (e) => {
    if (e.target === body) {
      clearSelection();
      applySelection();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete') return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!store.getState().fileBrowserSidebar.visible) return;
    if (selectedPaths.size === 0) return;

    e.preventDefault();
    if (selectedPaths.size === 1) {
      const path = selectedPaths.values().next().value!;
      const entry = entryByPath.get(path);
      if (entry) handleDelete(entry.path, entry.name);
    } else {
      handleBulkDelete();
    }
  });

  return {
    triggerSearch(): void {
      if (!store.getState().fileBrowserSidebar.visible) {
        toggleFileBrowserSidebar();
      }
      // Defer so the sidebar becomes visible before entering search mode
      requestAnimationFrame(() => enterSearchMode());
    },
  };
}
