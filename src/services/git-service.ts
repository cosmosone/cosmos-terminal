import { invoke } from '@tauri-apps/api/core';
import { logger } from './logger';
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
  return invoke<boolean>('git_is_repo', { path });
}

export async function getGitStatus(path: string): Promise<GitStatusResult> {
  logger.debug('git', 'IPC: git_status', { path });
  return invoke<GitStatusResult>('git_status', { path });
}

export async function getGitLog(path: string, limit?: number): Promise<GitLogEntry[]> {
  logger.debug('git', 'IPC: git_log', { path, limit });
  return invoke<GitLogEntry[]>('git_log', { path, limit: limit ?? null });
}

export async function getGitDiff(path: string): Promise<string> {
  logger.debug('git', 'IPC: git_diff', { path });
  return invoke<string>('git_diff', { path });
}

export async function gitStageAll(path: string): Promise<void> {
  logger.info('git', 'IPC: git_stage_all', { path });
  await invoke('git_stage_all', { path });
}

export async function gitCommit(path: string, message: string): Promise<GitCommitResult> {
  logger.info('git', 'IPC: git_commit', { path, message });
  return invoke<GitCommitResult>('git_commit', { path, message });
}

export async function gitPush(path: string): Promise<GitPushResult> {
  logger.info('git', 'IPC: git_push', { path });
  return invoke<GitPushResult>('git_push', { path });
}
