import { store } from '../state/store';
import { addSession, removeSession, removeProject, setActiveSession, setActiveTab, removeContentTab, closeOtherTabs, splitPane, renameSession, setFileTabEditing, toggleSessionLocked, toggleFileTabLocked, toggleFileBrowserSidebar, toggleGitSidebar } from '../state/actions';
import { setInitialCommand } from '../services/initial-command';
import { findLeafPaneIds } from '../layout/pane-tree';
import { logger } from '../services/logger';
import { confirmCloseProject, confirmCloseTerminalTab } from './confirm-dialog';
import { showContextMenu, startInlineRename } from './context-menu';
import type { MenuItem } from './context-menu';
import { createElement, clearChildren, $ } from '../utils/dom';
import { appendActivityIndicator } from './tab-indicators';
import type { PaneLeaf, Project } from '../state/types';
import { fileIcon, folderIcon, gitBranchIcon, lockIcon } from '../utils/icons';

const TERMINAL_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9M3.854 4.146a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708z"/><path d="M2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/></svg>';
const CLAUDE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/></svg>';
const CODEX_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/></svg>';

export function initSessionTabBar(onTabChange: () => void): void {
  const bar = $('#session-tab-bar')!;

  function createAgentButton(project: Project, label: string, command: string, iconSvg: string): HTMLButtonElement {
    const btn = createElement('button', { className: 'session-tab-add session-tab-agent' });
    btn.innerHTML = iconSvg;
    btn.title = `New ${label} session`;
    btn.addEventListener('click', () => {
      logger.info('session', `Add ${label} session via tab bar`, { projectId: project.id });
      const session = addSession(project.id, { title: command });
      setInitialCommand((session.paneTree as PaneLeaf).paneId, command);
      onTabChange();
    });
    return btn;
  }

  async function closeSessionTab(project: Project, sessionId: string, sessionTitle: string): Promise<void> {
    if (project.sessions.length <= 1 && project.tabs.length === 0) {
      if (!await confirmCloseProject(project.name)) return;
      logger.info('project', 'Remove project via last session tab close', { projectId: project.id, name: project.name });
      removeProject(project.id);
      onTabChange();
      return;
    }
    if (!await confirmCloseTerminalTab(sessionTitle)) return;
    logger.info('session', 'Remove session via tab close', { sessionId, title: sessionTitle });
    removeSession(project.id, sessionId);
    onTabChange();
  }

  function render(project: Project | undefined): void {
    clearChildren(bar);
    if (!project) return;

    const tabList = createElement('div', { className: 'tab-list' });

    for (const session of project.sessions) {
      const isActive = session.id === project.activeSessionId && project.activeTabId === null;
      const tab = createElement('button', {
        className: `session-tab${isActive ? ' active' : ''}`,
      });
      const iconEl = createElement('span', { className: 'session-tab-icon' });
      const titleLower = session.title.toLowerCase();
      if (titleLower === 'claude') {
        iconEl.innerHTML = CLAUDE_ICON_SVG;
      } else if (titleLower === 'codex') {
        iconEl.innerHTML = CODEX_ICON_SVG;
      } else {
        iconEl.innerHTML = TERMINAL_ICON_SVG;
      }
      tab.appendChild(iconEl);

      const tabLabel = createElement('span', { className: 'tab-label' });
      tabLabel.textContent = session.title;
      tab.appendChild(tabLabel);

      if (!isActive) {
        appendActivityIndicator(tab, session.hasActivity, session.activityCompleted);
      }

      if (session.locked) {
        const lock = createElement('span', { className: 'tab-lock' });
        lock.innerHTML = lockIcon(10);
        lock.title = 'Unlock tab';
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleSessionLocked(project.id, session.id);
          onTabChange();
        });
        tab.appendChild(lock);
      } else {
        const close = createElement('span', { className: 'tab-close' });
        close.textContent = '\u00d7';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          closeSessionTab(project, session.id, session.title);
        });
        tab.appendChild(close);
      }

      tab.addEventListener('click', () => {
        logger.debug('session', 'Switch session', { sessionId: session.id, title: session.title });
        setActiveSession(project.id, session.id);
        onTabChange();
      });

      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const targetPaneId = session.activePaneId ?? findLeafPaneIds(session.paneTree)[0];

        const doSplit = (direction: 'horizontal' | 'vertical', before: boolean): void => {
          if (!targetPaneId) return;
          splitPane(project.id, session.id, targetPaneId, direction, before);
          onTabChange();
        };

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
            label: session.locked ? 'Unlock' : 'Lock',
            action: () => {
              toggleSessionLocked(project.id, session.id);
              onTabChange();
            },
          },
          {
            label: 'Close',
            separator: true,
            action: () => closeSessionTab(project, session.id, session.title),
          },
          {
            label: 'Close Others',
            action: () => {
              closeOtherTabs(project.id, session.id, 'session');
              onTabChange();
            },
          },
          { label: 'Split Left', separator: true, action: () => doSplit('horizontal', true) },
          { label: 'Split Right', action: () => doSplit('horizontal', false) },
          { label: 'Split Up', action: () => doSplit('vertical', true) },
          { label: 'Split Down', action: () => doSplit('vertical', false) },
        ]);
      });

      tabList.appendChild(tab);
    }

    // --- File tabs ---
    if (project.tabs.length > 0) {
      const separator = createElement('span', { className: 'session-tab-separator' });
      tabList.appendChild(separator);

      for (const contentTab of project.tabs) {
        const isActive = contentTab.id === project.activeTabId;
        const tab = createElement('button', {
          className: `session-tab content-tab${isActive ? ' active' : ''}`,
        });

        const iconEl = createElement('span', { className: 'content-tab-icon' });
        iconEl.innerHTML = fileIcon(12);
        tab.appendChild(iconEl);

        const tabLabel = createElement('span', { className: 'tab-label' });
        tabLabel.textContent = contentTab.dirty ? `* ${contentTab.title}` : contentTab.title;
        tab.appendChild(tabLabel);

        if (contentTab.locked) {
          const lock = createElement('span', { className: 'tab-lock' });
          lock.innerHTML = lockIcon(10);
          lock.title = 'Unlock tab';
          lock.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFileTabLocked(project.id, contentTab.id);
            onTabChange();
          });
          tab.appendChild(lock);
        } else {
          const close = createElement('span', { className: 'tab-close' });
          close.textContent = '\u00d7';
          close.addEventListener('click', (e) => {
            e.stopPropagation();
            removeContentTab(project.id, contentTab.id);
            onTabChange();
          });
          tab.appendChild(close);
        }

        tab.addEventListener('click', () => {
          setActiveTab(project.id, contentTab.id);
          onTabChange();
        });

        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const items: MenuItem[] = [];

          if (contentTab.fileType === 'markdown') {
            items.push({
              label: contentTab.editing ? 'View' : 'Edit',
              action: () => {
                setFileTabEditing(project.id, contentTab.id, !contentTab.editing);
                onTabChange();
              },
            });
          }

          items.push({
            label: contentTab.locked ? 'Unlock' : 'Lock',
            separator: contentTab.fileType === 'markdown',
            action: () => {
              toggleFileTabLocked(project.id, contentTab.id);
              onTabChange();
            },
          });

          items.push(
            {
              label: 'Close',
              separator: true,
              action: () => {
                removeContentTab(project.id, contentTab.id);
                onTabChange();
              },
            },
            {
              label: 'Close Others',
              action: () => {
                closeOtherTabs(project.id, contentTab.id, 'content');
                onTabChange();
              },
            },
          );

          showContextMenu(e.clientX, e.clientY, items);
        });

        tabList.appendChild(tab);
      }
    }

    const addBtn = createElement('button', { className: 'session-tab-add session-tab-agent' });
    addBtn.innerHTML = TERMINAL_ICON_SVG;
    addBtn.title = 'New terminal session';
    addBtn.addEventListener('click', () => {
      logger.info('session', 'Add session via tab bar', { projectId: project.id });
      addSession(project.id);
      onTabChange();
    });

    // Right-side sidebar actions (pushed to far right)
    const sidebarActions = createElement('div', { className: 'session-tab-actions' });

    const explorerBtn = createElement('button', { className: 'session-tab-action', title: 'Explorer' });
    explorerBtn.innerHTML = folderIcon(14);
    explorerBtn.addEventListener('click', toggleFileBrowserSidebar);
    sidebarActions.appendChild(explorerBtn);

    const gitBtn = createElement('button', { className: 'session-tab-action', title: 'Source Control' });
    gitBtn.innerHTML = gitBranchIcon(14);
    gitBtn.addEventListener('click', toggleGitSidebar);
    sidebarActions.appendChild(gitBtn);

    bar.appendChild(tabList);
    bar.appendChild(addBtn);
    bar.appendChild(createAgentButton(project, 'Claude', 'claude', CLAUDE_ICON_SVG));
    bar.appendChild(createAgentButton(project, 'Codex', 'codex', CODEX_ICON_SVG));
    bar.appendChild(sidebarActions);
  }

  store.select(
    (s) => s.projects.find((p) => p.id === s.activeProjectId),
    (project) => render(project),
  );

  const s = store.getState();
  render(s.projects.find((p) => p.id === s.activeProjectId));
}
