import { open } from '@tauri-apps/plugin-dialog';
import { store } from '../state/store';
import { addProject, removeProject, setActiveProject, toggleSettingsView, toggleGitSidebar, renameProject } from '../state/actions';
import { logger } from '../services/logger';
import { showContextMenu, startInlineRename } from './context-menu';
import { createElement, clearChildren, $ } from '../utils/dom';
import type { Project } from '../state/types';

export function initProjectTabBar(onProjectChange: () => void): void {
  const bar = $('#project-tab-bar')!;

  function render(projects: Project[], activeId: string | null): void {
    clearChildren(bar);

    const tabList = createElement('div', { className: 'tab-list' });
    for (const project of projects) {
      const isActive = project.id === activeId;
      const tab = createElement('button', {
        className: `project-tab${isActive ? ' active' : ''}`,
      });
      const tabLabel = createElement('span', { className: 'tab-label' });
      tabLabel.textContent = project.name;
      tab.appendChild(tabLabel);

      const close = createElement('span', { className: 'tab-close' });
      close.textContent = '\u00d7';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        logger.info('project', 'Remove project', { projectId: project.id, name: project.name });
        removeProject(project.id);
        onProjectChange();
      });
      tab.appendChild(close);

      tab.addEventListener('click', () => {
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
    settingsBtn.addEventListener('click', () => {
      toggleSettingsView();
    });
    actions.appendChild(settingsBtn);

    bar.appendChild(tabList);
    bar.appendChild(addProjectBtn);
    bar.appendChild(actions);
  }

  // Use two targeted selectors instead of subscribe() to avoid re-rendering
  // on unrelated state changes (e.g. pane resize, settings, view toggle).
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
