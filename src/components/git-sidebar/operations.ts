import { store } from '../../state/store';
import {
  updateGitState,
  setCommitMessage,
  setGenerating,
  defaultGitState,
} from '../../state/actions';
import {
  getGitProjectStatus,
  getGitStatus,
  getGitLog,
  getGitDiff,
  gitStageAll,
  gitCommit,
  gitPush,
  gitRemoveLockFile,
} from '../../services/git-service';
import { showConfirmDialog } from '../confirm-dialog';
import { generateCommitMessage } from '../../services/openai-service';
import { logger } from '../../services/logger';
import { statusEquals } from './shared';
import type { Project, ProjectGitState, GitNotificationType } from '../../state/types';

export interface GitSidebarOperations {
  pruneLocalCommitMessages(validProjectIds: Set<string>): void;
  refreshProject(project: Project, silent?: boolean): Promise<void>;
  fetchLog(project: Project): Promise<void>;
  refreshAllProjects(silent?: boolean): Promise<void>;
  generateCommitMessage(project: Project): Promise<void>;
  doCommit(project: Project, push: boolean): Promise<void>;
  doPush(project: Project): Promise<void>;
}

interface GitSidebarOperationsDeps {
  localCommitMessages: Map<string, string>;
  showNotification: (projectId: string, message: string, type: GitNotificationType, durationMs?: number) => void;
}

