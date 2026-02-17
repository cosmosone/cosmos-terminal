import { store } from './store';
import { logger } from '../services/logger';
import { saveSettings } from '../services/settings-service';
import { findLeafPaneIds } from '../layout/pane-tree';
import { basename } from '../utils/path';
import type { AppSettings, FileTab, FileBrowserSidebarState, GitSidebarState, PaneNode, Project, ProjectGitState, Session } from './types';

function genId(): string {
  return crypto.randomUUID();
}

// --- Project actions ---

export function addProject(name: string, path: string): Project {
  logger.info('project', 'addProject', { name, path });
  const sessionId = genId();
  const paneId = genId();
  const project: Project = {
    id: genId(),
    name,
    path,
    sessions: [{
      id: sessionId,
      title: 'terminal',
      paneTree: { type: 'leaf', paneId },
      activePaneId: paneId,
      hasActivity: false,
      activityCompleted: false,
      locked: false,
    }],
    activeSessionId: sessionId,
    tabs: [],
    activeTabId: null,
  };
  store.setState((s) => ({
    ...s,
    projects: [...s.projects, project],
    activeProjectId: project.id,
  }));
  return project;
}

export function removeProject(projectId: string): void {
  logger.info('project', 'removeProject', { projectId });

  // Clean up activity timers and OSC tracking for all sessions in this project
  const project = store.getState().projects.find((p) => p.id === projectId);
  if (project) {
    for (const session of project.sessions) {
      cleanupSessionTracking(projectId, session);
    }
  }

  store.setState((s) => {
    const projects = s.projects.filter((p) => p.id !== projectId);
    let activeProjectId = s.activeProjectId;
    if (activeProjectId === projectId) {
      activeProjectId = projects.length > 0 ? projects[projects.length - 1].id : null;
    }
    return { ...s, projects, activeProjectId };
  });
}

export function setActiveProject(projectId: string): void {
  // Record activation timestamp for the project's active session so the
  // resize/repaint burst from showing its terminal is suppressed.
  const project = store.getState().projects.find((p) => p.id === projectId);
  if (project?.activeSessionId) {
    sessionActivatedAt.set(sessionKey(projectId, project.activeSessionId), Date.now());
    // Clear activity indicators on the session the user is about to see
    updateSession(projectId, project.activeSessionId, (s) => ({ ...s, hasActivity: false, activityCompleted: false }));
  }
  store.setState((s) => ({ ...s, activeProjectId: projectId }));
}

// --- Session actions ---

export function getActiveProject(): Project | undefined {
  const s = store.getState();
  return s.projects.find((p) => p.id === s.activeProjectId);
}

export function getActiveSession(): Session | undefined {
  const project = getActiveProject();
  return project?.sessions.find((s) => s.id === project.activeSessionId);
}

function updateProject(projectId: string, updater: (p: Project) => Project): void {
  store.setState((s) => ({
    ...s,
    projects: s.projects.map((p) => (p.id === projectId ? updater(p) : p)),
  }));
}

function updateSession(projectId: string, sessionId: string, updater: (s: Session) => Session): void {
  updateProject(projectId, (p) => ({
    ...p,
    sessions: p.sessions.map((s) => (s.id === sessionId ? updater(s) : s)),
  }));
}

export function addSession(projectId: string, opts?: { title?: string }): Session {
  logger.info('session', 'addSession', { projectId });
  const paneId = genId();
  const session: Session = {
    id: genId(),
    title: opts?.title ?? 'terminal',
    paneTree: { type: 'leaf', paneId },
    activePaneId: paneId,
    hasActivity: false,
    activityCompleted: false,
    locked: false,
  };
  updateProject(projectId, (p) => ({
    ...p,
    sessions: [...p.sessions, session],
    activeSessionId: session.id,
    activeTabId: null,
  }));
  return session;
}

