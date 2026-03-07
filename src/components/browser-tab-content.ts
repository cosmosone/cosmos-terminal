import { store } from '../state/store';
import { setBrowserTabUrl, setBrowserTabTitle, setBrowserTabLoading } from '../state/actions';
import { createBrowserWebview, showBrowserWebview, hideBrowserWebview, navigateBrowser, resizeBrowserWebview, browserGoBack, browserGoForward, captureBrowserScreenshot } from '../services/browser-service';
import { listen } from '@tauri-apps/api/event';
import { createElement, clearChildren, $ } from '../utils/dom';
import { arrowLeftIcon, arrowRightIcon, refreshIcon } from '../utils/icons';
import { logger } from '../services/logger';
import { BROWSER_NAVIGATED_EVENT, BROWSER_TITLE_CHANGED_EVENT } from '../state/types';
import type { AppState, BrowserNavEvent, BrowserTab, BrowserTitleEvent, Project } from '../state/types';
import { decodeBase64ToBytes } from '../utils/base64';

/** Currently active browser tab ID (runtime only, not persisted). */
let activeTabId: string | null = null;

/** Module-level reference to the browser tab container, set during init. */
let containerRef: HTMLElement | null = null;

/** Module-level resize callback, assigned during init so restore can trigger a catch-up resize. */
let scheduleResizeRef: (() => void) | null = null;

/**
 * Reference-counted suppression for browser webview z-order handling.
 * Multiple overlays (settings, confirm dialog, context menu) can independently
 * suppress/restore; the webview is only shown when ALL have restored.
 *
 * When suppressing, the webview content is captured as a screenshot and displayed
 * as a CSS background-image on the webview placeholder area. This lets DOM-based
 * overlays render on top of the (static) page content instead of a blank area.
 */
let suppressCount = 0;

/** Object URL for the current screenshot blob (must be revoked on cleanup). */
let screenshotObjectUrl: string | null = null;

function getWebviewArea(): HTMLElement | null {
  return (containerRef ?? document).querySelector('.browser-webview-area') as HTMLElement | null;
}

/** Clear screenshot background and revoke any object URL. */
function clearScreenshotBackground(): void {
  const area = getWebviewArea();
  if (area) {
    area.style.backgroundImage = '';
    area.style.backgroundSize = '';
    area.style.backgroundRepeat = '';
  }
  if (screenshotObjectUrl) {
    URL.revokeObjectURL(screenshotObjectUrl);
    screenshotObjectUrl = null;
  }
}

/**
 * Reset suppress state to zero. Called on tab deactivation/switch where the
 * webview context changes and any outstanding suppressions are meaningless.
 */
function resetSuppression(): void {
  if (suppressCount > 0) {
    logger.debug('browser', 'Resetting suppress state', { previousCount: suppressCount });
  }
  suppressCount = 0;
  clearScreenshotBackground();
}

export async function suppressBrowserWebview(): Promise<void> {
  suppressCount++;
  if (suppressCount > 3) {
    logger.warn('browser', 'suppressCount exceeds 3 — possible leak', { count: suppressCount });
  }
  if (suppressCount === 1 && activeTabId) {
    const captureTabId = activeTabId;
    logger.debug('browser', 'Suppressing browser webview for overlay', { tabId: captureTabId });
    // Capture a screenshot before hiding so overlays show page content behind them
    try {
      const base64 = await captureBrowserScreenshot(captureTabId);
      // Discard stale capture if restore happened or tab changed during the async gap
      if ((suppressCount as number) === 0 || activeTabId !== captureTabId) return;
      const area = getWebviewArea();
      if (area) {
        // Convert base64 to Blob + object URL to avoid multi-MB inline data URLs
        const bytes = decodeBase64ToBytes(base64);
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        clearScreenshotBackground(); // revoke any previous URL
        screenshotObjectUrl = URL.createObjectURL(blob);
        area.style.backgroundImage = `url(${screenshotObjectUrl})`;
        area.style.backgroundSize = '100% 100%';
        area.style.backgroundRepeat = 'no-repeat';
      }
    } catch {
      // Screenshot failed — fall back to hiding without a screenshot
    }
    // Re-check: restore or tab change may have occurred during the async capture
    if ((suppressCount as number) === 0 || activeTabId !== captureTabId) return;
    void hideBrowserWebview(captureTabId);
  }
}

export function restoreBrowserWebview(): void {
  if (suppressCount <= 0) return;
  suppressCount--;
  if (suppressCount === 0) {
    logger.debug('browser', 'Restoring browser webview after overlay');
    clearScreenshotBackground();
    if (activeTabId) {
      void showBrowserWebview(activeTabId);
      // Catch up on any resize that was skipped while the webview was suppressed
      scheduleResizeRef?.();
    }
  }
}

