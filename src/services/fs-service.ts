import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { IPC_COMMANDS, invokeIpcLogged } from './ipc';

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
  return invokeIpcLogged<DirectoryListing>('fs', IPC_COMMANDS.LIST_DIRECTORY, { path });
}

export async function readTextFile(path: string, maxBytes?: number): Promise<FileContent> {
  return invokeIpcLogged<FileContent>('fs', IPC_COMMANDS.READ_TEXT_FILE, { path, maxBytes: maxBytes ?? null });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invokeIpcLogged<void>('fs', IPC_COMMANDS.WRITE_TEXT_FILE, { path, content });
}

export async function searchFiles(rootPath: string, query: string): Promise<DirEntry[]> {
  return invokeIpcLogged<DirEntry[]>('fs', IPC_COMMANDS.SEARCH_FILES, { rootPath, query });
}

export async function showInExplorer(path: string): Promise<void> {
  await invokeIpcLogged<void>('fs', IPC_COMMANDS.SHOW_IN_EXPLORER, { path });
}

export async function deletePath(path: string): Promise<void> {
  await invokeIpcLogged<void>('fs', IPC_COMMANDS.DELETE_PATH, { path });
}

export async function getFileMtime(path: string): Promise<number> {
  return invokeIpcLogged<number>('fs', IPC_COMMANDS.GET_FILE_MTIME, { path });
}

export async function watchDirectory(path: string): Promise<void> {
  await invokeIpcLogged<void>('fs', IPC_COMMANDS.WATCH_DIRECTORY, { path });
}

export async function unwatchDirectory(): Promise<void> {
  await invokeIpcLogged<void>('fs', IPC_COMMANDS.UNWATCH_DIRECTORY);
}

export function onFsChange(callback: (affectedDir: string) => void): Promise<UnlistenFn> {
  return listen<string>('fs-change', (event) => {
    callback(event.payload);
  });
}
