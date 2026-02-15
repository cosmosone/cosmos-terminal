import '@xterm/xterm/css/xterm.css';
import { initStore, store } from './state/store';
import { addProject, addSession, getActiveProject, getActiveSession, removeProject, removeSession, splitPane, cycleSession, cycleProject, toggleSettingsView, toggleGitSidebar, updateSettings, defaultGitSidebarState } from './state/actions';
import { loadSettings, saveSettings, buildUiFont } from './services/settings-service';
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
import { showConfirmDialog } from './components/confirm-dialog';
import { $ } from './utils/dom';
import { debounce } from './utils/debounce';

async function main(): Promise<void> {
  const [settings, saved] = await Promise.all([loadSettings(), loadWorkspace()]);

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

  initStore({
    projects: saved?.projects ?? [],
    activeProjectId: saved?.activeProjectId ?? null,
    settings,
    view: 'terminal',
    gitSidebar: saved?.gitSidebar ?? defaultGitSidebarState(),
    gitStates: {},
  });

  logger.debug('app', 'Store initialized', { restored: !!saved });

  function applyUiFont(): void {
    const { uiFontFamily, uiFontSize } = store.getState().settings;
    document.documentElement.style.setProperty('--font-ui', buildUiFont(uiFontFamily));
    document.documentElement.style.setProperty('--font-ui-size', `${uiFontSize}px`);
  }
  applyUiFont();

  const terminalContainer = $('#terminal-container')! as HTMLElement;
  const splitContainer = new SplitContainer(terminalContainer);
  const refresh = () => splitContainer.render();

  initProjectTabBar(refresh);
  initSessionTabBar(refresh);
  initSettingsPage(() => { splitContainer.applySettings(); applyUiFont(); });
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

  const workspaceSelectors: ((s: AppState) => unknown)[] = [
    (s) => s.projects,
    (s) => s.activeProjectId,
    (s) => s.gitSidebar,
  ];
  for (const selector of workspaceSelectors) {
    store.select(selector, () => debouncedSave());
  }

  let resizeRafId = 0;
  window.addEventListener('resize', () => {
    if (!resizeRafId) {
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = 0;
        logger.debug('layout', 'Window resized, re-laying out');
        splitContainer.reLayout();
      });
    }
  });

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

    bind(kb.toggleGitSidebar, toggleGitSidebar);

    bind(kb.closeTerminalTab, async () => {
      const project = getActiveProject();
      if (!project?.activeSessionId || project.sessions.length <= 1) return;
      const currentSettings = store.getState().settings;
      if (currentSettings.confirmCloseTerminalTab) {
        const result = await showConfirmDialog({
          title: 'Close Terminal Tab',
          message: `Close "${project.sessions.find(s => s.id === project.activeSessionId)?.title ?? 'terminal'}"?`,
          confirmText: 'Close',
          showCheckbox: true,
          checkboxLabel: "Don't ask again",
          danger: true,
        });
        if (!result.confirmed) return;
        if (result.checkboxChecked) {
          updateSettings({ confirmCloseTerminalTab: false });
          saveSettings(store.getState().settings);
        }
      }
      removeSession(project.id, project.activeSessionId);
      refresh();
    });

    bind(kb.closeProjectTab, async () => {
      const project = getActiveProject();
      if (!project) return;
      const result = await showConfirmDialog({
        title: 'Close Project Tab',
        message: `Close project "${project.name}"? All terminal sessions in this project will be closed.`,
        confirmText: 'Close',
        danger: true,
      });
      if (!result.confirmed) return;
      removeProject(project.id);
      refresh();
    });
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