export function removeSession(projectId: string, sessionId: string): void {
  logger.info('session', 'removeSession', { projectId, sessionId });

  // Clean up OSC tracking and timers for all panes in this session
  const session = findSession(projectId, sessionId);
  if (session) {
    cleanupSessionTracking(projectId, session);
  }

  updateProject(projectId, (p) => {
    const sessions = p.sessions.filter((s) => s.id !== sessionId);
    let activeSessionId = p.activeSessionId;
    let activeTabId = p.activeTabId;
    if (activeSessionId === sessionId) {
      if (sessions.length > 0) {
        activeSessionId = sessions[sessions.length - 1].id;
      } else if (p.tabs.length > 0) {
        activeSessionId = null;
        activeTabId = p.tabs[p.tabs.length - 1].id;
      } else {
        activeSessionId = null;
      }
    }
    return { ...p, sessions, activeSessionId, activeTabId };
  });
}

export function setActiveSession(projectId: string, sessionId: string): void {
  // Record activation timestamp so we can suppress false-positive activity
  // from the resize/repaint burst that follows a tab switch.
  sessionActivatedAt.set(sessionKey(projectId, sessionId), Date.now());

  // Clear activity dot, completion tick, and idle timer — user is now looking at this session
  clearActivityTimer(sessionKey(projectId, sessionId));
  updateSession(projectId, sessionId, (s) => ({ ...s, hasActivity: false, activityCompleted: false }));

  updateProject(projectId, (p) => ({
    ...p,
    activeSessionId: sessionId,
    activeTabId: null,
  }));
}

// --- Activity tracking internals ---

const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sessionActivatedAt = new Map<string, number>();
const sessionActivityStart = new Map<string, number>();

const oscBusyPanes = new Set<string>();
const oscCapablePanes = new Set<string>();

// Idle timeout thresholds for activity indicator detection.
// Short bursts (< 30s) use 5s; sustained activity uses 20s to accommodate
// AI agents that pause 10-20s between steps while thinking.
const ACTIVATION_SUPPRESS_MS = 2_000;
const ACTIVITY_IDLE_SHORT_MS = 5_000;
const ACTIVITY_IDLE_LONG_MS = 20_000;
const LONG_ACTIVITY_THRESHOLD_MS = 30_000;

function sessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

function findSession(projectId: string, sessionId: string): Session | undefined {
  return store.getState().projects.find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId);
}

function clearActivityTimer(key: string): void {
  const timer = activityTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    activityTimers.delete(key);
  }
}

function cleanupOscPane(paneId: string): void {
  oscBusyPanes.delete(paneId);
  oscCapablePanes.delete(paneId);
}

/** Release all activity tracking state for a session (timers, OSC sets, timestamps). */
function cleanupSessionTracking(projectId: string, session: Session): void {
  const key = sessionKey(projectId, session.id);
  clearActivityTimer(key);
  sessionActivatedAt.delete(key);
  sessionActivityStart.delete(key);
  for (const paneId of findLeafPaneIds(session.paneTree)) {
    cleanupOscPane(paneId);
  }
}

/** True when the session is the one the user is currently looking at. */
function isVisibleSession(projectId: string, sessionId: string): boolean {
  const state = store.getState();
  if (state.activeProjectId !== projectId) return false;
  const project = state.projects.find((p) => p.id === projectId);
  return project?.activeSessionId === sessionId;
}

/**
 * Transition a session out of the active-activity state.
 * For background sessions, this promotes the dot into a completed checkmark.
 * For the visible session, it simply clears the dot with no checkmark.
 */
function resolveActivity(projectId: string, sessionId: string): void {
  const visible = isVisibleSession(projectId, sessionId);
  updateSession(projectId, sessionId, (s) => ({
    ...s,
    hasActivity: false,
    activityCompleted: visible ? s.activityCompleted : true,
  }));
}

// --- Activity tracking actions ---

/** Pick the idle timeout based on how long the current activity burst has lasted. */
function getIdleTimeout(burstStartMs: number, now: number): number {
  const duration = now - burstStartMs;
  return duration > LONG_ACTIVITY_THRESHOLD_MS ? ACTIVITY_IDLE_LONG_MS : ACTIVITY_IDLE_SHORT_MS;
}

