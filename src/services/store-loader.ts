import { load, type Store } from '@tauri-apps/plugin-store';

/** Creates a lazy-initialized singleton loader for a Tauri plugin-store file. */
export function createStoreLazy(path: string): () => Promise<Store> {
  let instance: Store | null = null;
  return async () => {
    if (!instance) {
      instance = await load(path, { defaults: {}, autoSave: true });
    }
    return instance;
  };
}
