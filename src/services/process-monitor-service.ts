import { listen } from '@tauri-apps/api/event';
import { lookupBackendSession } from './pty-service';
import { markProcessTreeChange } from '../state/actions';
import type { SessionChildrenEvent } from '../state/types';
import { SESSION_CHILDREN_CHANGED_EVENT } from '../state/types';

/** Start listening for process tree state changes from the Rust backend. */
export function initProcessMonitorListener(): void {
  void listen<SessionChildrenEvent>(SESSION_CHILDREN_CHANGED_EVENT, (event) => {
    const mapping = lookupBackendSession(event.payload.sessionId);
    if (!mapping) return;
    markProcessTreeChange(
      mapping.projectId,
      mapping.sessionId,
      mapping.paneId,
      event.payload.hasChildren,
    );
  });
}
