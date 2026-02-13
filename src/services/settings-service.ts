import { load, type Store } from '@tauri-apps/plugin-store';
import type { AppSettings } from '../state/types';
import { defaultShell } from '../utils/platform';

const STORE_PATH = 'settings.json';

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load(STORE_PATH, { defaults: {}, autoSave: true });
  }
  return storeInstance;
}

function defaultSettings(): AppSettings {
  return {
    shellPath: defaultShell(),
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
    scrollbackLines: 10000,
    cursorStyle: 'block',
    cursorBlink: true,
    copyOnSelect: false,
    bellStyle: 'visual',
    debugLogging: false,
    debugLoggingExpiry: null,
    openaiApiKey: '',
    keybindings: {
      navigatePaneLeft: 'Alt+ArrowLeft',
      navigatePaneRight: 'Alt+ArrowRight',
      navigatePaneUp: 'Alt+ArrowUp',
      navigatePaneDown: 'Alt+ArrowDown',
      splitDown: 'Alt+x',
      splitUp: 'Alt+s',
      splitLeft: 'Alt+z',
      splitRight: 'Alt+c',
      cycleSessionNext: 'Alt+l',
      cycleSessionPrev: 'Alt+k',
      cycleProjectNext: 'Alt+p',
      cycleProjectPrev: 'Alt+o',
    },
  };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const s = await getStore();
    const saved = await s.get<AppSettings>('settings');
    if (saved) {
      return { ...defaultSettings(), ...saved };
    }
  } catch {
    // First launch or corrupt store
  }
  return defaultSettings();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const s = await getStore();
  await s.set('settings', settings);
}
