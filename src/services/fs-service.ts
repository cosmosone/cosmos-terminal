import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
  return invoke<DirectoryListing>('list_directory', { path });
}

export async function readTextFile(path: string, maxBytes?: number): Promise<FileContent> {
  logger.debug('fs', 'IPC: read_text_file', { path, maxBytes });
  return invoke<FileContent>('read_text_file', { path, maxBytes: maxBytes ?? null });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  logger.debug('fs', 'IPC: write_text_file', { path });
  await invoke('write_text_file', { path, content });
}

export async function searchFiles(rootPath: string, query: string): Promise<DirEntry[]> {
  logger.debug('fs', 'IPC: search_files', { rootPath, query });
  return invoke<DirEntry[]>('search_files', { rootPath, query });
}

export async function showInExplorer(path: string): Promise<void> {
  logger.debug('fs', 'IPC: show_in_explorer', { path });
  await invoke('show_in_explorer', { path });
}

export async function deletePath(path: string): Promise<void> {
  logger.debug('fs', 'IPC: delete_path', { path });
  await invoke('delete_path', { path });
}

export async function watchDirectory(path: string): Promise<void> {
  logger.debug('fs', 'IPC: watch_directory', { path });
  await invoke('watch_directory', { path });
}

export async function unwatchDirectory(): Promise<void> {
  logger.debug('fs', 'IPC: unwatch_directory');
  await invoke('unwatch_directory');
}

export function onFsChange(callback: (affectedDir: string) => void): Promise<UnlistenFn> {
  return listen<string>('fs-change', (event) => {
    callback(event.payload);
  });
}
