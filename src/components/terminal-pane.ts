import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { open } from '@tauri-apps/plugin-shell';
import { createPtySession, writeToPtySession, resizePtySession, killPtySession } from '../services/pty-service';
import { store } from '../state/store';
import { logger } from '../services/logger';
import { keybindings } from '../utils/keybindings';
import type { AppSettings } from '../state/types';
import { buildTerminalFont } from '../services/settings-service';

/** Fixed xterm.js rendering options that never change with user settings. */
const XTERM_RENDERING_OPTIONS = {
  cursorStyle: 'block' as const,
  cursorBlink: true,
  fontWeight: 'normal' as const,
  fontWeightBold: 'bold' as const,
  letterSpacing: 0,
  allowTransparency: false,       // Opaque background enables subpixel AA in canvas renderer
  customGlyphs: true,             // Pixel-perfect box-drawing and powerline characters
  rescaleOverlappingGlyphs: true, // Rescale glyphs that would bleed into adjacent cells
  drawBoldTextInBrightColors: false, // Use actual bold weight, not just bright colors
  minimumContrastRatio: 1,        // Disable contrast adjustment to match native terminal colors
};

const XTERM_THEME = {
  background: '#0f0f14',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: '#0f0f14',
  selectionBackground: '#33467c',
  selectionForeground: '#c0caf5',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

function extractCwdFromTitle(title: string): string | null {
  let cleaned = title.trim();

  // PowerShell prefixes the window title with "PS "
  if (/^ps\s/i.test(cleaned)) {
    cleaned = cleaned.slice(3).trim();
  }

  // Reject paths ending with a file extension (e.g. powershell.exe, cmd.bat)
  if (/\.\w{1,4}$/i.test(cleaned)) return null;

  // Windows absolute path (C:\...)
  if (/^[A-Za-z]:[\\\/]/.test(cleaned)) return cleaned;

  // Unix absolute path (/...)
  if (cleaned.startsWith('/')) return cleaned;

  return null;
}

export class TerminalPane {
  readonly element: HTMLElement;
  readonly paneId: string;

  private terminal: Terminal;
  private fitAddon: FitAddon;
  private webglAddon: WebglAddon | null = null;
  private backendId: string | null = null;
  private projectPath: string;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private resizeRafId = 0;
  private onProcessExit?: () => void;
  private onCwdChange?: (cwd: string) => void;
  private lastReportedCwd: string;
  private lastSentRows = 0;
  private lastSentCols = 0;
  private pendingOutput: Uint8Array[] = [];
  private outputRafId = 0;

  constructor(paneId: string, projectId: string, projectPath: string, onProcessExit?: () => void, onCwdChange?: (cwd: string) => void) {
    this.paneId = paneId;
    this.projectPath = projectPath;
    this.onProcessExit = onProcessExit;
    this.onCwdChange = onCwdChange;
    this.lastReportedCwd = projectPath;

    logger.debug('pty', 'TerminalPane created', { paneId, projectId, projectPath });

    const settings = store.getState().settings;

    this.element = document.createElement('div');
    this.element.className = 'terminal-pane';
    this.element.dataset.paneId = paneId;

    this.terminal = new Terminal({
      theme: XTERM_THEME,
      ...XTERM_RENDERING_OPTIONS,
      fontSize: settings.fontSize,
      fontFamily: buildTerminalFont(settings.fontFamily),
      lineHeight: settings.lineHeight,
      scrollback: settings.scrollbackLines,
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon((_e, uri) => open(uri)));
    this.terminal.loadAddon(new ImageAddon());
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = '11';

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.resizeRafId && !this.disposed) {
        this.resizeRafId = requestAnimationFrame(() => {
          this.resizeRafId = 0;
          if (!this.disposed) this.fit();
        });
      }
    });
  }

  async mount(): Promise<void> {
    logger.debug('pty', 'Mounting terminal pane', { paneId: this.paneId });
    this.terminal.open(this.element);

    // Let global keybindings pass through instead of being consumed by xterm
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;
      if (keybindings.matchesBinding(e)) return false;

      // Explicit Ctrl+V paste — Tauri webview may not fire browser paste events
      // reliably for TUI applications (e.g. Claude Code)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text) this.terminal.paste(text);
        }).catch(() => {});
        return false;
      }

      return true;
    });

    // Always use WebGL for best text rendering (ClearType glyph atlas).
    // Falls back to canvas automatically on context loss or if unavailable.
    this.tryWebgl();

    this.resizeObserver.observe(this.element);

    await new Promise((r) => requestAnimationFrame(r));
    if (this.disposed) return;
    this.fit();

    this.terminal.onData((data) => {
      if (this.backendId) {
        writeToPtySession(this.backendId, data);
      }
    });

    this.terminal.onBell(() => {
      logger.debug('pty', 'Bell triggered', { paneId: this.paneId });
      this.element.classList.add('bell');
      setTimeout(() => {
        if (!this.disposed) this.element.classList.remove('bell');
      }, 200);
    });

    this.terminal.onSelectionChange(() => {
      if (store.getState().settings.copyOnSelect) {
        const text = this.terminal.getSelection();
        if (text) navigator.clipboard.writeText(text);
      }
    });

    this.terminal.onTitleChange((title) => {
      const cwd = extractCwdFromTitle(title);
      if (cwd && cwd.toLowerCase() !== this.lastReportedCwd.toLowerCase()) {
        this.lastReportedCwd = cwd;
        this.onCwdChange?.(cwd);
      }
    });

    const settings = store.getState().settings;
    const dims = this.fitAddon.proposeDimensions();
    const info = await createPtySession(
      {
        projectPath: this.projectPath,
        shellPath: settings.shellPath,
        rows: dims?.rows ?? 24,
        cols: dims?.cols ?? 80,
      },
      (data) => {
        if (!this.disposed) {
          this.pendingOutput.push(data);
          if (!this.outputRafId) {
            this.outputRafId = requestAnimationFrame(() => this.flushOutput());
          }
        }
      },
      () => {
        if (!this.disposed) {
          logger.info('pty', 'Process exited', { paneId: this.paneId });
          this.onProcessExit?.();
        }
      },
    );

    if (this.disposed) {
      logger.warn('pty', 'Terminal disposed during mount, killing orphaned PTY', { paneId: this.paneId, backendId: info.id });
      await killPtySession(info.id).catch(() => {});
      return;
    }

    this.backendId = info.id;
    logger.info('pty', 'PTY session created', { paneId: this.paneId, backendId: info.id, pid: info.pid });
  }

  private tryWebgl(): void {
    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss(() => {
        logger.warn('pty', 'WebGL context lost, falling back to canvas', { paneId: this.paneId });
        this.webglAddon?.dispose();
        this.webglAddon = null;
      });
      this.terminal.loadAddon(this.webglAddon);
      logger.debug('pty', 'WebGL addon loaded', { paneId: this.paneId });
    } catch {
      logger.debug('pty', 'WebGL not available, using canvas renderer', { paneId: this.paneId });
      this.webglAddon = null;
    }
  }

  private flushOutput(): void {
    this.outputRafId = 0;
    if (this.disposed || this.pendingOutput.length === 0) return;

    if (this.pendingOutput.length === 1) {
      this.terminal.write(this.pendingOutput[0]);
    } else {
      // Concatenate all pending chunks into a single write
      let totalLen = 0;
      for (const chunk of this.pendingOutput) totalLen += chunk.length;
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of this.pendingOutput) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this.terminal.write(merged);
    }
    this.pendingOutput = [];
  }

  fit(): void {
    if (this.disposed || this.element.offsetWidth === 0) return;
    try {
      this.fitAddon.fit();
      const dims = this.fitAddon.proposeDimensions();
      if (dims && this.backendId) {
        if (dims.rows !== this.lastSentRows || dims.cols !== this.lastSentCols) {
          this.lastSentRows = dims.rows;
          this.lastSentCols = dims.cols;
          resizePtySession(this.backendId, dims.rows, dims.cols);
          logger.debug('pty', 'Terminal fit', { paneId: this.paneId, rows: dims.rows, cols: dims.cols });
        }
      }
    } catch {
      // Fit can throw if element not visible
    }
  }

  focus(): void {
    this.terminal.focus();
    this.element.classList.add('focused');
  }

  blur(): void {
    this.element.classList.remove('focused');
  }

  applySettings(settings: AppSettings): void {
    logger.debug('pty', 'Applying settings to terminal', { paneId: this.paneId, fontSize: settings.fontSize });

    Object.assign(this.terminal.options, XTERM_RENDERING_OPTIONS);
    this.terminal.options.fontSize = settings.fontSize;
    this.terminal.options.fontFamily = buildTerminalFont(settings.fontFamily);
    this.terminal.options.lineHeight = settings.lineHeight;
    this.terminal.options.scrollback = settings.scrollbackLines;

    // Re-attempt WebGL if it was lost (e.g. after context loss)
    if (!this.webglAddon) {
      this.tryWebgl();
    }

    this.fit();
  }

  clearScrollback(): void {
    this.terminal.clear();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.outputRafId) cancelAnimationFrame(this.outputRafId);
    if (this.resizeRafId) cancelAnimationFrame(this.resizeRafId);
    this.pendingOutput = [];
    logger.info('pty', 'Disposing terminal pane', { paneId: this.paneId, backendId: this.backendId });
    this.resizeObserver.disconnect();
    if (this.backendId) {
      await killPtySession(this.backendId).catch(() => {});
    }
    this.webglAddon?.dispose();
    this.terminal.dispose();
  }
}
