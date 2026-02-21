import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { IPC_COMMANDS, invokeIpc } from './ipc';
import { logger } from './logger';

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  extension: string;
}

export interface DirectoryListing {
  path: string;
  entries: DirEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

export async function listDirectory(path: string): Promise<DirectoryListing> {
  logger.debug('fs', 'IPC: list_directory', { path });
  return invokeIpc<DirectoryListing>(IPC_COMMANDS.LIST_DIRECTORY, { path });
}

export async function readTextFile(path: string, maxBytes?: number): Promise<FileContent> {
  logger.debug('fs', 'IPC: read_text_file', { path, maxBytes });
  return invokeIpc<FileContent>(IPC_COMMANDS.READ_TEXT_FILE, { path, maxBytes: maxBytes ?? null });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  logger.debug('fs', 'IPC: write_text_file', { path });
  await invokeIpc<void>(IPC_COMMANDS.WRITE_TEXT_FILE, { path, content });
}

export async function searchFiles(rootPath: string, query: string): Promise<DirEntry[]> {
  logger.debug('fs', 'IPC: search_files', { rootPath, query });
  return invokeIpc<DirEntry[]>(IPC_COMMANDS.SEARCH_FILES, { rootPath, query });
}

export async function showInExplorer(path: string): Promise<void> {
  logger.debug('fs', 'IPC: show_in_explorer', { path });
  await invokeIpc<void>(IPC_COMMANDS.SHOW_IN_EXPLORER, { path });
}

export async function deletePath(path: string): Promise<void> {
  logger.debug('fs', 'IPC: delete_path', { path });
  await invokeIpc<void>(IPC_COMMANDS.DELETE_PATH, { path });
}

export async function getFileMtime(path: string): Promise<number> {
  logger.debug('fs', 'IPC: get_file_mtime', { path });
  return invokeIpc<number>(IPC_COMMANDS.GET_FILE_MTIME, { path });
}

export async function watchDirectory(path: string): Promise<void> {
  logger.debug('fs', 'IPC: watch_directory', { path });
  await invokeIpc<void>(IPC_COMMANDS.WATCH_DIRECTORY, { path });
}

export async function unwatchDirectory(): Promise<void> {
  logger.debug('fs', 'IPC: unwatch_directory');
  await invokeIpc<void>(IPC_COMMANDS.UNWATCH_DIRECTORY);
}

export function onFsChange(callback: (affectedDir: string) => void): Promise<UnlistenFn> {
  return listen<string>('fs-change', (event) => {
    callback(event.payload);
  });
}
