import '@xterm/xterm/css/xterm.css';
import { initStore, store } from './state/store';
import { addProject, addSession, getActiveProject, getActiveSession, removeProject, removeSession, splitPane, cycleSession, cycleProject, toggleSettingsView, toggleGitSidebar, toggleFileBrowserSidebar, defaultGitSidebarState, defaultFileBrowserSidebarState } from './state/actions';
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
import { initFileBrowserSidebar } from './components/file-browser-sidebar';
import { initFileTabContent } from './components/file-tab-content';
import { keybindings, parseKeybinding } from './utils/keybindings';
import { confirmCloseTerminalTab, confirmCloseProject } from './components/confirm-dialog';
import { $ } from './utils/dom';
import { debounce } from './utils/debounce';
import { basename } from './utils/path';
import './highlight/languages/register-all';

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
    projects: (saved?.projects ?? []).map((p) => ({
      ...p,
      sessions: (p.sessions ?? []).map((s: any) => ({ ...s, locked: s.locked ?? false })),
      tabs: (p.tabs ?? []).map((t: any) => ({ ...t, locked: t.locked ?? false })),
      activeTabId: p.activeTabId ?? null,
    })),
    activeProjectId: saved?.activeProjectId ?? null,
    settings,
    view: 'terminal',
    gitSidebar: saved?.gitSidebar ?? defaultGitSidebarState(),
    fileBrowserSidebar: saved?.fileBrowserSidebar ?? defaultFileBrowserSidebarState(),
    gitStates: {},
  });

  logger.debug('app', 'Store initialized', { restored: !!saved });

  function applyFontSettings(): void {
    const { uiFontFamily, uiFontSize, viewerFontSize, editorFontSize } = store.getState().settings;
    document.documentElement.style.setProperty('--font-ui', buildUiFont(uiFontFamily));
    document.documentElement.style.setProperty('--font-ui-size', `${uiFontSize}px`);
    document.documentElement.style.setProperty('--viewer-font-size', `${viewerFontSize}px`);
    document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
  }
  applyFontSettings();

  const terminalContainer = $('#terminal-container')! as HTMLElement;
  const splitContainer = new SplitContainer(terminalContainer);
  const refresh = () => splitContainer.render();

  initProjectTabBar(refresh);
  initSessionTabBar(refresh);
  initSettingsPage(() => { splitContainer.applySettings(); applyFontSettings(); });
  initStatusBar(() => splitContainer.clearAllScrollback());
  initLogViewer();
  initGitSidebar(() => splitContainer.reLayout());
  const fileBrowser = initFileBrowserSidebar(() => splitContainer.reLayout());
  const fileTabContent = initFileTabContent();

  // Visibility management: hide terminal when file tab is active, show when terminal session is active
  const fileTabContainer = $('#file-tab-container') as HTMLElement | null;

  store.select(
    (s) => {
      const project = s.projects.find((p) => p.id === s.activeProjectId);
      return project?.activeSessionId != null && project?.activeTabId == null;
    },
    (showTerminal) => {
      terminalContainer.classList.toggle('hidden', !showTerminal);

      if (showTerminal) {
        fileTabContainer?.classList.add('hidden');
        splitContainer.reLayout();
      }
    },
  );

  logger.debug('app', 'All components initialized');

  if (!saved) {
    const defaultPath = await getDefaultProjectPath();
    const defaultName = basename(defaultPath, 'Project');
    addProject(defaultName, defaultPath);
    logger.info('app', 'Default project created', { path: defaultPath });
  } else {
    logger.info('app', 'Workspace restored', { projectCount: saved.projects.length });
  }

  await splitContainer.render();

  // Persist workspace state on changes (debounced)
  const debouncedSave = debounce(() => {
    const s = store.getState();
    saveWorkspace(s.projects, s.activeProjectId, s.gitSidebar, s.fileBrowserSidebar);
  }, 1000);

  const workspaceSelectors: ((s: AppState) => unknown)[] = [
    (s) => s.projects,
    (s) => s.activeProjectId,
    (s) => s.gitSidebar,
    (s) => s.fileBrowserSidebar,
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

  async function closeActiveTerminalTab(): Promise<void> {
    const project = getActiveProject();
    if (!project?.activeSessionId) return;

    if (project.sessions.length <= 1) {
      if (!await confirmCloseProject(project.name)) return;
      removeProject(project.id);
      refresh();
      return;
    }

    const sessionTitle = getActiveSession()?.title ?? 'terminal';
    if (!await confirmCloseTerminalTab(sessionTitle)) return;
    removeSession(project.id, project.activeSessionId);
    refresh();
  }

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

    bind(kb.newSession, () => {
      const project = getActiveProject();
      if (!project) return;
      addSession(project.id);
      refresh();
    });
    bind(kb.toggleSettings, toggleSettingsView);

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
      if (!project) return;
      cycleSession(project.id, direction);
      refresh();
    }

    function doCycleProject(direction: 1 | -1): void {
      cycleProject(direction);
      refresh();
    }

    bind(kb.cycleSessionNext, () => doCycleSession(1));
    bind(kb.cycleSessionPrev, () => doCycleSession(-1));
    bind(kb.cycleProjectNext, () => doCycleProject(1));
    bind(kb.cycleProjectPrev, () => doCycleProject(-1));

    bind(kb.toggleGitSidebar, toggleGitSidebar);
    bind(kb.toggleFileBrowser, toggleFileBrowserSidebar);
    bind(kb.searchFileBrowser, () => fileBrowser.triggerSearch());
    bind(kb.scrollToBottom, () => splitContainer.scrollToBottom());
    bind(kb.findInDocument, () => fileTabContent.openSearch());

    bind(kb.closeTerminalTab, () => closeActiveTerminalTab());

    bind(kb.closeProjectTab, async () => {
      const project = getActiveProject();
      if (!project) return;
      if (!await confirmCloseProject(project.name)) return;
      removeProject(project.id);
      refresh();
    });
  }

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
