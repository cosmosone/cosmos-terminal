import { store } from '../state/store';
import { setBrowserTabUrl, setBrowserTabTitle, setBrowserTabLoading, setBrowserTabZoom } from '../state/actions';
import { createBrowserWebview, showBrowserWebview, hideBrowserWebview, navigateBrowser, resizeBrowserWebview, browserGoBack, browserGoForward, captureBrowserScreenshot, setBrowserZoom } from '../services/browser-service';
import { listen } from '@tauri-apps/api/event';
import { createElement, clearChildren, $ } from '../utils/dom';
import { arrowLeftIcon, arrowRightIcon, refreshIcon, zoomIcon } from '../utils/icons';
import { logger } from '../services/logger';
import { keybindings } from '../utils/keybindings';
import { BROWSER_NAVIGATED_EVENT, BROWSER_TITLE_CHANGED_EVENT, BROWSER_ZOOM_KEY_EVENT } from '../state/types';
import type { AppState, BrowserNavEvent, BrowserTab, BrowserTitleEvent, Project } from '../state/types';
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

/** Zoom range bounds — must match the clamp in set_browser_zoom (browser_commands.rs). */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5.0;

/** Predefined zoom levels matching common browser steps. */
const ZOOM_LEVELS = [ZOOM_MIN, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, ZOOM_MAX];

function getZoom(tabId: string): number {
  const project = findProjectForBrowserTab(tabId);
  const tab = project?.browserTabs.find((t) => t.id === tabId);
  return tab?.zoomFactor ?? 1.0;
}

function applyZoom(tabId: string, factor: number): void {
  const project = findProjectForBrowserTab(tabId);
  if (!project) return;
  setBrowserTabZoom(project.id, tabId, factor);
  setBrowserZoom(tabId, factor).catch((err) => {
    logger.warn('browser', 'Failed to set zoom', { tabId, factor, error: String(err) });
  });
  updateZoomIndicator(factor);
}

