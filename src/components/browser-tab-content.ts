import { store } from '../state/store';
import { setBrowserTabUrl, setBrowserTabTitle } from '../state/actions';
import { createBrowserWebview, showBrowserWebview, hideBrowserWebview, navigateBrowser, resizeBrowserWebview, browserGoBack, browserGoForward } from '../services/browser-service';
import { listen } from '@tauri-apps/api/event';
import { createElement, clearChildren, $ } from '../utils/dom';
import { arrowLeftIcon, arrowRightIcon, refreshIcon } from '../utils/icons';
import { logger } from '../services/logger';
import type { AppState, BrowserTab, Project } from '../state/types';

/** Currently active browser tab ID (runtime only, not persisted). */
let activeTabId: string | null = null;

/** Suppress/restore browser webview visibility for overlay z-order handling. */
let suppressed = false;

export function suppressBrowserWebview(): void {
  if (activeTabId && !suppressed) {
    logger.debug('browser', 'Suppressing browser webview for overlay', { tabId: activeTabId });
    suppressed = true;
    void hideBrowserWebview(activeTabId);
  }
}

export function restoreBrowserWebview(): void {
  if (activeTabId && suppressed) {
    logger.debug('browser', 'Restoring browser webview after overlay', { tabId: activeTabId });
    suppressed = false;
    void showBrowserWebview(activeTabId);
  }
}

function getActiveBrowserTab(s: AppState): { project: Project; tab: BrowserTab } | null {
  const project = s.projects.find((p) => p.id === s.activeProjectId);
  if (!project || !project.activeBrowserTabId) return null;
  const tab = project.browserTabs.find((t) => t.id === project.activeBrowserTabId);
  if (!tab) return null;
  return { project, tab };
}