export function markSessionActivity(projectId: string, sessionId: string, paneId?: string): void {
  const session = findSession(projectId, sessionId);
  if (!session) return;

  // If this pane has OSC support, skip the volume heuristic -- OSC signals drive state
  if (paneId && oscCapablePanes.has(paneId)) return;

  // Skip the visible session -- no dot needed, and this also filters
  // false positives from resize/redraw output on the active terminal.
  if (isVisibleSession(projectId, sessionId)) return;

  // Suppress activity from the resize/repaint burst after a tab switch
  const key = sessionKey(projectId, sessionId);
  const now = Date.now();
  const activatedAt = sessionActivatedAt.get(key);
  if (activatedAt && now - activatedAt < ACTIVATION_SUPPRESS_MS) return;

  if (!session.hasActivity) {
    updateSession(projectId, sessionId, (s) => ({ ...s, hasActivity: true, activityCompleted: false }));
    sessionActivityStart.set(key, now);
  }

  // Reset idle timer -- when output stops, clear the activity dot
  const burstStart = sessionActivityStart.get(key) ?? now;
  const idleMs = getIdleTimeout(burstStart, now);

  clearActivityTimer(key);
  activityTimers.set(key, setTimeout(() => {
    activityTimers.delete(key);
    sessionActivityStart.delete(key);
    clearSessionActivity(projectId, sessionId);
  }, idleMs));
}

export function markPaneOscBusy(projectId: string, sessionId: string, paneId: string): void {
  oscBusyPanes.add(paneId);
  oscCapablePanes.add(paneId);

  // Cancel any pending idle timer -- OSC is driving state now
  clearActivityTimer(sessionKey(projectId, sessionId));

  // Skip the visible session -- no dot needed for the tab you're looking at
  if (isVisibleSession(projectId, sessionId)) return;

  const session = findSession(projectId, sessionId);
  if (session && !session.hasActivity) {
    updateSession(projectId, sessionId, (s) => ({ ...s, hasActivity: true, activityCompleted: false }));
  }
}

export function markPaneOscIdle(projectId: string, sessionId: string, paneId: string): void {
  oscBusyPanes.delete(paneId);

  // Check if any other pane in this session is still busy
  const session = findSession(projectId, sessionId);
  if (!session) return;

  const anyStillBusy = findLeafPaneIds(session.paneTree).some((id) => oscBusyPanes.has(id));
  if (!anyStillBusy && session.hasActivity) {
    resolveActivity(projectId, sessionId);
  }
}

export function clearSessionActivity(projectId: string, sessionId: string): void {
  const session = findSession(projectId, sessionId);
  if (!session?.hasActivity) return;
  resolveActivity(projectId, sessionId);
}

export function renameProject(projectId: string, name: string): void {
  logger.info('project', 'renameProject', { projectId, name });
  store.setState((s) => ({
    ...s,
    projects: s.projects.map((p) => (p.id === projectId ? { ...p, name } : p)),
  }));
}

export function updateProjectCwd(projectId: string, cwd: string): void {
  const project = store.getState().projects.find((p) => p.id === projectId);
  if (project?.path.toLowerCase() === cwd.toLowerCase()) return;

  const name = basename(cwd, 'Project');
  updateProject(projectId, (p) => ({ ...p, name, path: cwd }));
}

export function renameSession(projectId: string, sessionId: string, title: string): void {
  logger.info('session', 'renameSession', { projectId, sessionId, title });
  updateSession(projectId, sessionId, (s) => ({ ...s, title }));
}

// --- Pane actions ---

export function setPaneTree(projectId: string, sessionId: string, tree: PaneNode): void {
  logger.debug('layout', 'setPaneTree', { projectId, sessionId, treeType: tree.type });
  updateSession(projectId, sessionId, (s) => ({ ...s, paneTree: tree }));
}

export function splitPane(
  projectId: string,
  sessionId: string,
  targetPaneId: string,
  direction: 'horizontal' | 'vertical',
  before: boolean = false,
): void {
  const newPaneId = genId();
  logger.info('layout', 'splitPane', { projectId, sessionId, targetPaneId, newPaneId, direction, before });
  updateSession(projectId, sessionId, (s) => ({
    ...s,
    paneTree: splitNode(s.paneTree, targetPaneId, newPaneId, direction, before),
    activePaneId: newPaneId,
  }));
}