function getActiveBrowserTab(s: AppState): { project: Project; tab: BrowserTab } | null {
  const project = s.projects.find((p) => p.id === s.activeProjectId);
  if (!project || !project.activeBrowserTabId) return null;
  const tab = project.browserTabs.find((t) => t.id === project.activeBrowserTabId);
  if (!tab) return null;
  return { project, tab };
}

/** Find the project that owns a given browser tab ID (searches all projects). */
function findProjectForBrowserTab(tabId: string): Project | undefined {
  return store.getState().projects.find((p) => p.browserTabs.some((t) => t.id === tabId));
}

/** Heuristic: does the input look like a URL rather than a search query? */
function looksLikeUrl(input: string): boolean {
  // Contains spaces → almost certainly a search query
  if (/\s/.test(input)) return false;
  // localhost with optional port
  if (/^localhost(:\d+)?(\/|$)/i.test(input)) return true;
  // IP address (v4) with optional port
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/|$)/.test(input)) return true;
  // Contains a dot and looks like a domain (e.g. "example.com", "foo.bar/path")
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(input)) return true;
  return false;
}

/** Normalise raw address bar input into a navigable URL. */
function normaliseAddressBarInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return looksLikeUrl(trimmed)
    ? `https://${trimmed}`
    // %5C (backslash) prefix tells DuckDuckGo to skip "I'm Feeling Lucky" auto-redirect
    : `https://duckduckgo.com/?q=%5C${encodeURIComponent(trimmed)}`;
}

export function initBrowserTabContent(): void {
  const container = $('#browser-tab-container')! as HTMLElement;
  containerRef = container;

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

  scheduleResizeRef = scheduleResize;

  function scheduleResize(): void {
    if (resizeRafId || !activeTabId || suppressCount > 0) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      if (!activeTabId || suppressCount > 0) return;
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
      const url = normaliseAddressBarInput(addressBar.value);
      if (url && activeTabId) {
        logger.debug('browser', 'Reload clicked', { tabId: activeTabId });
        void navigateBrowser(activeTabId, url);
      }
    });
    chrome.appendChild(reloadBtn);

    // Address bar
    const addressBar = createElement('input', { className: 'browser-address-bar' }) as HTMLInputElement;
    addressBar.type = 'text';
    addressBar.value = tab.url;
    addressBar.placeholder = 'Search or enter URL...';
    addressBar.spellcheck = false;
    addressBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = normaliseAddressBarInput(addressBar.value);
        if (!url || !activeTabId) return;
        addressBar.value = url;
        logger.debug('browser', 'Address bar navigate', { tabId: activeTabId, url });
        setBrowserTabUrl(projectId, activeTabId, url);
        setBrowserTabLoading(projectId, activeTabId, true);
        void navigateBrowser(activeTabId, url);
        addressBar.blur();
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
  void listen<BrowserNavEvent>(BROWSER_NAVIGATED_EVENT, (event) => {
    const { tabId, url, loading } = event.payload;
    logger.debug('browser', 'browser-navigated event', { tabId, url, loading });
    const project = findProjectForBrowserTab(tabId);
    if (!project) {
      logger.debug('browser', 'browser-navigated: tab not found in any project', { tabId });
      return;
    }

    setBrowserTabLoading(project.id, tabId, loading);

    if (!loading) {
      // Finished — update URL + title
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
    }

    // Update address bar if this is the active tab
    if (tabId === activeTabId) {
      const addressBar = container.querySelector('.browser-address-bar') as HTMLInputElement | null;
      if (addressBar && document.activeElement !== addressBar) {
        addressBar.value = url;
      }
    }
  });

  // Listen for page title updates from the Rust backend (via WebView2 DocumentTitle)
  void listen<BrowserTitleEvent>(BROWSER_TITLE_CHANGED_EVENT, (event) => {
    const { tabId, title } = event.payload;
    logger.debug('browser', 'browser-title-changed event', { tabId, title });
    const project = findProjectForBrowserTab(tabId);
    if (!project) return;
    setBrowserTabTitle(project.id, tabId, title);
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
        // R1: Reset suppress state — no webview context, stale suppressions are meaningless
        resetSuppression();
        return;
      }

      container.classList.remove('hidden');

      const found = getActiveBrowserTab(store.getState());
      if (!found) return;
      const { project, tab } = found;
      const isTabSwitch = lastTabId !== null && tab.id !== lastTabId;

      // Hide previous browser webview on tab switch
      if (isTabSwitch && lastTabId) {
        logger.debug('browser', 'Tab switch: hiding previous webview', { previousTabId: lastTabId, newTabId: tab.id });
        void hideBrowserWebview(lastTabId);
        // R1: Reset suppress state — new tab starts with a clean slate
        resetSuppression();
      }

      activeTabId = tab.id;
      lastTabId = tab.id;

      logger.debug('browser', 'Activating browser tab', { tabId: tab.id, url: tab.url, projectId: project.id });
      renderChrome(project.id, tab);

      // Wait for layout to settle, then show/create the webview (unless an overlay is active)
      requestAnimationFrame(() => {
        if (suppressCount > 0) return;
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
