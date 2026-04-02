import { open } from '@tauri-apps/plugin-dialog';
import { store } from '../state/store';
import { addProject, removeProject, setActiveProject, reorderProject, toggleSettingsView, renameProject } from '../state/actions';
import { logger } from '../services/logger';
import { confirmCloseProject } from './confirm-dialog';
import { showContextMenu, startInlineRename } from './context-menu';
import { createElement, $ } from '../utils/dom';
import { appendActivityIndicator } from './tab-indicators';
import type { Project } from '../state/types';
import { suppressBrowserWebview, restoreBrowserWebview } from './browser-tab-content';
import { basename } from '../utils/path';
import { chevronDownIcon, folderIcon, settingsIcon } from '../utils/icons';
import { createScrollableTabList } from '../utils/scrollable-tab-list';
import { createTabDragManager } from '../utils/tab-drag';
import { positionDropdownPanel, createDropdownRow } from '../utils/dropdown';
import { showProjectSettingsDialog } from './project-settings-dialog';

export function initProjectTabBar(onProjectChange: () => void): void {
  const bar = $('#project-tab-bar')!;

  const dragManager = createTabDragManager();
  const scrollList = createScrollableTabList();

  // While an inline rename is in progress we must defer re-renders so the
  // input field is not destroyed.  `pendingRender` stores the latest args
  // that arrived while the rename was active.
  let renameActive = false;
  let pendingRender: { projects: Project[]; activeId: string | null } | null = null;

  // R5: Dropdown state lives outside render() so re-renders can clean up any open dropdown
  let dropdownPanel: HTMLElement | null = null;

  function onDropdownOutsideClick(e: MouseEvent): void {
    const target = e.target as Node;
    // dropdownBtn may have been rebuilt by a render; only check if panel contains target
    if (dropdownPanel?.contains(target)) return;
    // Also check if click is on any dropdown button (class-based, survives re-render)
    if ((target as Element).closest?.('.project-tab-dropdown')) return;
    closeDropdown();
  }

  function closeDropdown(): void {
    if (dropdownPanel) {
      dropdownPanel.remove();
      dropdownPanel = null;
      restoreBrowserWebview();
    }
    window.removeEventListener('mousedown', onDropdownOutsideClick);
  }

  // --- Stable frame elements (created once) ---

  const dropdownBtn = createElement('button', {
    className: 'project-tab-dropdown',
    title: 'Show open projects',
  });
  dropdownBtn.innerHTML = chevronDownIcon(14);

  dropdownBtn.addEventListener('click', async () => {
    if (dropdownPanel) {
      closeDropdown();
      return;
    }

    // Freeze the browser webview before showing the dropdown so it renders on top of page content
    await suppressBrowserWebview();

    dropdownPanel = createElement('div', { className: 'tab-dropdown-panel' });

    const header = createElement('div', { className: 'tab-dropdown-header' });
    header.textContent = 'Open Projects';
    dropdownPanel.appendChild(header);

    const list = createElement('div', { className: 'tab-dropdown-list' });
    for (const project of lastProjects) {
      const isActive = project.id === lastActiveId;
      list.appendChild(createDropdownRow({
        icon: folderIcon(16),
        name: project.name,
        detail: project.path,
        isActive,
        onClick: () => {
          closeDropdown();
          setActiveProject(project.id);
          onProjectChange();
        },
      }));
    }
    dropdownPanel.appendChild(list);

    document.body.appendChild(dropdownPanel);
    positionDropdownPanel(dropdownPanel, dropdownBtn.getBoundingClientRect());

    requestAnimationFrame(() => {
      window.addEventListener('mousedown', onDropdownOutsideClick);
    });
  });

  const addProjectBtn = createElement('button', { className: 'project-tab-add' });
  addProjectBtn.textContent = '+';
  addProjectBtn.addEventListener('click', async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const path = selected as string;
      const name = basename(path, 'Project');
      logger.info('project', 'Add project via folder picker', { name, path });
      addProject(name, path);
      onProjectChange();
    }
  });

  // Right-side actions
  const actions = createElement('div', { className: 'project-tab-actions' });
  const settingsBtn = createElement('button', { className: 'project-tab-action', title: 'Settings' });
  settingsBtn.innerHTML = settingsIcon(16);
  settingsBtn.addEventListener('click', toggleSettingsView);
  actions.appendChild(settingsBtn);

  // Assemble bar (once)
  bar.appendChild(dropdownBtn);
  bar.appendChild(scrollList.wrapper);
  bar.appendChild(addProjectBtn);
  bar.appendChild(actions);

  // --- Render function (only rebuilds tab elements) ---

  function render(projects: Project[], activeId: string | null): void {
    // Defer re-render while an inline rename is active
    if (renameActive) {
      pendingRender = { projects, activeId };
      return;
    }
    // If a drag is in progress when re-render fires, abort it cleanly
    dragManager.cleanupDrag();
    // R5: Close any open dropdown before rebuilding the bar
    closeDropdown();

    scrollList.clearTabs();

    const { tabList, indicator } = scrollList;

    for (let pi = 0; pi < projects.length; pi++) {
      const project = projects[pi];
      const isActive = project.id === activeId;
      const tab = createElement('button', {
        className: `project-tab${isActive ? ' active' : ''}`,
      });
      const content = createElement('span', { className: 'project-tab-content' });
      const tabLabel = createElement('span', { className: 'tab-label' });
      tabLabel.textContent = project.name;
      content.appendChild(tabLabel);
      tab.appendChild(content);

      // For the active project, only surface activity from background (non-visible) sessions.
      // For inactive projects, the user can't see ANY session, so all sessions count.
      const hasBackgroundActivity = project.sessions.some(
        (s) => s.hasActivity && (!isActive || s.id !== project.activeSessionId),
      );
      const hasBackgroundCompleted = project.sessions.some(
        (s) => s.activityCompleted && (!isActive || s.id !== project.activeSessionId),
      );
      appendActivityIndicator(tab, hasBackgroundActivity, hasBackgroundCompleted);

      const close = createElement('span', { className: 'tab-close' });
      close.textContent = '\u00d7';
      close.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await confirmCloseProject(project.name)) return;
        logger.info('project', 'Remove project', { projectId: project.id, name: project.name });
        removeProject(project.id);
        onProjectChange();
      });
      tab.appendChild(close);

      tab.addEventListener('mousedown', (e: MouseEvent) => {
        dragManager.startDrag(e, tab, tabList, indicator, project.id, pi, '.project-tab', projects, (itemId, _origin, adjustedIndex) => {
          reorderProject(itemId, adjustedIndex);
          onProjectChange();
        });
      });

      tab.addEventListener('click', () => {
        if (dragManager.suppressClick) return;
        logger.debug('project', 'Switch project', { projectId: project.id, name: project.name });
        setActiveProject(project.id);
        onProjectChange();
      });

      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Rename',
            action: () => {
              renameActive = true;
              pendingRender = null;
              const onRenameDone = () => {
                renameActive = false;
                if (pendingRender) {
                  const deferred = pendingRender;
                  pendingRender = null;
                  render(deferred.projects, deferred.activeId);
                } else {
                  onProjectChange();
                }
              };
              startInlineRename(tab, project.name, (newName) => {
                renameProject(project.id, newName);
              }, onRenameDone);
            },
          },
          {
            label: 'Settings',
            separator: true,
            action: () => {
              showProjectSettingsDialog(project.id);
            },
          },
        ]);
      });

      tabList.appendChild(tab);
    }

    scrollList.finalizeRender('.project-tab.active');
  }

  // Two targeted selectors instead of subscribe() to avoid re-rendering
  // on unrelated state changes (e.g. pane resize, settings, view toggle).
  // Note: these use reference equality, so a combined object selector would
  // defeat deduplication. A rare double render on simultaneous changes is
  // acceptable for correctness.
  let lastProjects = store.getState().projects;
  let lastActiveId = store.getState().activeProjectId;

  store.select(
    (s) => s.projects,
    (projects) => {
      lastProjects = projects;
      render(projects, lastActiveId);
    },
  );
  store.select(
    (s) => s.activeProjectId,
    (activeProjectId) => {
      lastActiveId = activeProjectId;
      render(lastProjects, activeProjectId);
    },
  );

  render(lastProjects, lastActiveId);
}
