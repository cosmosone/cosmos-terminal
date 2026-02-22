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
  tabActivationSeq?: number;
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
  debugLogging: boolean;
  debugLoggingExpiry: string | null;
  confirmCloseTerminalTab: boolean;
  confirmCloseProjectTab: boolean;
  keybindings: KeybindingConfig;
  openaiApiKey: string;
}

export interface PtySessionInfo {
  id: string;
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

export interface FileBrowserSidebarState {
  visible: boolean;
  width: number;
  expandedPaths: string[];
}

export type StateListener<T> = (value: T) => void;
export type StateSelector<T> = (state: AppState) => T;
export type StateUpdater = (state: AppState) => AppState;
