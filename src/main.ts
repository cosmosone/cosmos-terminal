import '@xterm/xterm/css/xterm.css';
import { initStore, store } from './state/store';
import { addProject, addSession, getActiveProject, getActiveSession, removeProject, removeSession, splitPane, cycleSession, cycleProject, toggleSettingsView, toggleGitSidebar, toggleFileBrowserSidebar, defaultGitSidebarState, defaultFileBrowserSidebarState } from './state/actions';
import { loadSettings, saveSettings, buildUiFont } from './services/settings-service';
import { loadWorkspace, saveWorkspace } from './services/workspace-service';
import { resolveActivePaneId } from './layout/pane-tree';
import type { AppState, BrowserTab, KeybindingConfig, Session, FileTab, PaneLeaf } from './state/types';
import { FRONTEND_UPDATED_EVENT } from './state/types';
import { AGENT_DEFINITIONS } from './services/agent-definitions';
import { setInitialCommand } from './services/initial-command';
import { logger } from './services/logger';
import { initProjectTabBar } from './components/project-tab-bar';
import { initWorkTabBar } from './components/work-tab-bar';
import { SplitContainer, loadReconnectState } from './components/split-container';
import { initSettingsPage } from './components/settings-page';
import { initStatusBar } from './components/status-bar';
import { initLogViewer } from './components/log-viewer';
import { initGitSidebar } from './components/git-sidebar';
import { initFileBrowserSidebar } from './components/file-browser-sidebar';
import { initFileTabContent } from './components/file-tab-content';
import { initBrowserTabContent } from './components/browser-tab-content';
import { clearMarkdownRenderCache } from './services/markdown-renderer';
import { setBrowserPoolSize } from './services/browser-service';
import { listen } from '@tauri-apps/api/event';
import { watchDirectory, unwatchDirectory } from './services/fs-service';
import { keybindings, parseKeybinding } from './utils/keybindings';
import { confirmCloseTerminalTab, confirmCloseProject } from './components/confirm-dialog';
import { $ } from './utils/dom';
import { debounce } from './utils/debounce';
import { basename } from './utils/path';
import { initProcessMonitorListener } from './services/process-monitor-service';
import './highlight/languages/register-all';

