import { store } from '../state/store';
import { addSession, removeSession, removeProject, setActiveSession, setActiveTab, removeFileTab, closeOtherTabs, splitPane, renameSession, setFileTabEditing, toggleSessionLocked, toggleFileTabLocked, toggleFileBrowserSidebar, toggleGitSidebar, reorderSession, reorderFileTab } from '../state/actions';
import { AGENT_DEFINITIONS } from '../services/agent-definitions';
import type { AgentDef } from '../services/agent-definitions';
import { setInitialCommand } from '../services/initial-command';
import { findLeafPaneIds } from '../layout/pane-tree';
import { logger } from '../services/logger';
import { confirmCloseProject, confirmCloseTerminalTab, showConfirmDialog } from './confirm-dialog';
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

  // --- Drag-and-drop state (persists across re-renders) ---
  let dragState: {
    type: 'session' | 'file';
    projectId: string;
    itemId: string;
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

    // Position the indicator line relative to the parent.
    // The indicator is absolutely positioned inside the scrollable tabList,
    // so we must add scrollLeft to convert viewport coords to content coords.
    const parent = dragState.indicator.parentElement!;
    const parentLeft = parent.getBoundingClientRect().left;
    let indicatorLeft: number;
    if (dropIndex <= 0) {
      indicatorLeft = rects[0].left;
    } else if (dropIndex < rects.length) {
      indicatorLeft = (rects[dropIndex - 1].right + rects[dropIndex].left) / 2;
    } else {
      indicatorLeft = rects[dropIndex - 1].right;
    }
    dragState.indicator.style.left = `${indicatorLeft - parentLeft + parent.scrollLeft}px`;
  }

  function onMouseUp(): void {
    if (!dragState) return;
    const { type, projectId, itemId, dragging, originIndex, dropIndex } = dragState;
    cleanupDrag();
    if (dragging) {
      suppressClick = true;
      requestAnimationFrame(() => { suppressClick = false; });
      // Adjust dropIndex: if dropping after original position, account for removal
      const adjustedIndex = dropIndex > originIndex ? dropIndex - 1 : dropIndex;
      if (adjustedIndex !== originIndex) {
        if (type === 'session') {
          reorderSession(projectId, itemId, adjustedIndex);
        } else {
          reorderFileTab(projectId, itemId, adjustedIndex);
        }
        onTabChange();
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

  async function closeFileTab(projectId: string, fileTab: { id: string; title: string; dirty: boolean }): Promise<void> {
    if (fileTab.dirty) {
      const { confirmed } = await showConfirmDialog({
        title: 'Unsaved Changes',
        message: `"${fileTab.title}" has unsaved changes. Close anyway?`,
        confirmText: 'Close',
        danger: true,
      });
      if (!confirmed) return;
    }
    removeFileTab(projectId, fileTab.id);
    onTabChange();
  }

  function render(project: Project | undefined): void {
    // If a drag is in progress when re-render fires, abort it cleanly
    if (dragState) cleanupDrag();
    clearChildren(bar);
    if (!project) return;

    const tabList = createElement('div', { className: 'tab-list' });

    // Drop indicator element (lives inside tabList for positioning)
    const indicator = createElement('div', { className: 'tab-drop-indicator' });
    tabList.appendChild(indicator);

    function appendLockOrClose(tab: HTMLElement, locked: boolean, onUnlock: () => void, onClose: () => void | Promise<void>): void {
      if (locked) {
        const lock = createElement('span', { className: 'tab-lock' });
        lock.innerHTML = lockIcon(10);
        lock.title = 'Unlock tab';
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          onUnlock();
        });
        tab.appendChild(lock);
      } else {
        const close = createElement('span', { className: 'tab-close' });
        close.textContent = '\u00d7';
        close.addEventListener('click', async (e) => {
          e.stopPropagation();
          await onClose();
        });
        tab.appendChild(close);
      }
    }

    const startDrag = (
      e: MouseEvent,
      tab: HTMLElement,
      type: 'session' | 'file',
      itemId: string,
      originIndex: number,
      selector: string,
      items: { id: string }[],
    ): void => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.tab-close, .tab-lock')) return;

      const tabEls = tabList.querySelectorAll(selector);
      const tabRects = Array.from(tabEls).map((el, i) => {
        const r = el.getBoundingClientRect();
        return { id: items[i].id, left: r.left, right: r.right, center: r.left + r.width / 2 };
      });

      dragState = {
        type,
        projectId: project.id,
        itemId,
        tab,
        startX: e.clientX,
        tabRects,
        indicator,
        originIndex,
        dropIndex: originIndex,
        dragging: false,
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    for (let si = 0; si < project.sessions.length; si++) {
      const session = project.sessions[si];
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

      appendLockOrClose(
        tab,
        session.locked,
        () => { toggleSessionLocked(project.id, session.id); onTabChange(); },
        () => closeSessionTab(project, session.id, session.title),
      );

      tab.addEventListener('mousedown', (e: MouseEvent) => {
        startDrag(e, tab, 'session', session.id, si, '.session-tab:not(.file-tab)', project.sessions);
      });

      tab.addEventListener('click', () => {
        if (suppressClick) return;
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

      for (let ci = 0; ci < project.tabs.length; ci++) {
        const fileTab = project.tabs[ci];
        const isActive = fileTab.id === project.activeTabId;
        const tab = createElement('button', {
          className: `session-tab file-tab${isActive ? ' active' : ''}`,
        });

        const iconEl = createElement('span', { className: 'file-tab-icon' });
        iconEl.innerHTML = fileIcon(12);
        tab.appendChild(iconEl);

        const tabLabel = createElement('span', { className: 'tab-label' });
        tabLabel.textContent = fileTab.dirty ? `* ${fileTab.title}` : fileTab.title;
        tab.appendChild(tabLabel);

        appendLockOrClose(
          tab,
          fileTab.locked,
          () => { toggleFileTabLocked(project.id, fileTab.id); onTabChange(); },
          () => closeFileTab(project.id, fileTab),
        );

        tab.addEventListener('mousedown', (e: MouseEvent) => {
          startDrag(e, tab, 'file', fileTab.id, ci, '.file-tab', project.tabs);
        });

        tab.addEventListener('click', () => {
          if (suppressClick) return;
          setActiveTab(project.id, fileTab.id);
          onTabChange();
        });

        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const items: MenuItem[] = [];

          if (fileTab.fileType === 'markdown') {
            items.push({
              label: fileTab.editing ? 'View' : 'Edit',
              action: () => {
                setFileTabEditing(project.id, fileTab.id, !fileTab.editing);
                onTabChange();
              },
            });
          }

          items.push({
            label: fileTab.locked ? 'Unlock' : 'Lock',
            separator: fileTab.fileType === 'markdown',
            action: () => {
              toggleFileTabLocked(project.id, fileTab.id);
              onTabChange();
            },
          });

          items.push(
            {
              label: 'Close',
              separator: true,
              action: () => closeFileTab(project.id, fileTab),
            },
            {
              label: 'Close Others',
              action: async () => {
                const dirtyOthers = project.tabs.filter((t) => t.id !== fileTab.id && !t.locked && t.dirty);
                if (dirtyOthers.length > 0) {
                  const { confirmed } = await showConfirmDialog({
                    title: 'Unsaved Changes',
                    message: `${dirtyOthers.length} other tab${dirtyOthers.length > 1 ? 's have' : ' has'} unsaved changes. Close anyway?`,
                    confirmText: 'Close All',
                    danger: true,
                  });
                  if (!confirmed) return;
                }
                closeOtherTabs(project.id, fileTab.id, 'file');
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

  new ResizeObserver(() => updateScrollArrows()).observe(bar);
}
