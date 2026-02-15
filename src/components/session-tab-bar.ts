import { store } from '../state/store';
import { addSession, removeSession, removeProject, setActiveSession, splitPane, renameSession } from '../state/actions';
import { findLeafPaneIds } from '../layout/pane-tree';
import { logger } from '../services/logger';
import { confirmCloseProject } from './confirm-dialog';
import { showContextMenu, startInlineRename } from './context-menu';
import { createElement, clearChildren, $ } from '../utils/dom';
import type { Project } from '../state/types';

export function initSessionTabBar(onTabChange: () => void): void {
  const bar = $('#session-tab-bar')!;

  function render(project: Project | undefined): void {
    clearChildren(bar);
    if (!project) return;

    const tabList = createElement('div', { className: 'tab-list' });
    for (const session of project.sessions) {
      const isActive = session.id === project.activeSessionId;
      const tab = createElement('button', {
        className: `session-tab${isActive ? ' active' : ''}`,
      });
      const tabLabel = createElement('span', { className: 'tab-label' });
      tabLabel.textContent = session.title;
      tab.appendChild(tabLabel);

      const close = createElement('span', { className: 'tab-close' });
      close.textContent = '\u00d7';
      close.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (project.sessions.length <= 1) {
          if (!await confirmCloseProject(project.name)) return;
          logger.info('project', 'Remove project via last session tab close', { projectId: project.id, name: project.name });
          removeProject(project.id);
          onTabChange();
          return;
        }
        logger.info('session', 'Remove session via tab close', { sessionId: session.id, title: session.title });
        removeSession(project.id, session.id);
        onTabChange();
      });
      tab.appendChild(close);

      tab.addEventListener('click', () => {
        logger.debug('session', 'Switch session', { sessionId: session.id, title: session.title });
        setActiveSession(project.id, session.id);
        onTabChange();
      });

      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const targetPaneId = session.activePaneId ?? findLeafPaneIds(session.paneTree)[0];
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Rename',
            action: () => {
              startInlineRename(tab, session.title, (newName) => {
                renameSession(project.id, session.id, newName);
              });
            },
          },
          {
            label: 'Split Left',
            separator: true,
            action: () => {
              if (targetPaneId) {
                splitPane(project.id, session.id, targetPaneId, 'horizontal', true);
                onTabChange();
              }
            },
          },
          {
            label: 'Split Right',
            action: () => {
              if (targetPaneId) {
                splitPane(project.id, session.id, targetPaneId, 'horizontal', false);
                onTabChange();
              }
            },
          },
          {
            label: 'Split Up',
            action: () => {
              if (targetPaneId) {
                splitPane(project.id, session.id, targetPaneId, 'vertical', true);
                onTabChange();
              }
            },
          },
          {
            label: 'Split Down',
            action: () => {
              if (targetPaneId) {
                splitPane(project.id, session.id, targetPaneId, 'vertical', false);
                onTabChange();
              }
            },
          },
        ]);
      });

      tabList.appendChild(tab);
    }

    const addBtn = createElement('button', { className: 'session-tab-add' });
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => {
      logger.info('session', 'Add session via tab bar', { projectId: project.id });
      addSession(project.id);
      onTabChange();
    });

    bar.appendChild(tabList);
    bar.appendChild(addBtn);
  }

  store.select(
    (s) => s.projects.find((p) => p.id === s.activeProjectId),
    (project) => render(project),
  );

  const s = store.getState();
  render(s.projects.find((p) => p.id === s.activeProjectId));
}