async function main(): Promise<void> {
  loadReconnectState();
  const [settings, saved] = await Promise.all([loadSettings(), loadWorkspace()]);

  // Check 24h auto-disable for debug logging
  if (settings.debugLogging && settings.debugLoggingExpiry) {
    if (new Date(settings.debugLoggingExpiry).getTime() <= Date.now()) {
      settings.debugLogging = false;
      settings.debugLoggingExpiry = null;
      void saveSettings(settings);
    }
  }
  if (settings.debugLogging) {
    logger.enable();
  }

  logger.info('app', 'App starting', { settingsLoaded: true });

  // Start listening for process tree changes from the Rust backend
  initProcessMonitorListener();

  // Workspace migration: older saved data may lack newer fields
  type SavedSession = Omit<Session, 'locked' | 'muted'> & { locked?: boolean; muted?: boolean };
  type SavedFileTab = Omit<FileTab, 'locked'> & { locked?: boolean };
  type SavedBrowserTab = Omit<BrowserTab, 'locked'> & { locked?: boolean };
  type SavedProject = any;

  initStore({
    projects: (saved?.projects ?? []).map((p: SavedProject) => ({
      ...p,
      sessions: (p.sessions ?? []).map((s: SavedSession) => ({ ...s, locked: s.locked ?? false, muted: s.muted ?? false })),
      tabs: (p.tabs ?? []).map((t: SavedFileTab) => ({ ...t, locked: t.locked ?? false })),
      browserTabs: ((p.browserTabs ?? []) as SavedBrowserTab[]).map((t) => ({ ...t, locked: t.locked ?? false })),
      activeTabId: p.activeTabId ?? null,
      activeBrowserTabId: p.activeBrowserTabId ?? null,
      tabActivationSeq: p.tabActivationSeq ?? 0,
      runCommand: p.runCommand ?? (settings as any).runCommand ?? '',
      showRunButton: p.showRunButton ?? true,
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
  const workTabBar = initWorkTabBar(refresh, (paneId, data) => splitContainer.writeToPane(paneId, data));
  initSettingsPage(() => { splitContainer.applySettings(); applyFontSettings(); });
  initLogViewer();
  initGitSidebar(() => splitContainer.reLayout());
  const fileBrowser = initFileBrowserSidebar(() => splitContainer.reLayout());
  initStatusBar(() => {
    splitContainer.clearHiddenScrollback();
    fileBrowser.clearCache();
    clearMarkdownRenderCache();
  });
  const fileTabContent = initFileTabContent();
  initBrowserTabContent();

  // Sync browser pool size to Rust backend on startup and on change
  void setBrowserPoolSize(settings.browserPoolSize);
  store.select(
    (s) => s.settings.browserPoolSize,
    (size) => { void setBrowserPoolSize(size); },
  );

  let watchedProjectPath: string | null = null;
  let watcherSyncVersion = 0;

  async function syncFsWatcher(projectPath: string | null): Promise<void> {
    if (projectPath === watchedProjectPath) return;
    const version = ++watcherSyncVersion;
    try {
      if (projectPath) {
        await watchDirectory(projectPath);
      } else {
        await unwatchDirectory();
      }
      if (version !== watcherSyncVersion) return;
      watchedProjectPath = projectPath;
      logger.debug('fs', 'Synced filesystem watcher target', { projectPath });
    } catch (err: unknown) {
      if (version !== watcherSyncVersion) return;
      watchedProjectPath = null;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('fs', 'Failed to sync filesystem watcher target', { projectPath, error: message });
    }
  }

  // Visibility management: show exactly one content area at a time
  const fileTabContainer = $('#file-tab-container') as HTMLElement | null;
  const browserTabContainer = $('#browser-tab-container') as HTMLElement | null;

  store.select(
    (s) => {
      const p = s.projects.find((p) => p.id === s.activeProjectId);
      if (p?.activeBrowserTabId) return 'browser';
      if (p?.activeTabId) return 'file';
      return 'terminal';
    },
    (view) => {
      logger.debug('browser', 'View mode changed', { view });
      terminalContainer.classList.toggle('hidden', view !== 'terminal');
      fileTabContainer?.classList.toggle('hidden', view !== 'file');
      browserTabContainer?.classList.toggle('hidden', view !== 'browser');
      if (view === 'terminal') splitContainer.reLayout();
    },
  );

  store.select(
    (s) => {
      const project = s.projects.find((p) => p.id === s.activeProjectId);
      return project?.path ?? null;
    },
    (projectPath) => {
      void syncFsWatcher(projectPath);
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

    if (project.sessions.length <= 1 && project.tabs.length === 0 && project.browserTabs.length === 0) {
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
      const current = getActiveSession();
      const agentCmd = current?.agentCommand;
      if (agentCmd) {
        const agent = AGENT_DEFINITIONS.find((a) => a.command === agentCmd);
        if (agent) {
          const session = addSession(project.id, { title: agent.label, agentCommand: agent.command });
          setInitialCommand((session.paneTree as PaneLeaf).paneId, agent.initialCmd ?? agent.command);
        } else {
          addSession(project.id);
        }
      } else {
        addSession(project.id);
      }
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
      const target = resolveActivePaneId(session.activePaneId, session.paneTree);
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

    bind(kb.renameTab, () => workTabBar.triggerRename());
  }

  store.select(
    (s) => s.settings.keybindings,
    (kb) => registerConfigurableBindings(kb),
  );

  void listen(FRONTEND_UPDATED_EVENT, async () => {
    logger.info('app', 'Frontend assets updated');
    if (document.getElementById('status-update-badge')) return;

    // location.origin returns "null" on custom URI schemes (cosmos://),
    // so build the base URL from protocol + host instead.
    const baseUrl = `${location.protocol}//${location.host}`;
    let newVersion: string | null = null;
    try {
      const vResp = await fetch(`${baseUrl}/version.json`, { cache: 'no-store' });
      if (vResp.ok) {
        const vData = await vResp.json() as { version: string };
        newVersion = vData.version;
      }
    } catch { /* version.json may not exist or fetch may fail on old code */ }

    const versionEl = document.querySelector<HTMLElement>('.status-version');
    if (versionEl) {
      const badge = document.createElement('span');
      badge.id = 'status-update-badge';
      badge.title = 'Click to reload with new version';
      badge.textContent = newVersion ? `Reload: v${newVersion}` : 'Reload: Update';
      badge.addEventListener('click', async () => {
        const terminalState = splitContainer.serializeAll();
        const serialized: Record<string, { backendId: string; buffer: string }> = {};
        for (const [paneId, data] of terminalState) {
          serialized[paneId] = data;
        }
        try {
          sessionStorage.setItem('cosmos-terminal-state', JSON.stringify(serialized));
        } catch {
          logger.warn('app', 'Terminal state too large for sessionStorage, skipping');
        }

        const s = store.getState();
        await saveWorkspace(s.projects, s.activeProjectId, s.gitSidebar, s.fileBrowserSidebar);
        await saveSettings(s.settings);
        location.reload();
      });
      versionEl.after(badge);
    }

    try {
      const resp = await fetch(`${baseUrl}/index.html`, { cache: 'no-store' });
      const html = await resp.text();
      const newDoc = new DOMParser().parseFromString(html, 'text/html');

      const oldLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
      const newLinks = Array.from(newDoc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));

      const loads = newLinks.map(tmpl => new Promise<void>(resolve => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        if (tmpl.hasAttribute('crossorigin')) link.crossOrigin = '';
        const href = tmpl.getAttribute('href');
        if (!href) { resolve(); return; }
        link.href = href;
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.appendChild(link);
      }));
      await Promise.all(loads);
      oldLinks.forEach(l => l.remove());
      logger.info('app', 'CSS hot-swap complete');
    } catch (e) {
      logger.warn('app', `CSS hot-swap failed (reload will apply all changes): ${e}`);
    }
  });

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
