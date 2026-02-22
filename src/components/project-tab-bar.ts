import { open } from '@tauri-apps/plugin-dialog';
import { store } from '../state/store';
import { addProject, removeProject, setActiveProject, reorderProject, toggleSettingsView, renameProject } from '../state/actions';
import { logger } from '../services/logger';
import { confirmCloseProject } from './confirm-dialog';
import { showContextMenu, startInlineRename } from './context-menu';
import { createElement, clearChildren, $ } from '../utils/dom';
import { appendActivityIndicator } from './tab-indicators';
import type { Project } from '../state/types';
import { basename } from '../utils/path';
import { chevronDownIcon, chevronLeftIcon, chevronRightIcon, folderIcon, settingsIcon } from '../utils/icons';
import { setupScrollArrows } from '../utils/scroll-arrows';
import { createTabDragManager } from '../utils/tab-drag';

export function initProjectTabBar(onProjectChange: () => void): void {
  const bar = $('#project-tab-bar')!;

  const dragManager = createTabDragManager();

  // Reassigned each render so the ResizeObserver always calls the latest version
  let updateScrollArrows: () => boolean = () => false;

  // While an inline rename is in progress we must defer re-renders so the
  // input field is not destroyed.  `pendingRender` stores the latest args
  // that arrived while the rename was active.
  let renameActive = false;
  let pendingRender: { projects: Project[]; activeId: string | null } | null = null;

  function render(projects: Project[], activeId: string | null): void {
    // Defer re-render while an inline rename is active
    if (renameActive) {
      pendingRender = { projects, activeId };
      return;
    }
    // If a drag is in progress when re-render fires, abort it cleanly
    dragManager.cleanupDrag();

    clearChildren(bar);

    const leftArrow = createElement('button', { className: 'scroll-arrow left' });
    leftArrow.innerHTML = chevronLeftIcon(16);

    const tabList = createElement('div', { className: 'tab-list' });

    // Drop indicator element (lives inside tabList for positioning)
    const indicator = createElement('div', { className: 'tab-drop-indicator' });
    tabList.appendChild(indicator);

    for (let pi = 0; pi < projects.length; pi++) {
      const project = projects[pi];
      const isActive = project.id === activeId;
      const tab = createElement('button', {
        className: `project-tab${isActive ? ' active' : ''}`,
      });
      const iconEl = createElement('span', { className: 'project-tab-icon' });
      iconEl.innerHTML = folderIcon(12);
      tab.appendChild(iconEl);

      const tabLabel = createElement('span', { className: 'tab-label' });
      tabLabel.textContent = project.name;
      tab.appendChild(tabLabel);

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
        ]);
      });

      tabList.appendChild(tab);
    }

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

    const rightArrow = createElement('button', { className: 'scroll-arrow right' });
    rightArrow.innerHTML = chevronRightIcon(16);

    updateScrollArrows = setupScrollArrows({ tabList, leftArrow, rightArrow });

    // --- Tab list dropdown button (Edge-style) ---
    const dropdownBtn = createElement('button', {
      className: 'project-tab-dropdown',
      title: 'Show open projects',
    });
    dropdownBtn.innerHTML = chevronDownIcon(14);

    let dropdownPanel: HTMLElement | null = null;

    function onDropdownOutsideClick(e: MouseEvent): void {
      const target = e.target as Node;
      if (dropdownPanel?.contains(target) || dropdownBtn.contains(target)) return;
      closeDropdown();
    }

    function closeDropdown(): void {
      if (dropdownPanel) {
        dropdownPanel.remove();
        dropdownPanel = null;
      }
      window.removeEventListener('mousedown', onDropdownOutsideClick);
    }

    function createDropdownItem(project: Project, isActive: boolean): HTMLElement {
      const row = createElement('div', {
        className: `project-tab-dropdown-item${isActive ? ' active' : ''}`,
      });

      const icon = createElement('span', { className: 'project-tab-dropdown-icon' });
      icon.innerHTML = folderIcon(16);
      row.appendChild(icon);

      const info = createElement('div', { className: 'project-tab-dropdown-info' });
      const nameEl = createElement('div', { className: 'project-tab-dropdown-name' });
      nameEl.textContent = project.name;
      info.appendChild(nameEl);
      const pathEl = createElement('div', { className: 'project-tab-dropdown-path' });
      pathEl.textContent = project.path;
      info.appendChild(pathEl);
      row.appendChild(info);

      row.addEventListener('click', () => {
        closeDropdown();
        setActiveProject(project.id);
        onProjectChange();
      });

      return row;
    }

    function positionDropdownPanel(panel: HTMLElement, anchorRect: DOMRect): void {
      panel.style.top = `${anchorRect.bottom + 2}px`;
      panel.style.left = `${anchorRect.left}px`;

      const panelRect = panel.getBoundingClientRect();
      if (panelRect.right > window.innerWidth) {
        panel.style.left = `${window.innerWidth - panelRect.width - 4}px`;
      }
      if (panelRect.bottom > window.innerHeight) {
        panel.style.maxHeight = `${window.innerHeight - anchorRect.bottom - 8}px`;
      }
    }

    dropdownBtn.addEventListener('click', () => {
      if (dropdownPanel) {
        closeDropdown();
        return;
      }

      dropdownPanel = createElement('div', { className: 'project-tab-dropdown-panel' });

      const header = createElement('div', { className: 'project-tab-dropdown-header' });
      header.textContent = 'Open Projects';
      dropdownPanel.appendChild(header);

      const list = createElement('div', { className: 'project-tab-dropdown-list' });
      for (const project of projects) {
        list.appendChild(createDropdownItem(project, project.id === activeId));
      }
      dropdownPanel.appendChild(list);

      document.body.appendChild(dropdownPanel);
      positionDropdownPanel(dropdownPanel, dropdownBtn.getBoundingClientRect());

      requestAnimationFrame(() => {
        window.addEventListener('mousedown', onDropdownOutsideClick);
      });
    });

    bar.appendChild(dropdownBtn);
    bar.appendChild(leftArrow);
    bar.appendChild(tabList);
    bar.appendChild(rightArrow);
    bar.appendChild(addProjectBtn);
    bar.appendChild(actions);

    requestAnimationFrame(() => {
      const activeTab = tabList.querySelector('.project-tab.active') as HTMLElement | null;
      activeTab?.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
      // Re-scroll only if arrows changed visibility and shifted layout.
      if (updateScrollArrows()) {
        activeTab?.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
        updateScrollArrows();
      }
    });
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

  new ResizeObserver(() => updateScrollArrows()).observe(bar);
}
