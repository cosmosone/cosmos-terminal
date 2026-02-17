import { invoke, Channel } from '@tauri-apps/api/core';
import { logger } from './logger';
import type { PtySessionInfo } from '../state/types';

export interface CreateSessionOptions {
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
  logger.debug('pty', 'IPC: create_session', { path: opts.projectPath, shell: opts.shellPath, rows: opts.rows, cols: opts.cols });
  const channel = new Channel<string>();
  channel.onmessage = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    onOutput(bytes);
  };

  const exitChannel = new Channel<boolean>();
  exitChannel.onmessage = () => {
    onExit();
  };

  const info = await invoke<PtySessionInfo>('create_session', {
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
  invoke('write_to_session', { sessionId, data }).catch((err) => {
    logger.debug('pty', 'write_to_session failed (session may have exited)', { sessionId, error: String(err) });
  });
}

export async function resizePtySession(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  logger.debug('pty', 'IPC: resize_session', { sessionId, rows, cols });
  await invoke('resize_session', { sessionId, rows, cols });
}

export async function killPtySession(sessionId: string): Promise<void> {
  logger.info('pty', 'IPC: kill_session', { sessionId });
  await invoke('kill_session', { sessionId });
}
