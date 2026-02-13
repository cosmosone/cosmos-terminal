import { load, type Store } from '@tauri-apps/plugin-store';
import type { GitSidebarState, Project } from '../state/types';

const STORE_PATH = 'workspace.json';

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load(STORE_PATH, { defaults: {}, autoSave: true });
  }
  return storeInstance;
}

export interface SavedWorkspace {
  projects: Project[];
  activeProjectId: string | null;
  gitSidebar: GitSidebarState;
}

export async function loadWorkspace(): Promise<SavedWorkspace | null> {
  try {
    const s = await getStore();
    const saved = await s.get<SavedWorkspace>('workspace');
    if (saved && saved.projects && saved.projects.length > 0) {
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
  const s = await getStore();
  await s.set('workspace', { projects, activeProjectId, gitSidebar } satisfies SavedWorkspace);
}
