import { IPC_COMMANDS, invokeIpcLogged } from './ipc';
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

export async function getGitProjectStatus(path: string): Promise<GitStatusResult | null> {
  return invokeIpcLogged<GitStatusResult | null>('git', IPC_COMMANDS.GIT_PROJECT_STATUS, { path });
}

export async function getGitStatus(path: string): Promise<GitStatusResult> {
  return invokeIpcLogged<GitStatusResult>('git', IPC_COMMANDS.GIT_STATUS, { path });
}

export async function getGitLog(path: string, limit?: number): Promise<GitLogEntry[]> {
  return invokeIpcLogged<GitLogEntry[]>('git', IPC_COMMANDS.GIT_LOG, { path, limit: limit ?? null });
}

export async function getGitDiff(path: string): Promise<string> {
  return invokeIpcLogged<string>('git', IPC_COMMANDS.GIT_DIFF, { path });
}

export async function gitStageAll(path: string): Promise<void> {
  await invokeIpcLogged<void>('git', IPC_COMMANDS.GIT_STAGE_ALL, { path }, 'info');
}

export async function gitCommit(path: string, message: string): Promise<GitCommitResult> {
  return invokeIpcLogged<GitCommitResult>('git', IPC_COMMANDS.GIT_COMMIT, { path, message }, 'info');
}

export async function gitPush(path: string): Promise<GitPushResult> {
  return invokeIpcLogged<GitPushResult>('git', IPC_COMMANDS.GIT_PUSH, { path }, 'info');
}
