export interface AppState {
  projects: Project[];
  activeProjectId: string | null;
  settings: AppSettings;
  view: 'terminal' | 'settings';
  gitSidebar: GitSidebarState;
  fileBrowserSidebar: FileBrowserSidebarState;
  gitStates: Record<string, ProjectGitState>;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  sessions: Session[];
  activeSessionId: string | null;
  tabs: FileTab[];
  activeTabId: string | null;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string | null;
  tabActivationSeq?: number;
  runCommand?: string;
  showRunButton?: boolean;
}

export interface Session {
  id: string;
  title: string;
  agentCommand?: string;
  paneTree: PaneNode;
  activePaneId: string | null;
  hasActivity: boolean;
  activityCompleted: boolean;
  locked: boolean;
  muted: boolean;
}

export type PaneNode = PaneLeaf | PaneBranch;

export interface PaneLeaf {
  type: 'leaf';
  paneId: string;
}

export interface PaneBranch {
  type: 'branch';
  direction: 'horizontal' | 'vertical';
  children: PaneNode[];
  ratios: number[];
}

export interface KeybindingConfig {
  newSession: string;
  toggleSettings: string;
  navigatePaneLeft: string;
  navigatePaneRight: string;
  navigatePaneUp: string;
  navigatePaneDown: string;
  splitDown: string;
  splitUp: string;
  splitLeft: string;
  splitRight: string;
  cycleSessionNext: string;
  cycleSessionPrev: string;
  cycleProjectNext: string;
  cycleProjectPrev: string;
  toggleGitSidebar: string;
  toggleFileBrowser: string;
  searchFileBrowser: string;
  closeTerminalTab: string;
  closeProjectTab: string;
  scrollToBottom: string;
  findInDocument: string;
  renameTab: string;
}

export interface AppSettings {
  shellPath: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  uiFontFamily: string;
  uiFontSize: number;
  viewerFontSize: number;
  editorFontSize: number;
  scrollbackLines: number;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  shiftEnterAsCtrlEnter: boolean;
  ctrlShiftVAsAltV: boolean;
  debugLogging: boolean;
  debugLoggingExpiry: string | null;
  confirmCloseTerminalTab: boolean;
  confirmCloseProjectTab: boolean;
  keybindings: KeybindingConfig;
  openaiApiKey: string;
  browserHomePage: string;
  browserPoolSize: number;
}

export interface PtySessionInfo {
  id: string;
  paneId: string;
  pid: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Git types ---

export type GitFileStatusKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

export interface GitFileStatus {
  path: string;
  status: GitFileStatusKind;
  staged: boolean;
}

export interface GitStatusResult {
  branch: string;
  dirty: boolean;
  files: GitFileStatus[];
  ahead: number;
  committedFiles: GitFileStatus[];
}

export interface GitLogEntry {
  id: string;
  fullId: string;
  message: string;
  body: string;
  author: string;
  authorEmail: string;
  timestamp: number;
  refsList: string[];
}

export type GitNotificationType = 'info' | 'warning' | 'error';

export interface GitNotification {
  message: string;
  type: GitNotificationType;
}

export interface ProjectGitState {
  isRepo: boolean | null;
  status: GitStatusResult | null;
  log: GitLogEntry[];
  loading: boolean;
  loadingLabel?: string;
  error: string | null;
  commitMessage: string;
  generating: boolean;
  generatingLabel: string;
  notification: GitNotification | null;
}

export interface GitSidebarState {
  visible: boolean;
  width: number;
  expandedProjectIds: string[];
  activeProjectId: string | null;
  graphExpanded: boolean;
}

// --- File browser types ---

export interface FileTab {
  id: string;
  title: string;
  filePath: string;
  fileType: string;
  editing: boolean;
  dirty: boolean;
  locked: boolean;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  locked: boolean;
  /** Runtime-only loading indicator (not persisted). */
  loading?: boolean;
  /** Zoom factor (1.0 = 100%). Persisted across sessions. */
  zoomFactor?: number;
  /** Runtime-only favicon URL extracted from the page (not persisted). */
  faviconUrl?: string;
}

/** Event name emitted by the Rust backend on webview navigation. */
export const BROWSER_NAVIGATED_EVENT = 'browser-navigated';

/** Event name emitted by the Rust backend when a page title is available. */
export const BROWSER_TITLE_CHANGED_EVENT = 'browser-title-changed';

/** Event name emitted by the Rust backend when a page favicon is detected. */
export const BROWSER_FAVICON_CHANGED_EVENT = 'browser-favicon-changed';

/** Event name emitted by the Rust backend when a zoom shortcut is pressed in the WebView2 overlay. */
export const BROWSER_ZOOM_KEY_EVENT = 'browser-zoom-key';

/** Event name emitted by the Rust backend when a session's child process state changes. */
export const SESSION_CHILDREN_CHANGED_EVENT = 'session-children-changed';

/** Payload shape for `session-children-changed` events (mirrors Rust `SessionChildrenEvent`). */
export interface SessionChildrenEvent {
  sessionId: string;
  hasChildren: boolean;
}

/** Event name emitted by the Rust backend on filesystem changes. */
export const FS_CHANGE_EVENT = 'fs-change';

/** Event name emitted when external frontend assets on disk are updated. */
export const FRONTEND_UPDATED_EVENT = 'frontend-updated';

/** Payload shape for `browser-navigated` events (mirrors Rust `BrowserNavEvent`). */
export interface BrowserNavEvent {
  tabId: string;
  url: string;
  loading: boolean;
}

/** Payload shape for `browser-title-changed` events (mirrors Rust `BrowserTitleEvent`). */
export interface BrowserTitleEvent {
  tabId: string;
  title: string;
}

/** Payload shape for `browser-favicon-changed` events (mirrors Rust `BrowserFaviconEvent`). */
export interface BrowserFaviconEvent {
  tabId: string;
  faviconUrl: string;
}

export interface FileBrowserSidebarState {
  visible: boolean;
  width: number;
  expandedPaths: string[];
}

export type StateListener<T> = (value: T) => void;
export type StateSelector<T> = (state: AppState) => T;
export type StateUpdater = (state: AppState) => AppState;
