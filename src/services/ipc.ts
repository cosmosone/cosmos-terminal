import { invoke } from '@tauri-apps/api/core';

export const IPC_COMMANDS = {
  CREATE_SESSION: 'create_session',
  WRITE_TO_SESSION: 'write_to_session',
  RESIZE_SESSION: 'resize_session',
  KILL_SESSION: 'kill_session',
  GET_SYSTEM_STATS: 'get_system_stats',
  GIT_IS_REPO: 'git_is_repo',
  GIT_STATUS: 'git_status',
  GIT_LOG: 'git_log',
  GIT_DIFF: 'git_diff',
  GIT_STAGE_ALL: 'git_stage_all',
  GIT_COMMIT: 'git_commit',
  GIT_PUSH: 'git_push',
  LIST_DIRECTORY: 'list_directory',
  READ_TEXT_FILE: 'read_text_file',
  WRITE_TEXT_FILE: 'write_text_file',
  SEARCH_FILES: 'search_files',
  SHOW_IN_EXPLORER: 'show_in_explorer',
  DELETE_PATH: 'delete_path',
  GET_FILE_MTIME: 'get_file_mtime',
  WATCH_DIRECTORY: 'watch_directory',
  UNWATCH_DIRECTORY: 'unwatch_directory',
} as const;

export type IpcCommand = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS];

export function invokeIpc<T>(command: IpcCommand, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}
