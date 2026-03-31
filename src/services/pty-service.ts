import { Channel } from '@tauri-apps/api/core';
import { logger } from './logger';
import { IPC_COMMANDS, invokeIpc, invokeIpcLogged } from './ipc';
import type { PtySessionInfo } from '../state/types';
import { decodeBase64ToBytes } from '../utils/base64';

interface CreateSessionOptions {
  projectPath: string;
  shellPath?: string;
  rows: number;
  cols: number;
}

export async function createPtySession(
  opts: CreateSessionOptions,
  onOutput: (data: Uint8Array) => void,
  onExit: () => void,
): Promise<PtySessionInfo> {
  logger.debug('pty', 'IPC: create_session', {
    path: opts.projectPath,
    shell: opts.shellPath,
    rows: opts.rows,
    cols: opts.cols,
  });
  const channel = new Channel<string>();
  channel.onmessage = (base64) => {
    onOutput(decodeBase64ToBytes(base64));
  };

  const exitChannel = new Channel<boolean>();
  exitChannel.onmessage = () => {
    onExit();
  };

  const info = await invokeIpc<PtySessionInfo>(IPC_COMMANDS.CREATE_SESSION, {
    projectPath: opts.projectPath,
    shellPath: opts.shellPath ?? null,
    rows: opts.rows,
    cols: opts.cols,
    onOutput: channel,
    onExit: exitChannel,
  });
  logger.debug('pty', 'IPC: create_session result', { id: info.id, pid: info.pid });
  return info;
}

export function writeToPtySession(sessionId: string, data: string): void {
  invokeIpc<void>(IPC_COMMANDS.WRITE_TO_SESSION, { sessionId, data }).catch((err) => {
    logger.debug('pty', 'write_to_session failed (session may have exited)', { sessionId, error: String(err) });
  });
}

export async function resizePtySession(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  await invokeIpcLogged<void>('pty', IPC_COMMANDS.RESIZE_SESSION, { sessionId, rows, cols });
}

export async function killPtySession(sessionId: string): Promise<void> {
  await invokeIpcLogged<void>('pty', IPC_COMMANDS.KILL_SESSION, { sessionId }, 'info');
}

// --- Backend-to-frontend session ID mapping for process monitor events ---

interface BackendSessionMapping {
  projectId: string;
  sessionId: string;
  paneId: string;
}

const backendToFrontend = new Map<string, BackendSessionMapping>();

export function registerBackendSession(
  backendId: string,
  projectId: string,
  sessionId: string,
  paneId: string,
): void {
  backendToFrontend.set(backendId, { projectId, sessionId, paneId });
}

export function unregisterBackendSession(backendId: string): void {
  backendToFrontend.delete(backendId);
}

export function lookupBackendSession(backendId: string): BackendSessionMapping | undefined {
  return backendToFrontend.get(backendId);
}