export function initBrowserTabContent(): void {
  const container = $('#browser-tab-container')! as HTMLElement;

  let resizeRafId = 0;
  let lastTabId: string | null = null;
  let activeObserver: ResizeObserver | null = null;

  function getWebviewBounds(): { x: number; y: number; width: number; height: number } | null {
    const area = container.querySelector('.browser-webview-area') as HTMLElement | null;
    if (!area) {
      logger.debug('browser', 'getWebviewBounds: no .browser-webview-area element');
      return null;
    }
    const rect = area.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      logger.debug('browser', 'getWebviewBounds: zero-size area', { width: rect.width, height: rect.height });
      return null;
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  async function showOrCreateWebview(tab: BrowserTab): Promise<void> {
    const bounds = getWebviewBounds();
    if (!bounds) {
      logger.warn('browser', 'showOrCreateWebview: no bounds, skipping', { tabId: tab.id });
      return;
    }
    logger.debug('browser', 'showOrCreateWebview', { tabId: tab.id, url: tab.url, bounds });
    // createBrowserWebview handles the "already alive" case idempotently
    await createBrowserWebview(tab.id, tab.url, bounds.x, bounds.y, bounds.width, bounds.height);
  }

  function scheduleResize(): void {
    if (resizeRafId || !activeTabId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      if (!activeTabId) return;
      const bounds = getWebviewBounds();
      if (bounds) {
        logger.debug('browser', 'Resize webview', { tabId: activeTabId, bounds });
        void resizeBrowserWebview(activeTabId, bounds.x, bounds.y, bounds.width, bounds.height);
      }
    });
  }

  function renderChrome(projectId: string, tab: BrowserTab): void {
    logger.debug('browser', 'renderChrome', { projectId, tabId: tab.id, url: tab.url });
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    clearChildren(container);

    const chrome = createElement('div', { className: 'browser-chrome' });

    // Back button
    const backBtn = createElement('button', { className: 'browser-nav-btn', title: 'Back' });
    backBtn.innerHTML = arrowLeftIcon(14);
    backBtn.addEventListener('click', () => {
      if (activeTabId) void browserGoBack(activeTabId);
    });
    chrome.appendChild(backBtn);

    // Forward button
    const fwdBtn = createElement('button', { className: 'browser-nav-btn', title: 'Forward' });
    fwdBtn.innerHTML = arrowRightIcon(14);
    fwdBtn.addEventListener('click', () => {
      if (activeTabId) void browserGoForward(activeTabId);
    });
    chrome.appendChild(fwdBtn);

    // Reload button
    const reloadBtn = createElement('button', { className: 'browser-nav-btn', title: 'Reload' });
    reloadBtn.innerHTML = refreshIcon(14);
    reloadBtn.addEventListener('click', () => {
      if (activeTabId) {
        logger.debug('browser', 'Reload clicked', { tabId: activeTabId });
        void navigateBrowser(activeTabId, addressBar.value);
      }
    });
    chrome.appendChild(reloadBtn);

    // Address bar
    const addressBar = createElement('input', { className: 'browser-address-bar' }) as HTMLInputElement;
    addressBar.type = 'text';
    addressBar.value = tab.url;
    addressBar.placeholder = 'Enter URL...';
    addressBar.spellcheck = false;
    addressBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = addressBar.value.trim();
        if (!url) return;
        // Auto-prepend https:// if no scheme
        if (!/^https?:\/\//i.test(url)) {
          url = `https://${url}`;
          addressBar.value = url;
        }
        if (activeTabId) {
          logger.debug('browser', 'Address bar navigate', { tabId: activeTabId, url });
          setBrowserTabUrl(projectId, activeTabId, url);
          void navigateBrowser(activeTabId, url);
        }
      }
    });
    // Select all text on focus for easy replacement
    addressBar.addEventListener('focus', () => addressBar.select());
    chrome.appendChild(addressBar);

    container.appendChild(chrome);

    // Webview placeholder area — its bounding rect defines the native webview position
    const area = createElement('div', { className: 'browser-webview-area' });
    container.appendChild(area);

    // Observe size changes for webview repositioning
    activeObserver = new ResizeObserver(() => {
      logger.debug('browser', 'ResizeObserver fired for webview area');
      scheduleResize();
    });
    activeObserver.observe(area);
  }

  // Listen for navigation events from the Rust backend
  void listen<{ tabId: string; url: string }>('browser-navigated', (event) => {
    const { tabId, url } = event.payload;
    logger.debug('browser', 'browser-navigated event', { tabId, url });
    // Search all projects — the navigating webview may belong to a non-active project (LRU pool)
    const projects = store.getState().projects;
    const project = projects.find((p) => p.browserTabs.some((t) => t.id === tabId));
    if (!project) {
      logger.debug('browser', 'browser-navigated: tab not found in any project', { tabId });
      return;
    }

    // Batch URL + title into a single state update where possible
    let title: string | null = null;
    try {
      const hostname = new URL(url).hostname;
      if (hostname) title = hostname;
    } catch {
      // ignore
    }
    if (title) {
      setBrowserTabTitle(project.id, tabId, title, url);
    } else {
      setBrowserTabUrl(project.id, tabId, url);
    }

    // Update address bar if this is the active tab
    if (tabId === activeTabId) {
      const addressBar = container.querySelector('.browser-address-bar') as HTMLInputElement | null;
      if (addressBar && document.activeElement !== addressBar) {
        addressBar.value = url;
      }
    }
  });

  // Main subscription: react to active browser tab changes (not URL changes)
  store.select(
    (s) => {
      const found = getActiveBrowserTab(s);
      if (!found) return null;
      return `${found.project.id}|${found.tab.id}`;
    },
    async (key) => {
      logger.debug('browser', 'Tab selector fired', { key, previousTabId: lastTabId });

      if (!key) {
        // No active browser tab — hide current webview and container
        if (activeTabId) {
          logger.debug('browser', 'Hiding webview (no active browser tab)', { tabId: activeTabId });
          void hideBrowserWebview(activeTabId);
        }
        container.classList.add('hidden');
        activeTabId = null;
        lastTabId = null;
        return;
      }

      container.classList.remove('hidden');
      suppressed = false;

      const found = getActiveBrowserTab(store.getState());
      if (!found) return;
      const { project, tab } = found;
      const isTabSwitch = lastTabId !== null && tab.id !== lastTabId;

      // Hide previous browser webview on tab switch
      if (isTabSwitch && lastTabId) {
        logger.debug('browser', 'Tab switch: hiding previous webview', { previousTabId: lastTabId, newTabId: tab.id });
        void hideBrowserWebview(lastTabId);
      }

      activeTabId = tab.id;
      lastTabId = tab.id;

      logger.debug('browser', 'Activating browser tab', { tabId: tab.id, url: tab.url, projectId: project.id });
      renderChrome(project.id, tab);

      // Wait for layout to settle, then show/create the webview
      requestAnimationFrame(() => {
        logger.debug('browser', 'Post-layout RAF: showing/creating webview', { tabId: tab.id });
        void showOrCreateWebview(tab);
      });
    },
  );

  // Also reposition on window resize
  window.addEventListener('resize', () => {
    logger.debug('browser', 'Window resize, scheduling webview reposition');
    scheduleResize();
  });

  logger.info('browser', 'Browser tab content initialised');
}