export function removePane(projectId: string, sessionId: string, paneId: string): void {
  logger.info('layout', 'removePane', { projectId, sessionId, paneId });
  cleanupOscPane(paneId);
  updateSession(projectId, sessionId, (s) => {
    const newTree = removePaneFromTree(s.paneTree, paneId);
    if (!newTree) {
      const freshPaneId = genId();
      return { ...s, paneTree: { type: 'leaf', paneId: freshPaneId }, activePaneId: freshPaneId };
    }
    let activePaneId = s.activePaneId;
    if (activePaneId === paneId) {
      const remaining = findLeafPaneIds(newTree);
      activePaneId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
    return { ...s, paneTree: newTree, activePaneId };
  });
}

export function setActivePaneId(projectId: string, sessionId: string, paneId: string): void {
  updateSession(projectId, sessionId, (s) => ({ ...s, activePaneId: paneId }));
}

function splitNode(
  node: PaneNode,
  targetPaneId: string,
  newPaneId: string,
  direction: 'horizontal' | 'vertical',
  before: boolean,
): PaneNode {
  if (node.type === 'leaf') {
    if (node.paneId === targetPaneId) {
      const existing: PaneNode = { type: 'leaf', paneId: targetPaneId };
      const added: PaneNode = { type: 'leaf', paneId: newPaneId };
      return {
        type: 'branch',
        direction,
        children: before ? [added, existing] : [existing, added],
        ratios: [0.5, 0.5],
      };
    }
    return node;
  }
  return {
    ...node,
    children: node.children.map((c) => splitNode(c, targetPaneId, newPaneId, direction, before)),
  };
}

function removePaneFromTree(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? null : node;
  }
  const results: { node: PaneNode; ratio: number }[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = removePaneFromTree(node.children[i], paneId);
    if (child) results.push({ node: child, ratio: node.ratios[i] });
  }
  if (results.length === 0) return null;
  if (results.length === 1) return results[0].node;
  // Normalize proportionally so ratios sum to exactly 1.0
  const totalRatio = results.reduce((sum, r) => sum + r.ratio, 0);
  const newRatios = results.map((r) => r.ratio / totalRatio);
  const sum = newRatios.slice(0, -1).reduce((a, b) => a + b, 0);
  newRatios[newRatios.length - 1] = 1.0 - sum;
  return { ...node, children: results.map((r) => r.node), ratios: newRatios };
}

// --- Tab cycling actions ---

export function cycleSession(projectId: string, direction: 1 | -1): void {
  const project = store.getState().projects.find((p) => p.id === projectId);
  if (!project || !project.activeSessionId || project.sessions.length < 2) return;
  const idx = project.sessions.findIndex((s) => s.id === project.activeSessionId);
  const newIdx = (idx + direction + project.sessions.length) % project.sessions.length;
  logger.debug('session', 'cycleSession', { projectId, direction, from: idx, to: newIdx });
  setActiveSession(projectId, project.sessions[newIdx].id);
}

export function reorderProject(projectId: string, newIndex: number): void {
  store.setState((s) => {
    const oldIndex = s.projects.findIndex((p) => p.id === projectId);
    if (oldIndex === -1 || oldIndex === newIndex) return s;
    const projects = [...s.projects];
    const [moved] = projects.splice(oldIndex, 1);
    projects.splice(newIndex, 0, moved);
    return { ...s, projects };
  });
}

export function cycleProject(direction: 1 | -1): void {
  const state = store.getState();
  if (!state.activeProjectId || state.projects.length < 2) return;
  const idx = state.projects.findIndex((p) => p.id === state.activeProjectId);
  const newIdx = (idx + direction + state.projects.length) % state.projects.length;
  logger.debug('project', 'cycleProject', { direction, from: idx, to: newIdx });
  setActiveProject(state.projects[newIdx].id);
}

// --- Settings actions ---

