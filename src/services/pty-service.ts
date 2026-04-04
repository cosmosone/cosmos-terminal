import { Channel } from '@tauri-apps/api/core';
import { logger } from './logger';
import { IPC_COMMANDS, invokeIpc, invokeIpcLogged } from './ipc';
import type { PtySessionInfo } from '../state/types';
import { decodeBase64ToBytes } from '../utils/base64';

interface CreateSessionOptions {
  paneId: string;
  projectPath: string;
  shellPath?: string;
  rows: number;
  cols: number;
}

function createPtyChannels(
  onOutput: (data: Uint8Array) => void,
  onExit: () => void,
): { onOutput: Channel<string>; onExit: Channel<boolean> } {
  const channel = new Channel<string>();
  channel.onmessage = (base64) => {
    onOutput(decodeBase64ToBytes(base64));
  };
  const exitChannel = new Channel<boolean>();
  exitChannel.onmessage = () => {
    onExit();
  };
  return { onOutput: channel, onExit: exitChannel };
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
  const channels = createPtyChannels(onOutput, onExit);

  const info = await invokeIpc<PtySessionInfo>(IPC_COMMANDS.CREATE_SESSION, {
    paneId: opts.paneId,
    projectPath: opts.projectPath,
    shellPath: opts.shellPath ?? null,
    rows: opts.rows,
    cols: opts.cols,
    ...channels,
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

async function listPtySessions(): Promise<PtySessionInfo[]> {
  return invokeIpcLogged<PtySessionInfo[]>('pty', IPC_COMMANDS.LIST_SESSIONS, {});
}

/**
 * Query the backend for all live sessions and build a paneId → backendId
 * reconnection map.  Also returns the raw session list so callers can
 * pass it to {@link cleanupOrphanedSessions} without a second IPC call.
 */
export async function buildReconnectionMap(): Promise<{ map: Map<string, string>; sessions: PtySessionInfo[] }> {
  const sessions = await listPtySessions();
  const map = new Map<string, string>();
  for (const s of sessions) {
    map.set(s.paneId, s.id);
  }
  return { map, sessions };
}

/**
 * Kill backend PTY sessions whose paneId doesn't match any known pane in the
 * frontend state tree.
 *
 * @param knownPaneIds All paneIds from all projects/sessions in the state tree.
 * @param backendSessions Pre-fetched session list (avoids a second IPC call).
 */
export async function cleanupOrphanedSessions(
  knownPaneIds: Set<string>,
  backendSessions: PtySessionInfo[],
): Promise<void> {
  try {
    const orphans = backendSessions.filter((s) => !knownPaneIds.has(s.paneId));
    if (orphans.length === 0) return;
    await Promise.all(orphans.map((sess) => {
      logger.info('pty', 'Killing orphaned backend session', { backendId: sess.id, paneId: sess.paneId, pid: sess.pid });
      return killPtySession(sess.id).catch((err) => {
        logger.warn('pty', 'Failed to kill orphaned session', { backendId: sess.id, error: String(err) });
      });
    }));
    logger.info('pty', `Cleaned up ${orphans.length} orphaned PTY session(s)`);
  } catch (err) {
    logger.warn('pty', 'Failed to clean up orphaned sessions', { error: String(err) });
  }
}

export async function reconnectPtySession(
  sessionId: string,
  onOutput: (data: Uint8Array) => void,
  onExit: () => void,
  skipReplay = false,
): Promise<void> {
  await invokeIpc<void>(IPC_COMMANDS.RECONNECT_SESSION, {
    sessionId,
    skipReplay,
    ...createPtyChannels(onOutput, onExit),
  });
  logger.info('pty', 'Reconnected to session', { sessionId });
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
