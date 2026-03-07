import { invoke } from '@tauri-apps/api/core';
import { logger, type LogCategory } from './logger';

export const IPC_COMMANDS = {
  CREATE_SESSION: 'create_session',
  WRITE_TO_SESSION: 'write_to_session',
  RESIZE_SESSION: 'resize_session',
  KILL_SESSION: 'kill_session',
  GET_SYSTEM_STATS: 'get_system_stats',
  GIT_PROJECT_STATUS: 'git_project_status',
  GIT_STATUS: 'git_status',
  GIT_LOG: 'git_log',
  GIT_DIFF: 'git_diff',
  GIT_STAGE_ALL: 'git_stage_all',
  GIT_COMMIT: 'git_commit',
  GIT_PUSH: 'git_push',
  GIT_REMOVE_LOCK_FILE: 'git_remove_lock_file',
  LIST_DIRECTORY: 'list_directory',
  READ_TEXT_FILE: 'read_text_file',
  WRITE_TEXT_FILE: 'write_text_file',
  WRITE_TEXT_FILE_IF_UNMODIFIED: 'write_text_file_if_unmodified',
  SEARCH_FILES: 'search_files',
  SHOW_IN_EXPLORER: 'show_in_explorer',
  DELETE_PATH: 'delete_path',
  GET_FILE_MTIME: 'get_file_mtime',
  WATCH_DIRECTORY: 'watch_directory',
  UNWATCH_DIRECTORY: 'unwatch_directory',
  CREATE_BROWSER_WEBVIEW: 'create_browser_webview',
  SHOW_BROWSER_WEBVIEW: 'show_browser_webview',
  HIDE_BROWSER_WEBVIEW: 'hide_browser_webview',
  NAVIGATE_BROWSER: 'navigate_browser',
  RESIZE_BROWSER_WEBVIEW: 'resize_browser_webview',
  CLOSE_BROWSER_WEBVIEW: 'close_browser_webview',
  BROWSER_GO_BACK: 'browser_go_back',
  BROWSER_GO_FORWARD: 'browser_go_forward',
  BROWSER_WEBVIEW_IS_ALIVE: 'browser_webview_is_alive',
  CAPTURE_BROWSER_SCREENSHOT: 'capture_browser_screenshot',
  SET_BROWSER_POOL_SIZE: 'set_browser_pool_size',
} as const;

type IpcCommand = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS];

export function invokeIpc<T>(command: IpcCommand, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

type IpcLogLevel = 'debug' | 'info';

export function invokeIpcLogged<T>(
  category: LogCategory,
  command: IpcCommand,
  args?: Record<string, unknown>,
  level: IpcLogLevel = 'debug',
): Promise<T> {
  const message = `IPC: ${command}`;
  if (level === 'info') {
    logger.info(category, message, args);
  } else {
    logger.debug(category, message, args);
  }
  return invokeIpc<T>(command, args);
}
