import { store } from '../state/store';
import {
  toggleGitSidebar,
  setGitSidebarWidth,
  toggleProjectExpanded,
  collapseAllProjects,
  setGitSidebarActiveProject,
  toggleGraphExpanded,
  updateGitState,
  setCommitMessage,
  setGenerating,
  defaultGitState,
} from '../state/actions';
import {
  isGitRepo,
  getGitStatus,
  getGitLog,
  getGitDiff,
  gitStageAll,
  gitCommit,
  gitPush,
} from '../services/git-service';
import { generateCommitMessage } from '../services/openai-service';
import { logger } from '../services/logger';
import { createElement, clearChildren, $ } from '../utils/dom';
import type { Project, ProjectGitState, GitFileStatus, GitFileStatusKind, GitStatusResult, GitLogEntry, GitNotificationType } from '../state/types';

const STATUS_LETTERS: Record<GitFileStatusKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
};

export function initGitSidebar(onLayoutChange: () => void): void {
  const container = $('#git-sidebar-container')! as HTMLElement;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let graphHeight = 200;
  let renderRafId = 0;

  // Local commit message buffer – avoids store updates (and full re-renders) on every keystroke
  const localCommitMessages = new Map<string, string>();

  // Notification auto-clear timers
  const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function showNotification(projectId: string, message: string, type: GitNotificationType, durationMs = 5000): void {
    const existing = notificationTimers.get(projectId);
    if (existing) clearTimeout(existing);

    updateGitState(projectId, { notification: { message, type } });

    const timer = setTimeout(() => {
      const current = store.getState().gitStates[projectId];
      if (current?.notification?.message === message) {
        updateGitState(projectId, { notification: null });
      }
      notificationTimers.delete(projectId);
    }, durationMs);
    notificationTimers.set(projectId, timer);
  }

  // --- Left-edge resize handle (sidebar width) ---
  const resizeHandle = createElement('div', { className: 'git-sidebar-resize' });
  container.appendChild(resizeHandle);

  let resizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startWidth = container.offsetWidth;
    resizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!resizing) return;
    const delta = startX - e.clientX;
    setGitSidebarWidth(startWidth + delta);
  });

  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    resizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // --- Header ---
  const header = createElement('div', { className: 'git-sidebar-header' });
  const headerTitle = createElement('span', { className: 'git-sidebar-header-title' });
  headerTitle.textContent = 'Source Control';
  const headerActions = createElement('div', { className: 'git-sidebar-header-actions' });
  const collapseAllBtn = createElement('button', { className: 'git-sidebar-header-btn', title: 'Collapse All' });
  collapseAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 3 12 8 17 3"/><polyline points="7 21 12 16 17 21"/></svg>';
  collapseAllBtn.addEventListener('click', collapseAllProjects);
  headerActions.appendChild(collapseAllBtn);

  const closeBtn = createElement('button', { className: 'git-sidebar-header-btn', title: 'Collapse Sidebar' });
  closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  closeBtn.addEventListener('click', toggleGitSidebar);
  headerActions.appendChild(closeBtn);
  header.appendChild(headerTitle);
  header.appendChild(headerActions);
  container.appendChild(header);

  // --- Body: split into changes panel + graph panel ---
  const body = createElement('div', { className: 'git-sidebar-body' });

  const changesPanel = createElement('div', { className: 'git-sidebar-changes-panel' });
  const changesContent = createElement('div', { className: 'git-sidebar-changes-content' });
  changesPanel.appendChild(changesContent);

  const graphDivider = createElement('div', { className: 'git-graph-divider' });
  const graphPanel = createElement('div', { className: 'git-sidebar-graph-panel' });
  const graphHeaderEl = createElement('div', { className: 'git-section-header git-graph-header' });
  const graphContent = createElement('div', { className: 'git-sidebar-graph-content' });
  graphPanel.appendChild(graphHeaderEl);
  graphPanel.appendChild(graphContent);

  body.appendChild(changesPanel);
  body.appendChild(graphDivider);
  body.appendChild(graphPanel);
  container.appendChild(body);

  // --- Graph panel resize ---
  let graphResizing = false;
  let graphStartY = 0;
  let graphStartHeight = 0;

  graphDivider.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    graphResizing = true;
    graphStartY = e.clientY;
    graphStartHeight = graphHeight;
    graphDivider.classList.add('active');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!graphResizing) return;
    const delta = graphStartY - e.clientY;
    graphHeight = Math.max(80, Math.min(600, graphStartHeight + delta));
    applyGraphHeight();
  });

  window.addEventListener('mouseup', () => {
    if (!graphResizing) return;
    graphResizing = false;
    graphDivider.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  function applyGraphHeight(): void {
    const state = store.getState();
    if (state.gitSidebar.graphExpanded) {
      graphPanel.style.height = graphHeight + 'px';
      graphDivider.classList.remove('hidden');
      graphContent.style.display = '';
    } else {
      graphPanel.style.height = 'auto';
      graphDivider.classList.add('hidden');
      graphContent.style.display = 'none';
    }
  }

  // --- Render ---
  function render(): void {
    const state = store.getState();
    const { projects, gitSidebar, gitStates } = state;

    // --- Changes panel ---
    clearChildren(changesContent);

    const gitProjects = projects.filter((p) => {
      const gs = gitStates[p.id];
      return !gs || gs.isRepo !== false;
    });

    for (const project of gitProjects) {
      const gs = gitStates[project.id] || defaultGitState();
      const expanded = gitSidebar.expandedProjectIds.includes(project.id);
      changesContent.appendChild(renderProject(project, gs, expanded));
    }

    // --- Graph header ---
    clearChildren(graphHeaderEl);
    const graphArrow = createElement('span', { className: `git-section-arrow${gitSidebar.graphExpanded ? '' : ' collapsed'}` });
    graphArrow.textContent = '\u25BC';
    const graphLabel = createElement('span');
    const activeId = gitSidebar.activeProjectId || gitProjects[0]?.id;
    const activeProject = activeId ? projects.find((p) => p.id === activeId) : null;
    graphLabel.textContent = activeProject
      ? `Commit History [${activeProject.name}]`
      : 'Commit History';
    graphHeaderEl.appendChild(graphArrow);
    graphHeaderEl.appendChild(graphLabel);
    graphHeaderEl.onclick = toggleGraphExpanded;

    // --- Graph content ---
    clearChildren(graphContent);
    if (gitSidebar.graphExpanded && activeId) {
      const gs = gitStates[activeId] || defaultGitState();
      graphContent.appendChild(renderLog(gs));
    }

    applyGraphHeight();
  }

  function renderProject(project: Project, gs: ProjectGitState, expanded: boolean): HTMLElement {
    const wrap = createElement('div');
    const hasFiles = (gs.status?.files.length ?? 0) > 0;
    const isExpanded = expanded && hasFiles;

    const row = createElement('div', { className: `git-project-row${isExpanded ? ' active' : ''}` });

    if (hasFiles) {
      const arrow = createElement('span', { className: `git-project-arrow${isExpanded ? ' expanded' : ''}` });
      arrow.textContent = '\u25B6';
      row.appendChild(arrow);
    }

    const name = createElement('span', { className: 'git-project-name' });
    name.textContent = project.name;
    row.appendChild(name);

    if (gs.status) {
      const branch = createElement('span', { className: 'git-project-branch' });
      branch.textContent = gs.status.branch;
      row.appendChild(branch);

      if (gs.status.dirty) {
        const dirty = createElement('span', { className: 'git-project-dirty' });
        dirty.textContent = '*';
        row.appendChild(dirty);
      }
    }

    const actions = createElement('div', { className: 'git-project-actions' });
    const refreshBtn = createElement('button', { className: 'git-project-action-btn', title: 'Refresh' });
    refreshBtn.innerHTML = '&#8635;';
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshProject(project);
    });
    actions.appendChild(refreshBtn);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      if (hasFiles) {
        toggleProjectExpanded(project.id);
      }
      setGitSidebarActiveProject(project.id);
      fetchLog(project);
    });

    wrap.appendChild(row);

    if (isExpanded) {
      if (gs.loading) {
        const loading = createElement('div', { className: 'git-sidebar-loading' });
        loading.textContent = 'Loading...';
        wrap.appendChild(loading);
      } else if (gs.error) {
        const err = createElement('div', { className: 'git-sidebar-error' });
        err.textContent = gs.error;
        wrap.appendChild(err);
      } else if (gs.status) {
        // hasFiles is guaranteed true here (isExpanded implies hasFiles)
        wrap.appendChild(renderCommitArea(project, gs));

        const fileList = createElement('div', { className: 'git-file-list' });
        for (const file of gs.status.files) {
          fileList.appendChild(renderFile(file));
        }
        wrap.appendChild(fileList);
      }

      // Show notification inline (doesn't replace commit area)
      if (gs.notification) {
        const notif = createElement('div', { className: `git-sidebar-notification ${gs.notification.type}` });
        notif.textContent = gs.notification.message;
        wrap.appendChild(notif);
      }
    }

    return wrap;
  }

  function renderFile(file: GitFileStatus): HTMLElement {
    const row = createElement('div', { className: 'git-file-row' });

    const statusEl = createElement('span', { className: `git-file-status ${file.status}` });
    statusEl.textContent = STATUS_LETTERS[file.status] ?? '?';
    row.appendChild(statusEl);

    const path = createElement('span', { className: 'git-file-path' });
    path.textContent = file.path;
    path.title = file.path;
    row.appendChild(path);

    return row;
  }

  function renderCommitArea(project: Project, gs: ProjectGitState): HTMLElement {
    const area = createElement('div', { className: 'git-commit-area' });

    const textarea = createElement('textarea', { className: 'git-commit-textarea' }) as HTMLTextAreaElement;
    textarea.placeholder = 'Commit message...';
    textarea.value = localCommitMessages.get(project.id) ?? gs.commitMessage;
    textarea.addEventListener('input', () => {
      localCommitMessages.set(project.id, textarea.value);
    });
    area.appendChild(textarea);

    const buttons = createElement('div', { className: 'git-commit-buttons' });

    const generateBtn = createElement('button', { className: 'git-commit-btn secondary git-generate-btn' });
    generateBtn.textContent = gs.generating ? (gs.generatingLabel || 'Generating...') : 'Generate';
    generateBtn.disabled = gs.generating;
    generateBtn.addEventListener('click', async () => {
      if (gs.generating) return;
      setGenerating(project.id, true, 'Generating...');
      try {
        const diff = await getGitDiff(project.path);
        if (!diff.trim()) {
          localCommitMessages.delete(project.id);
          setCommitMessage(project.id, '');
          return;
        }
        const msg = await generateCommitMessage(diff, (label) => {
          setGenerating(project.id, true, label);
        });
        localCommitMessages.set(project.id, msg);
        setCommitMessage(project.id, msg);
      } catch (err: any) {
        const errorMsg = err?.message || 'Failed to generate commit message';
        logger.error('git', 'Generate commit message failed', errorMsg);
        updateGitState(project.id, { error: errorMsg });
        setTimeout(() => {
          const current = store.getState().gitStates[project.id];
          if (current?.error === errorMsg) updateGitState(project.id, { error: null });
        }, 5000);
      } finally {
        setGenerating(project.id, false);
      }
    });
    buttons.appendChild(generateBtn);

    function addButton(label: string, handler: () => void): void {
      const btn = createElement('button', { className: 'git-commit-btn secondary' });
      btn.textContent = label;
      btn.addEventListener('click', handler);
      buttons.appendChild(btn);
    }

    addButton('Commit', () => doCommit(project, false));
    addButton('Push', () => doPush(project));
    addButton('Commit & Push', () => doCommit(project, true));

    area.appendChild(buttons);
    return area;
  }

  function renderLog(gs: ProjectGitState): HTMLElement {
    const list = createElement('div', { className: 'git-log-list' });

    if (gs.log.length === 0) {
      const empty = createElement('div', { className: 'git-sidebar-empty' });
      empty.textContent = 'No Commits';
      list.appendChild(empty);
      return list;
    }

    for (const entry of gs.log) {
      list.appendChild(renderLogEntry(entry));
    }
    return list;
  }

  function renderLogEntry(entry: GitLogEntry): HTMLElement {
    const el = createElement('div', { className: 'git-log-entry' });

    const msgRow = createElement('div', { className: 'git-log-message' });
    msgRow.textContent = entry.message;
    msgRow.title = entry.message;
    el.appendChild(msgRow);

    const meta = createElement('div', { className: 'git-log-meta' });

    const sha = createElement('span', { className: 'git-log-sha' });
    sha.textContent = entry.id;
    meta.appendChild(sha);

    const author = createElement('span', { className: 'git-log-author' });
    author.textContent = entry.author;
    meta.appendChild(author);

    const time = createElement('span', { className: 'git-log-time' });
    time.textContent = relativeTime(entry.timestamp);
    meta.appendChild(time);

    el.appendChild(meta);

    if (entry.refsList.length > 0) {
      const refs = createElement('div', { className: 'git-log-refs' });
      for (const ref of entry.refsList) {
        const badge = createElement('span', { className: 'git-log-ref' });
        badge.textContent = ref;
        refs.appendChild(badge);
      }
      el.appendChild(refs);
    }

    return el;
  }

  function relativeTime(epochSeconds: number): string {
    const diff = Math.floor(Date.now() / 1000 - epochSeconds);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(epochSeconds * 1000).toLocaleDateString();
  }

  function statusEquals(a: GitStatusResult | null, b: GitStatusResult | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    // Cheap shallow checks first
    if (a.branch !== b.branch || a.dirty !== b.dirty || a.files.length !== b.files.length) return false;
    // Deep check only when shallow matches
    for (let i = 0; i < a.files.length; i++) {
      const fa = a.files[i], fb = b.files[i];
      if (fa.path !== fb.path || fa.status !== fb.status || fa.staged !== fb.staged) return false;
    }
    return true;
  }

  async function refreshProject(project: Project, silent = false): Promise<void> {
    // Skip isGitRepo IPC if we already know the answer
    const existingState = store.getState().gitStates[project.id];
    if (!existingState || existingState.isRepo === null) {
      const repo = await isGitRepo(project.path).catch(() => false);
      if (!repo) {
        updateGitState(project.id, { isRepo: false, loading: false });
        return;
      }
    } else if (existingState.isRepo === false) {
      return;
    }

    if (!silent) {
      updateGitState(project.id, { isRepo: true, loading: true, error: null });
    }
    try {
      const status = await getGitStatus(project.path);
      const existing = store.getState().gitStates[project.id];
      if (existing && statusEquals(existing.status, status)) {
        if (!silent) updateGitState(project.id, { loading: false });
        return;
      }
      updateGitState(project.id, { isRepo: true, status, loading: false });
    } catch (err: any) {
      updateGitState(project.id, { isRepo: true, loading: false, error: err?.message || 'Failed to get status' });
    }
  }

  async function fetchLog(project: Project): Promise<void> {
    try {
      const log = await getGitLog(project.path, 50);
      updateGitState(project.id, { log });
    } catch (err: any) {
      logger.error('git', 'Failed to fetch log', { projectId: project.id, error: err?.message });
    }
  }

  async function refreshAllProjects(silent = false): Promise<void> {
    const projects = store.getState().projects;
    await Promise.all(projects.map((p) => refreshProject(p, silent)));
  }

  async function doCommit(project: Project, push: boolean): Promise<void> {
    const gs = store.getState().gitStates[project.id] || defaultGitState();
    const message = (localCommitMessages.get(project.id) ?? gs.commitMessage).trim();

    if (!message) {
      showNotification(project.id, 'Please enter a commit message.', 'warning');
      return;
    }

    updateGitState(project.id, { loading: true, error: null, notification: null });
    try {
      await gitStageAll(project.path);
      const result = await gitCommit(project.path, message);
      logger.info('git', 'Commit created', { projectId: project.id, commitId: result.commitId });
      localCommitMessages.delete(project.id);
      setCommitMessage(project.id, '');

      if (push) {
        const pushResult = await gitPush(project.path);
        if (!pushResult.success) {
          updateGitState(project.id, { loading: false });
          showNotification(project.id, `Committed, but push failed: ${pushResult.message}`, 'error', 8000);
          await refreshProject(project);
          await fetchLog(project);
          return;
        }
        logger.info('git', 'Push completed', { projectId: project.id });
      }

      await refreshProject(project);
      await fetchLog(project);
    } catch (err: any) {
      updateGitState(project.id, { loading: false });
      showNotification(project.id, err?.message || 'Commit failed', 'error');
    }
  }

  async function doPush(project: Project): Promise<void> {
    const gs = store.getState().gitStates[project.id] || defaultGitState();

    // Warn if there are uncommitted changes
    if (gs.status?.dirty) {
      showNotification(project.id, 'You have uncommitted changes. Commit first, or use Commit & Push.', 'warning');
      return;
    }

    updateGitState(project.id, { loading: true, error: null, notification: null });
    try {
      const pushResult = await gitPush(project.path);
      if (!pushResult.success) {
        updateGitState(project.id, { loading: false });
        showNotification(project.id, `Push failed: ${pushResult.message}`, 'error');
        return;
      }

      const msg = pushResult.message.toLowerCase();
      if (msg.includes('up-to-date') || msg.includes('up to date')) {
        updateGitState(project.id, { loading: false });
        showNotification(project.id, 'Already up-to-date. Nothing to push.', 'info');
      } else {
        logger.info('git', 'Push completed', { projectId: project.id });
        updateGitState(project.id, { loading: false });
        showNotification(project.id, 'Pushed successfully.', 'info');
      }
      await fetchLog(project);
    } catch (err: any) {
      updateGitState(project.id, { loading: false });
      showNotification(project.id, err?.message || 'Push failed', 'error');
    }
  }

  function startPolling(): void {
    stopPolling();
    refreshAllProjects();
    // Fetch commit log for the project shown in the graph panel on startup
    const { gitSidebar, projects } = store.getState();
    const activeId = gitSidebar.activeProjectId || projects[0]?.id;
    const activeProject = activeId ? projects.find((p) => p.id === activeId) : null;
    if (activeProject) fetchLog(activeProject);
    pollTimer = setInterval(() => refreshAllProjects(true), 15000);
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Pause git polling while window is hidden (minimized, different tab, etc.)
  document.addEventListener('visibilitychange', () => {
    const sidebarVisible = store.getState().gitSidebar.visible;
    if (!sidebarVisible) return;
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
    }
  });

  function applyVisibility(visible: boolean): void {
    container.classList.toggle('hidden', !visible);
    if (visible) {
      container.style.width = store.getState().gitSidebar.width + 'px';
      startPolling();
    } else {
      stopPolling();
    }
    onLayoutChange();
  }

  store.select(
    (s) => s.gitSidebar.visible,
    applyVisibility,
  );

  // Apply initial state (store.select only fires on changes, not at registration)
  applyVisibility(store.getState().gitSidebar.visible);

  store.select(
    (s) => s.gitSidebar.width,
    (width) => {
      if (store.getState().gitSidebar.visible) {
        container.style.width = width + 'px';
        onLayoutChange();
      }
    },
  );

  // RAF-debounced render: coalesces multiple rapid state changes into a single DOM rebuild
  function scheduleRender(): void {
    if (!store.getState().gitSidebar.visible) return;
    if (!renderRafId) {
      renderRafId = requestAnimationFrame(() => {
        renderRafId = 0;
        render();
      });
    }
  }
  store.select((s) => s.gitStates, scheduleRender);
  store.select((s) => s.projects, (projects) => {
    // Clean stale commit messages for removed projects
    const ids = new Set(projects.map((p) => p.id));
    for (const key of localCommitMessages.keys()) {
      if (!ids.has(key)) localCommitMessages.delete(key);
    }
    scheduleRender();
  });
  store.select((s) => s.gitSidebar.expandedProjectIds, scheduleRender);
  store.select((s) => s.gitSidebar.graphExpanded, scheduleRender);

  store.select(
    (s) => s.gitSidebar.activeProjectId,
    (activeId) => {
      if (activeId) {
        const project = store.getState().projects.find((p) => p.id === activeId);
        if (project) fetchLog(project);
      }
    },
  );
}