function zoomIn(tabId: string): void {
  const current = getZoom(tabId);
  const next = ZOOM_LEVELS.find((l) => l > current + 0.001);
  applyZoom(tabId, next ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
}

function zoomOut(tabId: string): void {
  const current = getZoom(tabId);
  const next = ZOOM_LEVELS.findLast((l) => l < current - 0.001);
  applyZoom(tabId, next ?? ZOOM_LEVELS[0]);
}

function resetZoom(tabId: string): void {
  applyZoom(tabId, 1.0);
}

function isDefaultZoom(factor: number): boolean {
  return Math.round(factor * 100) === 100;
}

/**
 * Zoom UI state — grouped for clear lifecycle management.
 * All fields are set during renderChrome() and go stale on tab switch
 * (renderChrome re-assigns them). `dismiss` must be called before
 * clearing the container to avoid leaking document-level listeners.
 */
const zoomUI = {
  labelEl: null as HTMLElement | null,
  triggerEl: null as HTMLElement | null,
  dismiss: null as (() => void) | null,
};

/** Update the zoom indicator label and trigger state. */
function updateZoomIndicator(factor: number): void {
  const pct = Math.round(factor * 100);
  if (zoomUI.labelEl) zoomUI.labelEl.textContent = `${pct}%`;
  if (zoomUI.triggerEl) {
    zoomUI.triggerEl.classList.toggle('browser-zoom-active', !isDefaultZoom(factor));
    zoomUI.triggerEl.title = `Zoom (${pct}%)`;
  }
}

function getWebviewArea(): HTMLElement | null {
  return (containerRef ?? document).querySelector('.browser-webview-area') as HTMLElement | null;
}

/** Clear screenshot background from the webview area. */
function clearScreenshotBackground(): void {
  const area = getWebviewArea();
  if (area) {
    area.style.backgroundImage = '';
    area.style.backgroundSize = '';
    area.style.backgroundRepeat = '';
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
    // Capture a screenshot while the webview is still visible, set it as a CSS
    // background, then hide the native HWND. This order is critical — WebView2's
    // CapturePreview returns blank for hidden webviews, so capture must come first.
    try {
      const base64 = await captureBrowserScreenshot(captureTabId);
      if ((suppressCount as number) === 0 || activeTabId !== captureTabId) return;
      const area = getWebviewArea();
      if (area) {
        area.style.backgroundImage = `url(data:image/jpeg;base64,${base64})`;
        area.style.backgroundSize = '100% 100%';
        area.style.backgroundRepeat = 'no-repeat';
      }
    } catch (err) {
      logger.warn('browser', 'Screenshot capture failed', { error: String(err) });
    }
    if ((suppressCount as number) === 0 || activeTabId !== captureTabId) return;
    await hideBrowserWebview(captureTabId);
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
    // Restore persisted zoom level (fresh webviews start at 1.0)
    const zoom = tab.zoomFactor ?? 1.0;
    if (zoom !== 1.0) {
      setBrowserZoom(tab.id, zoom).catch((err) => {
        logger.warn('browser', 'Failed to restore zoom', { tabId: tab.id, zoom, error: String(err) });
      });
    }
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

    // Zoom — magnifier icon with inline [−] [%] [+] that expand to its left
    zoomUI.dismiss?.();
    const currentZoom = tab.zoomFactor ?? 1.0;
    const zoomAnchor = createElement('div', { className: 'browser-zoom-anchor' });

    // Controls (hidden by default, appear inline to the left of the trigger)
    const controls = createElement('div', { className: 'browser-zoom-controls hidden' });

    const zoomOutBtn = createElement('button', { className: 'browser-nav-btn browser-zoom-btn', title: 'Zoom out (Ctrl+−)' });
    zoomOutBtn.textContent = '−';
    zoomOutBtn.addEventListener('click', () => { if (activeTabId) zoomOut(activeTabId); });
    controls.appendChild(zoomOutBtn);

    const zoomLabel = createElement('button', { className: 'browser-zoom-label', title: 'Reset zoom (Ctrl+0)' });
    zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
    zoomLabel.addEventListener('click', () => { if (activeTabId) resetZoom(activeTabId); });
    controls.appendChild(zoomLabel);

    const zoomInBtn = createElement('button', { className: 'browser-nav-btn browser-zoom-btn', title: 'Zoom in (Ctrl++)' });
    zoomInBtn.textContent = '+';
    zoomInBtn.addEventListener('click', () => { if (activeTabId) zoomIn(activeTabId); });
    controls.appendChild(zoomInBtn);

    zoomAnchor.appendChild(controls);

    // Magnifier trigger
    const zoomTrigger = createElement('button', {
      className: 'browser-nav-btn browser-zoom-trigger',
      title: `Zoom (${Math.round(currentZoom * 100)}%)`,
    });
    zoomTrigger.innerHTML = zoomIcon(14);
    if (!isDefaultZoom(currentZoom)) zoomTrigger.classList.add('browser-zoom-active');
    zoomAnchor.appendChild(zoomTrigger);

    chrome.appendChild(zoomAnchor);

    zoomUI.labelEl = zoomLabel;
    zoomUI.triggerEl = zoomTrigger;

    // Toggle controls on magnifier click
    zoomTrigger.addEventListener('click', () => {
      if (zoomUI.dismiss) {
        zoomUI.dismiss();
        return;
      }
      controls.classList.remove('hidden');
      const dismiss = () => {
        controls.classList.add('hidden');
        document.removeEventListener('mousedown', onOutside);
        document.removeEventListener('keydown', onEscape);
        zoomUI.dismiss = null;
      };
      const onOutside = (e: MouseEvent) => {
        if (!zoomAnchor.contains(e.target as Node)) dismiss();
      };
      const onEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.stopPropagation(); dismiss(); }
      };
      zoomUI.dismiss = dismiss;
      requestAnimationFrame(() => {
        document.addEventListener('mousedown', onOutside);
        document.addEventListener('keydown', onEscape);
      });
    });

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
        zoomUI.dismiss?.();
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

  // Keyboard shortcuts for zoom — registered via KeybindingManager so they
  // respect setActive() suppression (confirm dialogs, keybinding recording)
  // and are visible to xterm's matchesBinding() pass-through check.
  const guardedZoom = (fn: (tabId: string) => void) => () => {
    const id = activeTabId;
    if (id && containerRef && !containerRef.classList.contains('hidden')) fn(id);
  };

  keybindings.register({ key: '=', ctrl: true, handler: guardedZoom(zoomIn) });
  keybindings.register({ key: '+', ctrl: true, shift: true, handler: guardedZoom(zoomIn) });
  keybindings.register({ key: '-', ctrl: true, handler: guardedZoom(zoomOut) });
  keybindings.register({ key: '0', ctrl: true, handler: guardedZoom(resetZoom) });

  // Listen for zoom shortcuts forwarded from the WebView2 overlay (Rust-side
  // AcceleratorKeyPressed handler) — fires when the overlay has focus and the
  // app's DOM-level keybindings can't see the key events.
  void listen<{ tabId: string; action: string }>(BROWSER_ZOOM_KEY_EVENT, (event) => {
    const { tabId, action } = event.payload;
    switch (action) {
      case 'zoom-in': zoomIn(tabId); break;
      case 'zoom-out': zoomOut(tabId); break;
      case 'zoom-reset': resetZoom(tabId); break;
    }
  });

  logger.info('browser', 'Browser tab content initialised');
}
