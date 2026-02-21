import { logger } from './logger';
import { IPC_COMMANDS, invokeIpc } from './ipc';
import type { GitStatusResult, GitLogEntry } from '../state/types';

interface GitCommitResult {
  success: boolean;
  commitId: string;
  message: string;
}

interface GitPushResult {
  success: boolean;
  message: string;
}

export async function isGitRepo(path: string): Promise<boolean> {
  return invokeIpc<boolean>(IPC_COMMANDS.GIT_IS_REPO, { path });
}

export async function getGitStatus(path: string): Promise<GitStatusResult> {
  logger.debug('git', 'IPC: git_status', { path });
  return invokeIpc<GitStatusResult>(IPC_COMMANDS.GIT_STATUS, { path });
}

export async function getGitLog(path: string, limit?: number): Promise<GitLogEntry[]> {
  logger.debug('git', 'IPC: git_log', { path, limit });
  return invokeIpc<GitLogEntry[]>(IPC_COMMANDS.GIT_LOG, { path, limit: limit ?? null });
}

export async function getGitDiff(path: string): Promise<string> {
  logger.debug('git', 'IPC: git_diff', { path });
  return invokeIpc<string>(IPC_COMMANDS.GIT_DIFF, { path });
}

export async function gitStageAll(path: string): Promise<void> {
  logger.info('git', 'IPC: git_stage_all', { path });
  await invokeIpc<void>(IPC_COMMANDS.GIT_STAGE_ALL, { path });
}

export async function gitCommit(path: string, message: string): Promise<GitCommitResult> {
  logger.info('git', 'IPC: git_commit', { path, message });
  return invokeIpc<GitCommitResult>(IPC_COMMANDS.GIT_COMMIT, { path, message });
}

export async function gitPush(path: string): Promise<GitPushResult> {
  logger.info('git', 'IPC: git_push', { path });
  return invokeIpc<GitPushResult>(IPC_COMMANDS.GIT_PUSH, { path });
}
