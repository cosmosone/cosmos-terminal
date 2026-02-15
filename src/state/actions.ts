import { store } from './store';
import { logger } from '../services/logger';
import { saveSettings } from '../services/settings-service';
import { findLeafPaneIds } from '../layout/pane-tree';
import type { AppSettings, GitSidebarState, PaneNode, Project, ProjectGitState, Session } from './types';

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
      title: 'terminal 1',
      paneTree: { type: 'leaf', paneId },
      activePaneId: paneId,
    }],
    activeSessionId: sessionId,
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

export function addSession(projectId: string): Session {
  logger.info('session', 'addSession', { projectId });
  const project = store.getState().projects.find((p) => p.id === projectId);
  const num = (project?.sessions.length ?? 0) + 1;
  const paneId = genId();
  const session: Session = {
    id: genId(),
    title: `terminal ${num}`,
    paneTree: { type: 'leaf', paneId },
    activePaneId: paneId,
  };
  updateProject(projectId, (p) => ({
    ...p,
    sessions: [...p.sessions, session],
    activeSessionId: session.id,
  }));
  return session;
}

export function removeSession(projectId: string, sessionId: string): void {
  logger.info('session', 'removeSession', { projectId, sessionId });
  updateProject(projectId, (p) => {
    const sessions = p.sessions.filter((s) => s.id !== sessionId);
    let activeSessionId = p.activeSessionId;
    if (activeSessionId === sessionId) {
      activeSessionId = sessions.length > 0 ? sessions[sessions.length - 1].id : null;
    }
    return { ...p, sessions, activeSessionId };
  });
}

export function setActiveSession(projectId: string, sessionId: string): void {
  updateProject(projectId, (p) => ({ ...p, activeSessionId: sessionId }));
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

  const name = cwd.split(/[/\\]/).filter(Boolean).pop() || 'Project';
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

export function setView(view: 'terminal' | 'settings'): void {
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