export function updateSettings(partial: Partial<AppSettings>): void {
  logger.debug('settings', 'updateSettings', partial);
  store.setState((s) => ({
    ...s,
    settings: { ...s.settings, ...partial },
  }));
}

export function toggleDebugLogging(): void {
  const enabling = !store.getState().settings.debugLogging;
  if (enabling) {
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    updateSettings({ debugLogging: true, debugLoggingExpiry: expiry });
    logger.enable();
  } else {
    updateSettings({ debugLogging: false, debugLoggingExpiry: null });
    logger.disable();
  }
  saveSettings(store.getState().settings);
}

// --- View actions ---

function setView(view: 'terminal' | 'settings'): void {
  store.setState((s) => ({ ...s, view }));
}

export function toggleSettingsView(): void {
  const s = store.getState();
  setView(s.view === 'settings' ? 'terminal' : 'settings');
}

// --- Git sidebar actions ---

function updateGitSidebar(updater: (sidebar: GitSidebarState) => Partial<GitSidebarState>): void {
  store.setState((s) => ({
    ...s,
    gitSidebar: { ...s.gitSidebar, ...updater(s.gitSidebar) },
  }));
}

export function toggleGitSidebar(): void {
  const opening = !store.getState().gitSidebar.visible;
  if (opening) {
    // Close file browser sidebar (mutual exclusion)
    store.setState((s) => ({
      ...s,
      fileBrowserSidebar: { ...s.fileBrowserSidebar, visible: false },
    }));
  }
  updateGitSidebar((sb) => ({ visible: !sb.visible }));
}

export function setGitSidebarWidth(width: number): void {
  updateGitSidebar(() => ({ width: Math.max(250, Math.min(600, width)) }));
}

export function toggleProjectExpanded(projectId: string): void {
  updateGitSidebar((sb) => {
    const ids = sb.expandedProjectIds;
    return {
      expandedProjectIds: ids.includes(projectId)
        ? ids.filter((id) => id !== projectId)
        : [...ids, projectId],
    };
  });
}

export function collapseAllProjects(): void {
  updateGitSidebar(() => ({ expandedProjectIds: [] }));
}

export function expandAllProjects(): void {
  const projects = store.getState().projects;
  updateGitSidebar(() => ({ expandedProjectIds: projects.map((p) => p.id) }));
}

export function setGitSidebarActiveProject(projectId: string | null): void {
  updateGitSidebar(() => ({ activeProjectId: projectId }));
}

export function toggleGraphExpanded(): void {
  updateGitSidebar((sb) => ({ graphExpanded: !sb.graphExpanded }));
}

export function updateGitState(projectId: string, partial: Partial<ProjectGitState>): void {
  store.setState((s) => ({
    ...s,
    gitStates: {
      ...s.gitStates,
      [projectId]: { ...defaultGitState(), ...s.gitStates[projectId], ...partial },
    },
  }));
}

export function setCommitMessage(projectId: string, message: string): void {
  updateGitState(projectId, { commitMessage: message });
}

export function setGenerating(projectId: string, generating: boolean, label?: string): void {
  updateGitState(projectId, { generating, generatingLabel: label ?? '' });
}

export function defaultGitState(): ProjectGitState {
  return {
    isRepo: null,
    status: null,
    log: [],
    loading: false,
    error: null,
    commitMessage: '',
    generating: false,
    generatingLabel: '',
    notification: null,
  };
}

export function defaultGitSidebarState(): GitSidebarState {
  return {
    visible: false,
    width: 350,
    expandedProjectIds: [],
    activeProjectId: null,
    graphExpanded: true,
  };
}

// --- File browser sidebar actions ---

function updateFileBrowserSidebar(updater: (sidebar: FileBrowserSidebarState) => Partial<FileBrowserSidebarState>): void {
  store.setState((s) => ({
    ...s,
    fileBrowserSidebar: { ...s.fileBrowserSidebar, ...updater(s.fileBrowserSidebar) },
  }));
}

export function defaultFileBrowserSidebarState(): FileBrowserSidebarState {
  return {
    visible: false,
    width: 280,
    expandedPaths: [],
  };
}

