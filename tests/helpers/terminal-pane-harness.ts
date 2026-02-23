import { vi } from 'vitest';
import { initStore } from '../../src/state/store';
import type { AppSettings, AppState, KeybindingConfig } from '../../src/state/types';

export const ptyMocks = {
  createPtySession: vi.fn(async () => ({ id: 'test-session', pid: 1 })),
  writeToPtySession: vi.fn(),
  resizePtySession: vi.fn(async () => undefined),
  killPtySession: vi.fn(async () => undefined),
};

export class FakeTerminal {
  rows = 24;
  cols = 80;
  options: Record<string, unknown> = {};
  unicode = { activeVersion: '11' };
  buffer = {
    active: {
      viewportY: 0,
      baseY: 0,
    },
  };

  private textDecoder = new TextDecoder();
  private scrollHandlers: Array<() => void> = [];

  loadAddon(_addon: unknown): void {}
  open(_el: HTMLElement): void {}
  attachCustomKeyEventHandler(_handler: (e: KeyboardEvent) => boolean): void {}
  onData(_handler: (data: string) => void): void {}
  onBell(_handler: () => void): void {}
  onSelectionChange(_handler: () => void): void {}
  onTitleChange(_handler: (title: string) => void): void {}
  focus(): void {}
  clear(): void {}
  dispose(): void {}
  paste(_text: string): void {}
  getSelection(): string { return ''; }

  onScroll(handler: () => void): void {
    this.scrollHandlers.push(handler);
  }

  write(data: string | Uint8Array, callback?: () => void): void {
    const text = typeof data === 'string' ? data : this.textDecoder.decode(data);
    const newlineCount = (text.match(/\n/g) ?? []).length;
    const wrappedLines = Math.ceil(text.length / Math.max(this.cols, 1));
    const lineDelta = Math.max(1, newlineCount + wrappedLines);
    this.buffer.active.baseY += lineDelta;
    callback?.();
    this.emitScroll();
  }

  scrollToBottom(): void {
    this.buffer.active.viewportY = this.buffer.active.baseY;
    this.emitScroll();
  }

  private emitScroll(): void {
    for (const handler of this.scrollHandlers) handler();
  }
}

export class FakeFitAddon {
  private dims = { cols: 80, rows: 24 };

  fit(): void {}
  proposeDimensions(): { cols: number; rows: number } {
    return this.dims;
  }

  setDimensions(rows: number, cols: number): void {
    this.dims = { rows, cols };
  }
}

class FakeWebglAddon {
  onContextLoss(_handler: () => void): void {}
  dispose(): void {}
}

class FakeWebLinksAddon {
  constructor(_handler: (event: MouseEvent, uri: string) => void) {}
}

class FakeImageAddon {}
class FakeUnicode11Addon {}

let mocksInstalled = false;

export function installTerminalPaneModuleMocks(): void {
  if (mocksInstalled) return;
  mocksInstalled = true;

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    } as typeof ResizeObserver;
  }
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(Date.now()), 0) as unknown as number;
    };
  }
  if (!globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame = (id: number) => {
      clearTimeout(id);
    };
  }

  vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
  vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
  vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: FakeWebglAddon }));
  vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: FakeWebLinksAddon }));
  vi.mock('@xterm/addon-image', () => ({ ImageAddon: FakeImageAddon }));
  vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: FakeUnicode11Addon }));
  vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => undefined) }));
  vi.mock('/src/services/pty-service.ts', () => ptyMocks);
  vi.mock('/src/services/initial-command.ts', () => ({ consumeInitialCommand: vi.fn(() => null) }));
  vi.mock('/src/utils/keybindings.ts', () => ({ keybindings: { matchesBinding: vi.fn(() => false) } }));
}

const DEFAULT_KEYBINDINGS: KeybindingConfig = {
  newSession: 'Ctrl+Shift+t',
  toggleSettings: 'Ctrl+,',
  navigatePaneLeft: 'Alt+ArrowLeft',
  navigatePaneRight: 'Alt+ArrowRight',
  navigatePaneUp: 'Alt+ArrowUp',
  navigatePaneDown: 'Alt+ArrowDown',
  splitDown: 'Alt+x',
  splitUp: 'Alt+s',
  splitLeft: 'Alt+z',
  splitRight: 'Alt+c',
  cycleSessionNext: 'Alt+k',
  cycleSessionPrev: 'Alt+j',
  cycleProjectNext: 'Alt+i',
  cycleProjectPrev: 'Alt+u',
  toggleGitSidebar: 'Alt+d',
  toggleFileBrowser: 'Alt+f',
  searchFileBrowser: 'Ctrl+Shift+f',
  closeTerminalTab: 'Alt+l',
  closeProjectTab: 'Alt+o',
  scrollToBottom: 'Alt+b',
  findInDocument: 'Ctrl+f',
};

const DEFAULT_SETTINGS: AppSettings = {
  shellPath: 'powershell.exe',
  fontSize: 12.5,
  fontFamily: 'Cascadia Code',
  lineHeight: 1.2,
  uiFontFamily: 'System Default',
  uiFontSize: 12.5,
  viewerFontSize: 12.5,
  editorFontSize: 12.5,
  scrollbackLines: 10000,
  copyOnSelect: false,
  rightClickPaste: false,
  debugLogging: false,
  debugLoggingExpiry: null,
  confirmCloseTerminalTab: true,
  confirmCloseProjectTab: true,
  keybindings: DEFAULT_KEYBINDINGS,
  openaiApiKey: '',
};

export function initTerminalPaneTestStore(overrides?: Partial<AppSettings>): void {
  const state: AppState = {
    projects: [],
    activeProjectId: null,
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    view: 'terminal',
    gitSidebar: {
      visible: false,
      width: 350,
      expandedProjectIds: [],
      activeProjectId: null,
      graphExpanded: true,
    },
    fileBrowserSidebar: {
      visible: false,
      width: 280,
      expandedPaths: [],
    },
    gitStates: {},
  };
  initStore(state);
}

export function resetPtyMocks(): void {
  ptyMocks.createPtySession.mockClear();
  ptyMocks.writeToPtySession.mockClear();
  ptyMocks.resizePtySession.mockClear();
  ptyMocks.killPtySession.mockClear();
}

export async function createTerminalPaneForTest() {
  const { TerminalPane } = await import('../../src/components/terminal-pane');
  initTerminalPaneTestStore();
  const pane = new TerminalPane('pane-test', 'project-test', 'C:\\workspace');

  let width = 1024;
  Object.defineProperty(pane.element, 'offsetWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(pane.element, 'offsetHeight', {
    configurable: true,
    get: () => (width > 0 ? 768 : 0),
  });

  return {
    pane,
    terminal: (pane as unknown as { terminal: FakeTerminal }).terminal,
    fitAddon: (pane as unknown as { fitAddon: FakeFitAddon }).fitAddon,
    setHidden: (hidden: boolean) => {
      width = hidden ? 0 : 1024;
    },
  };
}
