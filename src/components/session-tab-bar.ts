import { store } from '../state/store';
import { addSession, removeSession, removeProject, setActiveSession, setActiveTab, removeContentTab, closeOtherTabs, splitPane, renameSession, setFileTabEditing, toggleSessionLocked, toggleFileTabLocked, toggleFileBrowserSidebar, toggleGitSidebar } from '../state/actions';
import { AGENT_DEFINITIONS } from '../services/agent-definitions';
import type { AgentDef } from '../services/agent-definitions';
import { setInitialCommand } from '../services/initial-command';
import { findLeafPaneIds } from '../layout/pane-tree';
import { logger } from '../services/logger';
import { confirmCloseProject, confirmCloseTerminalTab } from './confirm-dialog';
import { showContextMenu, startInlineRename } from './context-menu';
import type { MenuItem } from './context-menu';
import { createElement, clearChildren, $ } from '../utils/dom';
import { appendActivityIndicator } from './tab-indicators';
import type { PaneLeaf, Project } from '../state/types';
import { chevronLeftIcon, chevronRightIcon, fileIcon, folderIcon, gitBranchIcon, lockIcon, terminalIcon } from '../utils/icons';

const SCROLL_STEP = 200;

const SESSION_ICON_MAP: Record<string, (size?: number) => string> = Object.fromEntries(
  AGENT_DEFINITIONS.map((a) => [a.command, a.icon]),
);

function sessionIcon(title: string, size?: number): string {
  const iconFn = SESSION_ICON_MAP[title.toLowerCase()] ?? terminalIcon;
  return iconFn(size);
}

export function initSessionTabBar(onTabChange: () => void): void {
  const bar = $('#session-tab-bar')!;

  // Reassigned each render so the ResizeObserver always calls the latest version
  let updateScrollArrows: () => void = () => {};

  function createAgentButton(project: Project, agent: AgentDef): HTMLButtonElement {
    const btn = createElement('button', { className: 'session-tab-add session-tab-agent' });
    btn.innerHTML = agent.icon(12);
    btn.title = `New ${agent.label} session`;
    btn.addEventListener('click', () => {
      logger.info('session', `Add ${agent.label} session via tab bar`, { projectId: project.id });
      const session = addSession(project.id, { title: agent.command });
      setInitialCommand((session.paneTree as PaneLeaf).paneId, agent.initialCmd ?? agent.command);
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
      iconEl.innerHTML = sessionIcon(session.title, 11);
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

    // Scroll arrows
    const leftArrow = createElement('button', { className: 'scroll-arrow left' });
    leftArrow.innerHTML = chevronLeftIcon(16);

    const rightArrow = createElement('button', { className: 'scroll-arrow right' });
    rightArrow.innerHTML = chevronRightIcon(16);

    updateScrollArrows = () => {
      const scrollLeft = tabList.scrollLeft;
      const maxScroll = tabList.scrollWidth - tabList.clientWidth;
      leftArrow.classList.toggle('visible', scrollLeft > 1);
      rightArrow.classList.toggle('visible', maxScroll > 1 && scrollLeft < maxScroll - 1);
    };

    tabList.addEventListener('scroll', updateScrollArrows);
    tabList.addEventListener('wheel', (e: WheelEvent) => {
      if (tabList.scrollWidth <= tabList.clientWidth) return;
      e.preventDefault();
      tabList.scrollLeft += e.deltaY;
    }, { passive: false });

    leftArrow.addEventListener('click', () => {
      tabList.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' });
    });
    rightArrow.addEventListener('click', () => {
      tabList.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' });
    });

    // Add-session buttons
    const addBtn = createElement('button', { className: 'session-tab-add session-tab-agent' });
    addBtn.innerHTML = terminalIcon(12);
    addBtn.title = 'New terminal session';
    addBtn.addEventListener('click', () => {
      logger.info('session', 'Add session via tab bar', { projectId: project.id });
      addSession(project.id);
      onTabChange();
    });

    // Right-side sidebar actions
    const sidebarActions = createElement('div', { className: 'session-tab-actions' });

    const explorerBtn = createElement('button', { className: 'session-tab-action', title: 'Explorer' });
    explorerBtn.innerHTML = folderIcon(12);
    explorerBtn.addEventListener('click', toggleFileBrowserSidebar);
    sidebarActions.appendChild(explorerBtn);

    const gitBtn = createElement('button', { className: 'session-tab-action', title: 'Source Control' });
    gitBtn.innerHTML = gitBranchIcon(12);
    gitBtn.addEventListener('click', toggleGitSidebar);
    sidebarActions.appendChild(gitBtn);

    bar.appendChild(leftArrow);
    bar.appendChild(tabList);
    bar.appendChild(rightArrow);
    bar.appendChild(addBtn);
    for (const agent of AGENT_DEFINITIONS) {
      bar.appendChild(createAgentButton(project, agent));
    }

    const divider = createElement('span', { className: 'session-tab-divider' });
    bar.appendChild(divider);
    bar.appendChild(sidebarActions);

    requestAnimationFrame(() => {
      const activeTab = tabList.querySelector('.session-tab.active') as HTMLElement | null;
      activeTab?.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
      updateScrollArrows();
      // Second pass: arrow visibility may shift layout, so re-scroll and re-check
      activeTab?.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
      updateScrollArrows();
    });
  }

  store.select(
    (s) => s.projects.find((p) => p.id === s.activeProjectId),
    (project) => render(project),
  );

  const s = store.getState();
  render(s.projects.find((p) => p.id === s.activeProjectId));

  new ResizeObserver(() => updateScrollArrows()).observe(bar);
}
