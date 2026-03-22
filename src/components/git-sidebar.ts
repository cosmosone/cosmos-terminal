import { store } from '../state/store';
import {
  toggleGitSidebar,
  setGitSidebarWidth,
  toggleProjectExpanded,
  collapseAllProjects,
  expandAllProjects,
  setGitSidebarActiveProject,
  toggleGraphExpanded,
  defaultGitState,
} from '../state/actions';
import { createElement, clearChildren, $ } from '../utils/dom';
import { setupSidebarResize } from '../utils/sidebar-resize';
import { renderLog, renderProject, pruneRenderState, type GitSidebarRenderHandlers } from './git-sidebar/render';
import { createGitSidebarNotificationManager } from './git-sidebar/notification-manager';
import { createGitSidebarOperations } from './git-sidebar/operations';
import type { ProjectGitState, GitLogEntry } from '../state/types';

export function initGitSidebar(onLayoutChange: () => void): void {
  const container = $('#git-sidebar-container')! as HTMLElement;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let graphHeight = 200;
  let renderRafId = 0;

  // Local commit message buffer avoids store updates (and full re-renders) on every keystroke.
  const localCommitMessages = new Map<string, string>();
  const notifications = createGitSidebarNotificationManager();
  const operations = createGitSidebarOperations({
    localCommitMessages,
    showNotification: notifications.showNotification,
  });

  // Disable browser default context menu inside the sidebar.
  container.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- Left-edge resize handle (sidebar width) ---
  const resizeHandle = createElement('div', { className: 'git-sidebar-resize' });
  container.appendChild(resizeHandle);
  setupSidebarResize(resizeHandle, setGitSidebarWidth, () => container.offsetWidth);

  // --- Header ---
  const header = createElement('div', { className: 'git-sidebar-header' });
  const headerTitle = createElement('span', { className: 'git-sidebar-header-title' });
  headerTitle.textContent = 'Source Control';
  const headerActions = createElement('div', { className: 'git-sidebar-header-actions' });

  function addHeaderButton(title: string, svgPaths: string, handler: () => void): void {
    const btn = createElement('button', { className: 'git-sidebar-header-btn', title });
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPaths}</svg>`;
    btn.addEventListener('click', handler);
    headerActions.appendChild(btn);
  }

  addHeaderButton('Collapse All', '<polyline points="7 3 12 8 17 3"/><polyline points="7 21 12 16 17 21"/>', collapseAllProjects);
  addHeaderButton('Expand All', '<polyline points="7 8 12 3 17 8"/><polyline points="7 16 12 21 17 16"/>', expandAllProjects);
  addHeaderButton('Collapse Sidebar', '<polyline points="9 18 15 12 9 6"/>', toggleGitSidebar);
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
  graphDivider.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    const graphStartY = e.clientY;
    const graphStartHeight = graphHeight;
    graphDivider.classList.add('active');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (me: MouseEvent) => {
      const delta = graphStartY - me.clientY;
      graphHeight = Math.max(80, Math.min(600, graphStartHeight + delta));
      applyGraphHeight();
    };

    const onUp = () => {
      graphDivider.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  function applyGraphHeight(): void {
    const expanded = store.getState().gitSidebar.graphExpanded;
    graphPanel.style.height = expanded ? graphHeight + 'px' : 'auto';
    graphDivider.classList.toggle('collapsed', !expanded);
    graphContent.style.display = expanded ? '' : 'none';
  }

  const renderHandlers: GitSidebarRenderHandlers = {
    onProjectRowClick: (project, canExpand) => {
      if (canExpand) {
        toggleProjectExpanded(project.id);
      }
      setGitSidebarActiveProject(project.id);
      void operations.refreshProject(project, true);
    },
    onGenerateCommitMessage: (project) => operations.generateCommitMessage(project),
    onCommit: (project, push) => operations.doCommit(project, push),
    onPush: (project) => operations.doPush(project),
  };

  const projectRenderDeps = {
    localCommitMessages,
    handlers: renderHandlers,
  };

  // Track rendered project sections for incremental DOM updates.
  // Only projects whose state actually changed get their DOM rebuilt.
  const renderedProjects = new Map<string, {
    element: HTMLElement;
    gs: ProjectGitState;
    expanded: boolean;
    projectName: string;
  }>();

  let lastGraphActiveId: string | undefined;
  let lastGraphExpanded = false;
  let lastGraphLog: GitLogEntry[] = [];
  let lastGraphActiveProjectName: string | undefined;

  // Compares all ProjectGitState fields that affect project-section rendering.
  // Excludes generating/generatingLabel (handled by patchGenerateButtons)
  // and log (rendered in graph section, not project sections).
  function gitStateRenderFieldsChanged(p: ProjectGitState, c: ProjectGitState): boolean {
    return (
      p.isRepo !== c.isRepo ||
      p.loading !== c.loading ||
      p.loadingLabel !== c.loadingLabel ||
      p.error !== c.error ||
      p.status !== c.status ||
      p.commitMessage !== c.commitMessage ||
      p.notification !== c.notification
    );
  }

  function projectNeedsRerender(
    rp: { gs: ProjectGitState; expanded: boolean; projectName: string },
    gs: ProjectGitState,
    expanded: boolean,
    projectName: string,
  ): boolean {
    if (rp.expanded !== expanded || rp.projectName !== projectName) return true;
    return gitStateRenderFieldsChanged(rp.gs, gs);
  }

  // --- Render ---
  function render(): void {
    const state = store.getState();
    const { projects, gitSidebar, gitStates } = state;

    // --- Changes panel: incremental DOM update ---
    const gitProjects = projects.filter((p) => {
      const gs = gitStates[p.id];
      return !gs || gs.isRepo !== false;
    });

    const visibleIds = new Set(gitProjects.map((p) => p.id));
    const expandedIds = new Set(gitSidebar.expandedProjectIds);

    // Remove stale project elements
    for (const [id, rp] of renderedProjects) {
      if (!visibleIds.has(id)) {
        rp.element.remove();
        renderedProjects.delete(id);
      }
    }

    // Update only projects whose state actually changed
    const mountCallbacks: (() => void)[] = [];
    for (const project of gitProjects) {
      const gs = gitStates[project.id] || defaultGitState();
      const expanded = expandedIds.has(project.id);
      const existing = renderedProjects.get(project.id);

      if (existing && !projectNeedsRerender(existing, gs, expanded, project.name)) {
        continue;
      }

      const { element: newElement, onMount } = renderProject(project, gs, expanded, projectRenderDeps);

      if (existing) {
        existing.element.replaceWith(newElement);
        existing.element = newElement;
        existing.gs = gs;
        existing.expanded = expanded;
        existing.projectName = project.name;
      } else {
        renderedProjects.set(project.id, { element: newElement, gs, expanded, projectName: project.name });
      }

      if (onMount) mountCallbacks.push(onMount);
    }

    // Reconcile DOM order — appendChild moves existing nodes without recreating.
    // Only needed when the child list doesn't match the expected project order.
    const children = changesContent.children;
    let orderCorrect = children.length === gitProjects.length;
    if (orderCorrect) {
      for (let i = 0; i < gitProjects.length; i++) {
        if (children[i] !== renderedProjects.get(gitProjects[i].id)!.element) {
          orderCorrect = false;
          break;
        }
      }
    }
    if (!orderCorrect) {
      for (const project of gitProjects) {
        changesContent.appendChild(renderedProjects.get(project.id)!.element);
      }
    }

    // Synchronously auto-size commit textareas now that elements are in the
    // DOM.  This avoids a 1-frame flash caused by deferring via RAF.
    for (const cb of mountCallbacks) cb();

    // --- Graph section ---
    const activeId = gitSidebar.activeProjectId || gitProjects[0]?.id;
    const activeProject = activeId ? projects.find((p) => p.id === activeId) : null;
    const activeProjectName = activeProject?.name;
    const graphExpanded = gitSidebar.graphExpanded;
    const activeLog = activeId ? (gitStates[activeId] || defaultGitState()).log : [];

    const graphHeaderChanged =
      activeId !== lastGraphActiveId ||
      graphExpanded !== lastGraphExpanded ||
      activeProjectName !== lastGraphActiveProjectName;

    if (graphHeaderChanged) {
      clearChildren(graphHeaderEl);
      const graphArrow = createElement('span', { className: `git-section-arrow${graphExpanded ? ' expanded' : ''}` });
      graphArrow.textContent = '\u25B6';
      const graphLabel = createElement('span');
      graphLabel.textContent = activeProject
        ? `Commit History [${activeProject.name}]`
        : 'Commit History';
      graphHeaderEl.appendChild(graphArrow);
      graphHeaderEl.appendChild(graphLabel);
      graphHeaderEl.onclick = toggleGraphExpanded;
    }

    if (graphHeaderChanged || (graphExpanded && activeLog !== lastGraphLog)) {
      clearChildren(graphContent);
      if (graphExpanded && activeId) {
        const gs = gitStates[activeId] || defaultGitState();
        graphContent.appendChild(renderLog(gs));
      }
    }

    lastGraphActiveId = activeId;
    lastGraphExpanded = graphExpanded;
    lastGraphLog = activeLog;
    lastGraphActiveProjectName = activeProjectName;

    applyGraphHeight();
  }

  function startPolling(): void {
    stopPolling();
    void operations.refreshAllProjects();
    // Fetch commit log for the project shown in the graph panel on startup
    const { gitSidebar, projects } = store.getState();
    const activeId = gitSidebar.activeProjectId || projects[0]?.id;
    const activeProject = activeId ? projects.find((p) => p.id === activeId) : null;
    if (activeProject) void operations.fetchLog(activeProject);
    pollTimer = setInterval(() => {
      void operations.refreshAllProjects(true);
    }, 15000);
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
  // Track gitStates to distinguish generating-only changes (which only need a
  // lightweight button-text patch) from structural changes that require a full
  // DOM rebuild.  This prevents the "Changes" section from flashing on every
  // progress-label update during AI commit-message generation.
  let lastGitStates: Record<string, ProjectGitState> = {};

  function hasNonGeneratingChanges(
    prev: Record<string, ProjectGitState>,
    curr: Record<string, ProjectGitState>,
  ): boolean {
    const prevIds = Object.keys(prev);
    const currIds = Object.keys(curr);
    if (prevIds.length !== currIds.length) return true;
    for (const id of currIds) {
      const p = prev[id];
      const c = curr[id];
      if (!p) return true;
      if (gitStateRenderFieldsChanged(p, c) || p.log !== c.log) return true;
    }
    return false;
  }

  function patchGenerateButtons(): void {
    const gitStates = store.getState().gitStates;
    for (const btn of changesContent.querySelectorAll<HTMLButtonElement>('.git-generate-btn')) {
      const projectId = btn.dataset.projectId;
      if (!projectId) continue;
      const gs = gitStates[projectId];
      if (!gs) continue;
      btn.textContent = gs.generating ? (gs.generatingLabel || 'Generating...') : 'Generate';
      btn.disabled = gs.generating || gs.loading;
    }
  }

  store.select(
    (s) => s.gitStates,
    (gitStates) => {
      patchGenerateButtons();
      if (hasNonGeneratingChanges(lastGitStates, gitStates)) {
        lastGitStates = gitStates;
        scheduleRender();
      }
    },
  );
  store.select((s) => s.projects, (projects) => {
    const ids = new Set(projects.map((p) => p.id));
    operations.pruneLocalCommitMessages(ids);
    notifications.pruneTimers(ids);
    pruneRenderState(ids);
    scheduleRender();
  });
  store.select((s) => s.gitSidebar.expandedProjectIds, scheduleRender);
  store.select((s) => s.gitSidebar.graphExpanded, scheduleRender);

  store.select(
    (s) => s.gitSidebar.activeProjectId,
    (activeId) => {
      scheduleRender();
      if (activeId) {
        const project = store.getState().projects.find((p) => p.id === activeId);
        if (project) void operations.fetchLog(project);
      }
    },
  );
}
