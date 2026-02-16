import type { GitSidebarState, Project } from '../state/types';
import { createStoreLazy } from './store-loader';

const getStore = createStoreLazy('workspace.json');

export interface SavedWorkspace {
  projects: Project[];
  activeProjectId: string | null;
  gitSidebar: GitSidebarState;
}

export async function loadWorkspace(): Promise<SavedWorkspace | null> {
  try {
    const s = await getStore();
    const saved = await s.get<SavedWorkspace>('workspace');
    if (saved?.projects?.length) {
      return saved;
    }
  } catch {
    // First launch or corrupt store
  }
  return null;
}

export async function saveWorkspace(
  projects: Project[],
  activeProjectId: string | null,
  gitSidebar: GitSidebarState,
): Promise<void> {
  const cleaned = projects.map((p) => ({
    ...p,
    sessions: p.sessions.map((s) => ({ ...s, hasActivity: false })),
  }));
  const s = await getStore();
  await s.set('workspace', { projects: cleaned, activeProjectId, gitSidebar } satisfies SavedWorkspace);
}
