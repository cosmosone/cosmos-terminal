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
} from '../../services/git-service';
import { generateCommitMessage } from '../../services/openai-service';
import { logger } from '../../services/logger';
import { statusEquals } from './shared';
import type { Project, GitNotificationType } from '../../state/types';

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
  let pollInFlight = false;

  function clearCommitMessage(projectId: string): void {
    deps.localCommitMessages.delete(projectId);
    setCommitMessage(projectId, '');
  }

  function pruneLocalCommitMessages(validProjectIds: Set<string>): void {
    for (const key of deps.localCommitMessages.keys()) {
      if (!validProjectIds.has(key)) deps.localCommitMessages.delete(key);
    }
  }

  async function refreshProject(project: Project, silent = false): Promise<void> {
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
          updateGitState(project.id, { isRepo: false, loading: false });
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
      updateGitState(project.id, { isRepo: true, status, loading: false });
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

  async function fetchLog(project: Project): Promise<void> {
    try {
      const log = await getGitLog(project.path, 50);
      updateGitState(project.id, { log });
    } catch (err: unknown) {
      logger.error('git', 'Failed to fetch log', { projectId: project.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function refreshAllProjects(silent = false): Promise<void> {
    if (pollInFlight) return;
    pollInFlight = true;
    const projects = store.getState().projects;
    try {
      await Promise.all(projects.map((p) => refreshProject(p, silent)));
    } finally {
      pollInFlight = false;
    }
  }

  async function generateCommitMessageForProject(project: Project): Promise<void> {
    const gs = store.getState().gitStates[project.id] || defaultGitState();
    if (gs.generating) return;

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
  }

  async function doCommit(project: Project, push: boolean): Promise<void> {
    const gs = store.getState().gitStates[project.id] || defaultGitState();
    if (gs.loading) return;

    const message = (deps.localCommitMessages.get(project.id) ?? gs.commitMessage).trim();
    if (!message) {
      deps.showNotification(project.id, 'Please enter a commit message.', 'warning');
      return;
    }

    updateGitState(project.id, { loading: true, error: null, notification: null });
    try {
      await gitStageAll(project.path);
      const result = await gitCommit(project.path, message);
      logger.info('git', 'Commit created', { projectId: project.id, commitId: result.commitId });

      if (push) {
        const pushResult = await gitPush(project.path);
        if (!pushResult.success) {
          updateGitState(project.id, { loading: false });
          deps.showNotification(project.id, `Committed, but push failed: ${pushResult.message}`, 'error', 8000);
          await refreshProject(project);
          await fetchLog(project);
          clearCommitMessage(project.id);
          return;
        }
        logger.info('git', 'Push completed', { projectId: project.id });
      }

      await refreshProject(project);
      await fetchLog(project);
      clearCommitMessage(project.id);
    } catch (err: unknown) {
      updateGitState(project.id, { loading: false });
      deps.showNotification(project.id, err instanceof Error ? err.message : 'Commit failed', 'error');
    }
  }

  async function doPush(project: Project): Promise<void> {
    const gs = store.getState().gitStates[project.id] || defaultGitState();
    if (gs.loading) return;

    if (gs.status?.dirty) {
      deps.showNotification(project.id, 'You have uncommitted changes. Commit first, or use Commit & Push.', 'warning');
      return;
    }

    updateGitState(project.id, { loading: true, error: null, notification: null });
    try {
      const pushResult = await gitPush(project.path);
      if (!pushResult.success) {
        updateGitState(project.id, { loading: false });
        deps.showNotification(project.id, `Push failed: ${pushResult.message}`, 'error');
        return;
      }

      const msg = pushResult.message.toLowerCase();
      if (msg.includes('up-to-date') || msg.includes('up to date')) {
        updateGitState(project.id, { loading: false });
        deps.showNotification(project.id, 'Already up-to-date. Nothing to push.', 'info');
      } else {
        logger.info('git', 'Push completed', { projectId: project.id });
        updateGitState(project.id, { loading: false });
        deps.showNotification(project.id, 'Pushed successfully.', 'info');
      }
      await fetchLog(project);
    } catch (err: unknown) {
      updateGitState(project.id, { loading: false });
      deps.showNotification(project.id, err instanceof Error ? err.message : 'Push failed', 'error');
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
