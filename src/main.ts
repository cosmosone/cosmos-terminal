import '@xterm/xterm/css/xterm.css';
import { initStore, store } from './state/store';
import { addProject, addSession, getActiveProject, getActiveSession, removeSession, splitPane, cycleSession, cycleProject, toggleSettingsView, toggleGitSidebar, defaultGitSidebarState } from './state/actions';
import { loadSettings, saveSettings } from './services/settings-service';
import { loadWorkspace, saveWorkspace } from './services/workspace-service';
import { findLeafPaneIds } from './layout/pane-tree';
import type { AppState, KeybindingConfig } from './state/types';
import { logger } from './services/logger';
import { initProjectTabBar } from './components/project-tab-bar';
import { initSessionTabBar } from './components/session-tab-bar';
import { SplitContainer } from './components/split-container';
import { initSettingsPage } from './components/settings-page';
import { initStatusBar } from './components/status-bar';
import { initLogViewer } from './components/log-viewer';
import { initGitSidebar } from './components/git-sidebar';
import { keybindings, parseKeybinding } from './utils/keybindings';
import { $ } from './utils/dom';
import { debounce } from './utils/debounce';

async function main(): Promise<void> {
  const settings = await loadSettings();

  // Check 24h auto-disable for debug logging
  if (settings.debugLogging && settings.debugLoggingExpiry) {
    if (new Date(settings.debugLoggingExpiry).getTime() <= Date.now()) {
      settings.debugLogging = false;
      settings.debugLoggingExpiry = null;
      saveSettings(settings);
    }
  }
  if (settings.debugLogging) {
    logger.enable();
  }

  logger.info('app', 'App starting', { settingsLoaded: true });

  const saved = await loadWorkspace();

  initStore({
    projects: saved?.projects ?? [],
    activeProjectId: saved?.activeProjectId ?? null,
    settings,
    view: 'terminal',
    gitSidebar: saved?.gitSidebar ?? defaultGitSidebarState(),
    gitStates: {},
  });

  logger.debug('app', 'Store initialized', { restored: !!saved });

  const terminalContainer = $('#terminal-container')! as HTMLElement;
  const splitContainer = new SplitContainer(terminalContainer);
  const refresh = () => splitContainer.render();

  initProjectTabBar(refresh);
  initSessionTabBar(refresh);
  initSettingsPage(() => splitContainer.applySettings());
  initStatusBar(() => splitContainer.clearAllScrollback());
  initLogViewer();
  initGitSidebar(() => splitContainer.reLayout());

  logger.debug('app', 'All components initialized');

  if (!saved) {
    const defaultPath = await getDefaultProjectPath();
    const defaultName = defaultPath.split(/[/\\]/).filter(Boolean).pop() || 'Project';
    addProject(defaultName, defaultPath);
    logger.info('app', 'Default project created', { path: defaultPath });
  } else {
    logger.info('app', 'Workspace restored', { projectCount: saved.projects.length });
  }

  await splitContainer.render();

  // Persist workspace state on changes (debounced)
  const debouncedSave = debounce(() => {
    const s = store.getState();
    saveWorkspace(s.projects, s.activeProjectId, s.gitSidebar);
  }, 1000);

  for (const selector of [
    (s: AppState) => s.projects,
    (s: AppState) => s.activeProjectId,
    (s: AppState) => s.gitSidebar,
  ]) {
    store.select(selector, () => debouncedSave());
  }

  window.addEventListener(
    'resize',
    debounce(() => {
      logger.debug('layout', 'Window resized, re-laying out');
      splitContainer.reLayout();
    }, 16),
  );

  keybindings.register({
    key: 't',
    ctrl: true,
    shift: true,
    handler: () => {
      const project = getActiveProject();
      if (project) {
        logger.info('session', 'New session via Ctrl+Shift+T', { projectId: project.id });
        addSession(project.id);
        refresh();
      }
    },
  });

  keybindings.register({
    key: 'w',
    ctrl: true,
    shift: true,
    handler: () => {
      const project = getActiveProject();
      if (project?.activeSessionId && project.sessions.length > 1) {
        logger.info('session', 'Close session via Ctrl+Shift+W', { sessionId: project.activeSessionId });
        removeSession(project.id, project.activeSessionId);
        refresh();
      }
    },
  });

  keybindings.register({
    key: ',',
    ctrl: true,
    handler: toggleSettingsView,
  });

  keybindings.register({
    key: 'g',
    ctrl: true,
    shift: true,
    handler: toggleGitSidebar,
  });

  // --- Configurable keybindings ---
  let cleanupConfigBindings: (() => void)[] = [];

  function registerConfigurableBindings(kb: KeybindingConfig): void {
    for (const fn of cleanupConfigBindings) fn();
    cleanupConfigBindings = [];

    const bind = (combo: string, handler: () => void) => {
      const parsed = parseKeybinding(combo);
      if (!parsed) return;
      const unsub = keybindings.register({ ...parsed, handler });
      cleanupConfigBindings.push(unsub);
    };

    bind(kb.navigatePaneLeft, () => splitContainer.navigatePane('left'));
    bind(kb.navigatePaneRight, () => splitContainer.navigatePane('right'));
    bind(kb.navigatePaneUp, () => splitContainer.navigatePane('up'));
    bind(kb.navigatePaneDown, () => splitContainer.navigatePane('down'));

    function doSplit(direction: 'horizontal' | 'vertical', before: boolean = false): void {
      const project = getActiveProject();
      const session = getActiveSession();
      if (!project || !session) return;
      const target = session.activePaneId ?? findLeafPaneIds(session.paneTree)[0];
      if (target) {
        splitPane(project.id, session.id, target, direction, before);
        refresh();
      }
    }

    bind(kb.splitDown, () => doSplit('vertical'));
    bind(kb.splitUp, () => doSplit('vertical', true));
    bind(kb.splitLeft, () => doSplit('horizontal', true));
    bind(kb.splitRight, () => doSplit('horizontal'));

    function doCycleSession(direction: 1 | -1): void {
      const project = getActiveProject();
      if (project) { cycleSession(project.id, direction); refresh(); }
    }

    bind(kb.cycleSessionNext, () => doCycleSession(1));
    bind(kb.cycleSessionPrev, () => doCycleSession(-1));
    bind(kb.cycleProjectNext, () => { cycleProject(1); refresh(); });
    bind(kb.cycleProjectPrev, () => { cycleProject(-1); refresh(); });
  }

  registerConfigurableBindings(settings.keybindings);

  store.select(
    (s) => s.settings.keybindings,
    (kb) => registerConfigurableBindings(kb),
  );

  logger.info('app', 'App ready');
}

async function getDefaultProjectPath(): Promise<string> {
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    return await homeDir();
  } catch {
    return 'C:\\';
  }
}

main().catch(console.error);
