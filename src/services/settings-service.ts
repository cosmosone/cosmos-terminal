import type { AppSettings } from '../state/types';
import { defaultShell } from '../utils/platform';
import { createStoreLazy } from './store-loader';

const getStore = createStoreLazy('settings.json');

export const TERMINAL_FONT_PRESETS = [
  'JetBrains Mono',
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Fira Code',
  'Source Code Pro',
  'Courier New',
  'monospace',
];

export const UI_FONT_PRESETS = [
  'System Default',
  'Segoe UI',
  'Inter',
  'Roboto',
  'Noto Sans',
  'sans-serif',
];

const SYSTEM_FONT_STACK = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';

/** Build a full CSS font-family string with monospace fallback. */
export function buildTerminalFont(name: string): string {
  if (name === 'monospace') return 'monospace';
  return `'${name}', monospace`;
}

/** Build a full CSS font-family string with sans-serif fallback. */
export function buildUiFont(name: string): string {
  if (name === 'System Default') return SYSTEM_FONT_STACK;
  if (name === 'sans-serif') return 'sans-serif';
  return `${name}, sans-serif`;
}

/** Migrate old comma-separated font stack to a single font name. */
function migrateFontValue(value: string, presets: string[]): string {
  if (!value.includes(',')) return value;
  const first = value.split(',')[0].trim().replace(/['"]/g, '');
  // If the first entry matches a preset, use it; otherwise keep as-is
  const match = presets.find((p) => p.toLowerCase() === first.toLowerCase());
  return match ?? first;
}

function defaultSettings(): AppSettings {
  return {
    shellPath: defaultShell(),
    fontSize: 14,
    fontFamily: 'JetBrains Mono',
    lineHeight: 1.2,
    uiFontFamily: 'System Default',
    uiFontSize: 13,
    scrollbackLines: 10000,
    cursorStyle: 'block',
    cursorBlink: true,
    copyOnSelect: false,
    webglRenderer: false,
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
      const merged = { ...defaultSettings(), ...saved };
      // Migrate old comma-separated font stacks to single names
      merged.fontFamily = migrateFontValue(merged.fontFamily, TERMINAL_FONT_PRESETS);
      merged.uiFontFamily = migrateFontValue(merged.uiFontFamily, UI_FONT_PRESETS);
      return merged;
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