export function toggleFileBrowserSidebar(): void {
  const opening = !store.getState().fileBrowserSidebar.visible;
  if (opening) {
    // Close git sidebar (mutual exclusion)
    updateGitSidebar(() => ({ visible: false }));
  }
  updateFileBrowserSidebar((sb) => ({ visible: !sb.visible }));
}

export function setFileBrowserSidebarWidth(width: number): void {
  updateFileBrowserSidebar(() => ({ width: Math.max(200, Math.min(500, width)) }));
}

export function toggleFileBrowserPath(path: string): void {
  updateFileBrowserSidebar((sb) => {
    const paths = sb.expandedPaths;
    return {
      expandedPaths: paths.includes(path)
        ? paths.filter((p) => p !== path)
        : [...paths, path],
    };
  });
}

// --- Content tab actions ---

export function addFileTab(projectId: string, filePath: string, fileType: string): void {
  const project = store.getState().projects.find((p) => p.id === projectId);
  const existing = project?.tabs.find((t) => t.filePath === filePath);
  if (existing) {
    setActiveTab(projectId, existing.id);
    return;
  }

  const tab: FileTab = {
    id: genId(),
    title: basename(filePath, 'File'),
    filePath,
    fileType,
    editing: false,
    dirty: false,
    locked: false,
  };
  updateProject(projectId, (p) => ({
    ...p,
    tabs: [...p.tabs, tab],
    activeTabId: tab.id,
    activeSessionId: null,
  }));
}

export function removeContentTab(projectId: string, tabId: string): void {
  updateProject(projectId, (p) => {
    const tabs = p.tabs.filter((t) => t.id !== tabId);
    let activeTabId = p.activeTabId;
    if (activeTabId === tabId) {
      if (tabs.length > 0) {
        activeTabId = tabs[tabs.length - 1].id;
      } else {
        activeTabId = null;
        // Fall back to last terminal session
        return {
          ...p,
          tabs,
          activeTabId: null,
          activeSessionId: p.sessions.length > 0 ? p.sessions[p.sessions.length - 1].id : null,
        };
      }
    }
    return { ...p, tabs, activeTabId };
  });
}

export function setActiveTab(projectId: string, tabId: string): void {
  updateProject(projectId, (p) => ({
    ...p,
    activeTabId: tabId,
    activeSessionId: null,
  }));
}

export function setFileTabEditing(projectId: string, tabId: string, editing: boolean): void {
  updateProject(projectId, (p) => ({
    ...p,
    tabs: p.tabs.map((t) =>
      t.id === tabId ? { ...t, editing } : t,
    ),
  }));
}

export function setFileTabDirty(projectId: string, tabId: string, dirty: boolean): void {
  updateProject(projectId, (p) => ({
    ...p,
    tabs: p.tabs.map((t) =>
      t.id === tabId ? { ...t, dirty } : t,
    ),
  }));
}

export function closeOtherTabs(projectId: string, keepTabId: string, keepType: 'session' | 'content'): void {
  updateProject(projectId, (p) => {
    if (keepType === 'session') {
      const sessions = p.sessions.filter((s) => s.id === keepTabId || s.locked);
      const tabs = p.tabs.filter((t) => t.locked);
      return {
        ...p,
        sessions,
        activeSessionId: keepTabId,
        tabs,
        activeTabId: null,
      };
    } else {
      const sessions = p.sessions.filter((s) => s.locked);
      const tabs = p.tabs.filter((t) => t.id === keepTabId || t.locked);
      return {
        ...p,
        sessions,
        activeSessionId: sessions.length > 0 ? sessions[0].id : null,
        tabs,
        activeTabId: keepTabId,
      };
    }
  });
}

export function toggleSessionLocked(projectId: string, sessionId: string): void {
  updateSession(projectId, sessionId, (s) => ({ ...s, locked: !s.locked }));
}

export function toggleFileTabLocked(projectId: string, tabId: string): void {
  updateProject(projectId, (p) => ({
    ...p,
    tabs: p.tabs.map((t) =>
      t.id === tabId ? { ...t, locked: !t.locked } : t,
    ),
  }));
}
