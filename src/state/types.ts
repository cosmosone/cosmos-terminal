export interface AppState {
  projects: Project[];
  activeProjectId: string | null;
  settings: AppSettings;
  view: 'terminal' | 'settings';
  gitSidebar: GitSidebarState;
  gitStates: Record<string, ProjectGitState>;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  sessions: Session[];
  activeSessionId: string | null;
}

export interface Session {
  id: string;
  title: string;
  paneTree: PaneNode;
  activePaneId: string | null;
  hasActivity: boolean;
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
  closeTerminalTab: string;
  closeProjectTab: string;
  scrollToBottom: string;
}

export interface AppSettings {
  shellPath: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  uiFontFamily: string;
  uiFontSize: number;
  scrollbackLines: number;
  copyOnSelect: boolean;
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

export type StateListener<T> = (value: T) => void;
export type StateSelector<T> = (state: AppState) => T;
export type StateUpdater = (state: AppState) => AppState;