export function createGitSidebarOperations(deps: GitSidebarOperationsDeps): GitSidebarOperations {
  /** Per-project promise chain — serialises git operations to avoid index.lock conflicts. */
  const projectLocks = new Map<string, Promise<void>>();

  /** Serialises `fn` behind any in-flight operation for this project. User operations queue here. */
  async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = projectLocks.get(projectId) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    projectLocks.set(projectId, next);
    try {
      await prev;
      return await fn();
    } finally {
      resolve();
      if (projectLocks.get(projectId) === next) projectLocks.delete(projectId);
    }
  }

  /** If the project has an unresolved lock, returns `undefined` (skip). Otherwise behaves like `withProjectLock`. */
  function tryWithProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> | undefined {
    if (projectLocks.has(projectId)) return undefined;
    return withProjectLock(projectId, fn);
  }

  function getProjectGitState(projectId: string): ProjectGitState {
    return store.getState().gitStates[projectId] || defaultGitState();
  }

  /** Fetch fresh status + log in parallel, then apply them with any extra partial state atomically. */
  async function refreshAndUpdate(project: Project, extra: Partial<ProjectGitState> = {}): Promise<void> {
    const [status, log] = await Promise.all([
      getGitStatus(project.path),
      getGitLog(project.path, 50),
    ]);
    updateGitState(project.id, { loading: false, loadingLabel: undefined, status, log, ...extra });
  }

  function clearCommitMessage(projectId: string): void {
    deps.localCommitMessages.delete(projectId);
    setCommitMessage(projectId, '');
  }

  function pruneLocalCommitMessages(validProjectIds: Set<string>): void {
    for (const key of deps.localCommitMessages.keys()) {
      if (!validProjectIds.has(key)) deps.localCommitMessages.delete(key);
    }
  }

  async function refreshProjectInner(project: Project, silent: boolean): Promise<void> {
    const existingState = store.getState().gitStates[project.id];
    if (existingState?.isRepo === false) return;

    const needsDiscovery = !existingState || existingState.isRepo === null;

    if (!silent) {
      updateGitState(project.id, { loading: true, error: null });
    }
    try {
      let status;
      if (needsDiscovery) {
        const result = await getGitProjectStatus(project.path);
        if (!result) {
          const payload: Partial<ProjectGitState> = { isRepo: false };
          if (!silent) payload.loading = false;
          updateGitState(project.id, payload);
          return;
        }
        status = result;
      } else {
        status = await getGitStatus(project.path);
      }
      const existing = store.getState().gitStates[project.id];
      if (existing && statusEquals(existing.status, status)) {
        if (!silent) updateGitState(project.id, { loading: false });
        return;
      }
      const updatePayload: Partial<ProjectGitState> = { isRepo: true, status };
      if (!silent) updatePayload.loading = false;
      updateGitState(project.id, updatePayload);
    } catch (err: unknown) {
      if (silent) {
        logger.error('git', 'Silent refresh failed', {
          projectId: project.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      updateGitState(project.id, { isRepo: true, loading: false, error: err instanceof Error ? err.message : 'Failed to get status' });
    }
  }

  async function refreshProject(project: Project, silent = false): Promise<void> {
    if (silent) {
      const result = tryWithProjectLock(project.id, () => refreshProjectInner(project, true));
      if (result) await result;
    } else {
      await withProjectLock(project.id, () => refreshProjectInner(project, false));
    }
  }

  async function fetchLog(project: Project): Promise<void> {
    try {
      const log = await getGitLog(project.path, 50);
      updateGitState(project.id, { log });
    } catch (err: unknown) {
      logger.error('git', 'Failed to fetch log', { projectId: project.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function refreshAllProjects(silent = false): Promise<void> {
    const projects = store.getState().projects;
    await Promise.all(projects.map((p) => {
      if (silent && getProjectGitState(p.id).loading) return;
      return refreshProject(p, silent);
    }));
  }

  async function generateCommitMessageForProject(project: Project): Promise<void> {
    if (getProjectGitState(project.id).generating) return;

    await withProjectLock(project.id, async () => {
      setGenerating(project.id, true, 'Generating...');
      try {
        const diff = await getGitDiff(project.path);
        if (!diff.trim()) {
          clearCommitMessage(project.id);
          return;
        }
        const message = await generateCommitMessage(diff, (label) => {
          setGenerating(project.id, true, label);
        });
        deps.localCommitMessages.set(project.id, message);
        setCommitMessage(project.id, message);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to generate commit message';
        logger.error('git', 'Generate commit message failed', errorMsg);
        updateGitState(project.id, { error: errorMsg });
        setTimeout(() => {
          const current = store.getState().gitStates[project.id];
          if (current?.error === errorMsg) updateGitState(project.id, { error: null });
        }, 5000);
      } finally {
        setGenerating(project.id, false);
      }
    });
  }

  function isLockFileError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('lock') && (lower.includes('file') || lower.includes('index'));
  }

  /** Show lock-file confirm dialog, remove the lock if confirmed, and retry the operation. */
  async function handleLockFileRetry(
    project: Project,
    operation: string,
    retryFn: () => Promise<void>,
  ): Promise<void> {
    const { confirmed } = await showConfirmDialog({
      title: 'Git Lock File Detected',
      message: `A git lock file is preventing the ${operation}. This usually means a previous git operation was interrupted. Would you like to remove the lock file and retry?`,
      confirmText: 'Remove & Retry',
      cancelText: 'Cancel',
      danger: true,
    });
    if (confirmed) {
      try {
        await gitRemoveLockFile(project.path);
        logger.info('git', 'Removed git lock file', { projectId: project.id });
        await retryFn();
      } catch (removeErr: unknown) {
        deps.showNotification(project.id, removeErr instanceof Error ? removeErr.message : 'Failed to remove lock file', 'error');
      }
    }
  }

  async function doCommit(project: Project, push: boolean): Promise<void> {
    const gs = getProjectGitState(project.id);
    if (gs.loading) return;

    const message = (deps.localCommitMessages.get(project.id) ?? gs.commitMessage).trim();
    if (!message) {
      deps.showNotification(project.id, 'Please enter a commit message.', 'warning');
      return;
    }

    let lockFileDetected = false;

    await withProjectLock(project.id, async () => {
      const loadingLabel = push ? 'Commit & Push' : 'Commit';
      updateGitState(project.id, { loading: true, loadingLabel, error: null, notification: null });
      try {
        await gitStageAll(project.path);
        const result = await gitCommit(project.path, message);
        logger.info('git', 'Commit created', { projectId: project.id, commitId: result.commitId });

        let pushFailed = '';
        if (push) {
          const pushResult = await gitPush(project.path);
          if (pushResult.success) {
            logger.info('git', 'Push completed', { projectId: project.id });
          } else {
            pushFailed = pushResult.message;
          }
        }

        deps.localCommitMessages.delete(project.id);
        await refreshAndUpdate(project, { commitMessage: '' });

        if (pushFailed) {
          deps.showNotification(project.id, `Committed, but push failed: ${pushFailed}`, 'error', 8000);
        }
      } catch (err: unknown) {
        updateGitState(project.id, { loading: false, loadingLabel: undefined });
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (isLockFileError(errorMsg)) {
          lockFileDetected = true;
          return;
        }

        deps.showNotification(project.id, errorMsg, 'error');
      }
    });

    if (lockFileDetected) {
      await handleLockFileRetry(project, 'commit', () => doCommit(project, push));
    }
  }

  async function doPush(project: Project): Promise<void> {
    const gs = getProjectGitState(project.id);
    if (gs.loading) return;

    if (gs.status?.dirty) {
      deps.showNotification(project.id, 'You have uncommitted changes. Commit first, or use Commit & Push.', 'warning');
      return;
    }

    let lockFileDetected = false;

    await withProjectLock(project.id, async () => {
      updateGitState(project.id, { loading: true, loadingLabel: 'Push', error: null, notification: null });
      try {
        const pushResult = await gitPush(project.path);

        if (!pushResult.success) {
          updateGitState(project.id, { loading: false, loadingLabel: undefined });
          if (isLockFileError(pushResult.message)) {
            lockFileDetected = true;
            return;
          }
          deps.showNotification(project.id, `Push failed: ${pushResult.message}`, 'error');
          return;
        }

        const msg = pushResult.message.toLowerCase();
        if (msg.includes('up-to-date') || msg.includes('up to date')) {
          updateGitState(project.id, { loading: false, loadingLabel: undefined });
          deps.showNotification(project.id, 'Already up-to-date. Nothing to push.', 'info');
          return;
        }

        logger.info('git', 'Push completed', { projectId: project.id });
        await refreshAndUpdate(project);
        deps.showNotification(project.id, 'Pushed successfully.', 'info');
      } catch (err: unknown) {
        updateGitState(project.id, { loading: false, loadingLabel: undefined });
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (isLockFileError(errorMsg)) {
          lockFileDetected = true;
          return;
        }

        deps.showNotification(project.id, errorMsg, 'error');
      }
    });

    if (lockFileDetected) {
      await handleLockFileRetry(project, 'push', () => doPush(project));
    }
  }

  return {
    pruneLocalCommitMessages,
    refreshProject,
    fetchLog,
    refreshAllProjects,
    generateCommitMessage: generateCommitMessageForProject,
    doCommit,
    doPush,
  };
}
