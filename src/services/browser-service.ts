import { IPC_COMMANDS, invokeIpcLogged } from './ipc';

export function createBrowserWebview(
  tabId: string, url: string, x: number, y: number, width: number, height: number,
): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.CREATE_BROWSER_WEBVIEW, { tabId, url, x, y, width, height });
}

export function showBrowserWebview(tabId: string): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.SHOW_BROWSER_WEBVIEW, { tabId });
}

export function hideBrowserWebview(tabId: string): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.HIDE_BROWSER_WEBVIEW, { tabId });
}

export function navigateBrowser(tabId: string, url: string): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.NAVIGATE_BROWSER, { tabId, url });
}

export function reloadBrowser(tabId: string): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.RELOAD_BROWSER, { tabId });
}

export function resizeBrowserWebview(
  tabId: string, x: number, y: number, width: number, height: number,
): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.RESIZE_BROWSER_WEBVIEW, { tabId, x, y, width, height });
}

export function closeBrowserWebview(tabId: string): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.CLOSE_BROWSER_WEBVIEW, { tabId });
}

export function browserGoBack(tabId: string): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.BROWSER_GO_BACK, { tabId });
}

export function browserGoForward(tabId: string): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.BROWSER_GO_FORWARD, { tabId });
}

export function captureBrowserScreenshot(tabId: string): Promise<string> {
  return invokeIpcLogged('browser', IPC_COMMANDS.CAPTURE_BROWSER_SCREENSHOT, { tabId });
}

export function setBrowserZoom(tabId: string, zoomFactor: number): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.SET_BROWSER_ZOOM, { tabId, zoomFactor });
}

export function setBrowserPoolSize(size: number): Promise<void> {
  return invokeIpcLogged('browser', IPC_COMMANDS.SET_BROWSER_POOL_SIZE, { size });
}
