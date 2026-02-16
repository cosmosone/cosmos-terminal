import { open } from '@tauri-apps/plugin-dialog';
import { store } from '../state/store';
import { addProject, removeProject, setActiveProject, reorderProject, toggleSettingsView, toggleGitSidebar, renameProject } from '../state/actions';
import { logger } from '../services/logger';
import { confirmCloseProject } from './confirm-dialog';
import { showContextMenu, startInlineRename } from './context-menu';
import { createElement, clearChildren, $ } from '../utils/dom';
import type { Project } from '../state/types';

export function initProjectTabBar(onProjectChange: () => void): void {
  const bar = $('#project-tab-bar')!;

  // --- Drag-and-drop state (persists across re-renders) ---
  let dragState: {
    projectId: string;
    tab: HTMLElement;
    startX: number;
    tabRects: { id: string; left: number; right: number; center: number }[];
    indicator: HTMLElement;
    originIndex: number;
    dropIndex: number;
    dragging: boolean;
  } | null = null;
  let suppressClick = false;

  function onMouseMove(e: MouseEvent): void {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;

    if (!dragState.dragging) {
      if (Math.abs(dx) < 4) return;
      dragState.dragging = true;
      dragState.tab.classList.add('dragging');
      dragState.indicator.style.display = 'block';
    }

    // Safety: if DOM detached during drag, abort
    if (!dragState.tab.isConnected) {
      cleanupDrag();
      return;
    }

    dragState.tab.style.transform = `translateX(${dx}px)`;

    // Compute drop index from cursor position vs tab centers
    const rects = dragState.tabRects;
    let dropIndex = rects.length - 1;
    for (let i = 0; i < rects.length; i++) {
      if (e.clientX < rects[i].center) {
        dropIndex = i;
        break;
      }
    }
    dragState.dropIndex = dropIndex;

    // Position the indicator line relative to the parent
    const parentLeft = dragState.indicator.parentElement!.getBoundingClientRect().left;
    let indicatorLeft: number;
    if (dropIndex <= 0) {
      indicatorLeft = rects[0].left;
    } else if (dropIndex < rects.length) {
      indicatorLeft = (rects[dropIndex - 1].right + rects[dropIndex].left) / 2;
    } else {
      indicatorLeft = rects[dropIndex - 1].right;
    }
    dragState.indicator.style.left = `${indicatorLeft - parentLeft}px`;
  }

  function onMouseUp(): void {
    if (!dragState) return;
    const { projectId, dragging, originIndex, dropIndex } = dragState;
    cleanupDrag();
    if (dragging) {
      suppressClick = true;
      requestAnimationFrame(() => { suppressClick = false; });
      // Adjust dropIndex: if dropping after original position, account for removal
      const adjustedIndex = dropIndex > originIndex ? dropIndex - 1 : dropIndex;
      if (adjustedIndex !== originIndex) {
        reorderProject(projectId, adjustedIndex);
        onProjectChange();
      }
    }
  }

  function cleanupDrag(): void {
    if (dragState) {
      dragState.tab.classList.remove('dragging');
      dragState.tab.style.transform = '';
      dragState.indicator.style.display = 'none';
      dragState = null;
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  function render(projects: Project[], activeId: string | null): void {
    // If a drag is in progress when re-render fires, abort it cleanly
    if (dragState) cleanupDrag();

    clearChildren(bar);

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
      const tabLabel = createElement('span', { className: 'tab-label' });
      tabLabel.textContent = project.name;
      tab.appendChild(tabLabel);

      const hasBackgroundActivity = project.sessions.some(
        s => s.hasActivity && s.id !== project.activeSessionId,
      );
      if (hasBackgroundActivity) {
        tab.appendChild(createElement('span', { className: 'tab-activity' }));
      }

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
        // Only left click; ignore close button
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.tab-close')) return;

        const tabEls = tabList.querySelectorAll('.project-tab');
        const tabRects = Array.from(tabEls).map((el, i) => {
          const r = el.getBoundingClientRect();
          return { id: projects[i].id, left: r.left, right: r.right, center: r.left + r.width / 2 };
        });

        dragState = {
          projectId: project.id,
          tab,
          startX: e.clientX,
          tabRects,
          indicator,
          originIndex: pi,
          dropIndex: pi,
          dragging: false,
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      tab.addEventListener('click', () => {
        if (suppressClick) return;
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
              startInlineRename(tab, project.name, (newName) => {
                renameProject(project.id, newName);
              });
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
        const name = path.split(/[/\\]/).pop() || 'Project';
        logger.info('project', 'Add project via folder picker', { name, path });
        addProject(name, path);
        onProjectChange();
      }
    });

    // Right-side actions
    const actions = createElement('div', { className: 'project-tab-actions' });

    const gitBtn = createElement('button', { className: 'project-tab-action', title: 'Source Control' });
    gitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>';
    gitBtn.addEventListener('click', toggleGitSidebar);
    actions.appendChild(gitBtn);

    const settingsBtn = createElement('button', { className: 'project-tab-action', title: 'Settings' });
    settingsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    settingsBtn.addEventListener('click', toggleSettingsView);
    actions.appendChild(settingsBtn);

    bar.appendChild(tabList);
    bar.appendChild(addProjectBtn);
    bar.appendChild(actions);
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
