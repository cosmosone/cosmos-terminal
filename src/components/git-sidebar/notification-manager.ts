import { updateGitState } from '../../state/actions';
import { store } from '../../state/store';
import type { GitNotificationType } from '../../state/types';

export interface GitSidebarNotificationManager {
  showNotification(projectId: string, message: string, type: GitNotificationType, durationMs?: number): void;
  pruneTimers(validProjectIds: Set<string>): void;
}

export function createGitSidebarNotificationManager(): GitSidebarNotificationManager {
  const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function showNotification(projectId: string, message: string, type: GitNotificationType, durationMs = 5000): void {
    const existing = notificationTimers.get(projectId);
    if (existing) clearTimeout(existing);

    updateGitState(projectId, { notification: { message, type } });

    const timer = setTimeout(() => {
      const current = store.getState().gitStates[projectId];
      if (current?.notification?.message === message) {
        updateGitState(projectId, { notification: null });
      }
      notificationTimers.delete(projectId);
    }, durationMs);
    notificationTimers.set(projectId, timer);
  }

  function pruneTimers(validProjectIds: Set<string>): void {
    for (const [projectId, timer] of notificationTimers.entries()) {
      if (!validProjectIds.has(projectId)) {
        clearTimeout(timer);
        notificationTimers.delete(projectId);
      }
    }
  }

  return { showNotification, pruneTimers };
}
