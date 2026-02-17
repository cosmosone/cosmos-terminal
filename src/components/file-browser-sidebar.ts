import { store } from '../state/store';
import {
  toggleFileBrowserSidebar,
  setFileBrowserSidebarWidth,
  toggleFileBrowserPath,
  addFileTab,
} from '../state/actions';
import { listDirectory, searchFiles } from '../services/fs-service';
import type { DirEntry } from '../services/fs-service';
import { createElement, clearChildren, $ } from '../utils/dom';
import { setupSidebarResize } from '../utils/sidebar-resize';
import { folderIcon, fileIcon, chevronRightIcon, searchIcon } from '../utils/icons';
import { languageFromExtension } from '../highlight/languages/index';

export function initFileBrowserSidebar(onLayoutChange: () => void): void {
  const container = $('#file-browser-sidebar-container')! as HTMLElement;
  const dirCache = new Map<string, DirEntry[]>();
  let renderRafId = 0;

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
    const cached = dirCache.get(path);
    if (cached) return cached;
    try {
      const result = await listDirectory(path);
      dirCache.set(path, result.entries);
      return result.entries;
    } catch {
      return [];
    }
  }

  async function renderTree(): Promise<void> {
    clearChildren(body);
    const state = store.getState();
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (!project) {
      const empty = createElement('div', { className: 'fb-sidebar-empty' });
      empty.textContent = 'No project selected';
      body.appendChild(empty);
      return;
    }

    const entries = await fetchDir(project.path);
    const expandedPaths = state.fileBrowserSidebar.expandedPaths;

    for (const entry of entries) {
      body.appendChild(renderNode(entry, 0, expandedPaths, project.id));
    }
  }

  function appendIconAndName(row: HTMLElement, iconHtml: string, name: string): void {
    const icon = createElement('span', { className: 'fb-tree-icon' });
    icon.innerHTML = iconHtml;
    row.appendChild(icon);

    const nameEl = createElement('span', { className: 'fb-tree-name' });
    nameEl.textContent = name;
    row.appendChild(nameEl);
  }

  function renderNode(entry: DirEntry, depth: number, expandedPaths: string[], projectId: string): HTMLElement {
    const wrap = createElement('div', { className: 'fb-tree-node-wrap' });
    const row = createElement('div', { className: 'fb-tree-node' });
    row.style.paddingLeft = `${8 + depth * 16}px`;

    if (entry.isDir) {
      const expanded = expandedPaths.includes(entry.path);
      const arrow = createElement('span', { className: `fb-tree-arrow${expanded ? ' expanded' : ''}` });
      arrow.textContent = '\u25B6';
      row.appendChild(arrow);
      appendIconAndName(row, folderIcon(), entry.name);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFileBrowserPath(entry.path);
        if (!expandedPaths.includes(entry.path)) {
          dirCache.delete(entry.path);
        }
      });

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
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        addFileTab(projectId, entry.path, fileType);
      });

      wrap.appendChild(row);
    }

    return wrap;
  }

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

  applyVisibility(store.getState().fileBrowserSidebar.visible);

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
}
