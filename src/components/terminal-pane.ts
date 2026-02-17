import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { open } from '@tauri-apps/plugin-shell';
import { createPtySession, writeToPtySession, resizePtySession, killPtySession } from '../services/pty-service';
import { consumeInitialCommand } from '../services/initial-command';
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

/**
 * CSI u key codes for functional keys that need explicit encoding
 * under the Kitty keyboard protocol.
 */
const FUNCTIONAL_KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 127,
  Escape: 27,
};

/** Compute CSI u modifier parameter: 1 + Shift(1) + Alt(2) + Ctrl(4) + Meta(8). */
function csiModifier(e: KeyboardEvent): number {
  return 1
    + (e.shiftKey ? 1 : 0)
    + (e.altKey ? 2 : 0)
    + (e.ctrlKey ? 4 : 0)
    + (e.metaKey ? 8 : 0);
}

/** Decode a Uint8Array as latin-1 (one char per byte) for regex matching. */
const latin1Decoder = new TextDecoder('latin1');
function toLatin1(data: Uint8Array): string {
  return latin1Decoder.decode(data);
}

/** Remove byte ranges from a Uint8Array, returning a new array without those regions. */
function stripRanges(data: Uint8Array, ranges: [number, number][]): Uint8Array {
  let strippedLen = data.length;
  for (const [start, end] of ranges) strippedLen -= end - start;
  const result = new Uint8Array(strippedLen);
  let pos = 0;
  let dest = 0;
  for (const [start, end] of ranges) {
    result.set(data.subarray(pos, start), dest);
    dest += start - pos;
    pos = end;
  }
  result.set(data.subarray(pos), dest);
  return result;
}

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
  /** Kitty keyboard protocol mode stack — pushed/popped by child applications. */
  private kittyModeStack: number[] = [];
  /** Current Kitty keyboard protocol flags (top of stack, 0 = legacy). */
  private get kittyFlags(): number {
    return this.kittyModeStack[this.kittyModeStack.length - 1] ?? 0;
  }
  private projectPath: string;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private resizeRafId = 0;
  private onProcessExit?: () => void;
  private onCwdChange?: (cwd: string) => void;
  private onActivity?: () => void;
  private lastReportedCwd: string;
  private lastSentRows = 0;
  private lastSentCols = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastResizeTime = 0;
  private pendingOutput: Uint8Array[] = [];
  private outputRafId = 0;
  private scrollBtn: HTMLElement;
  /** Persistent auto-scroll intent — true when the user is following output at the bottom. */
  private autoScroll = true;

  // Activity detection — fire onActivity at most once per rolling window
  // when cumulative output exceeds a byte threshold (filters idle TUI noise).
  private activityBytes = 0;
  private activityWindowStart = 0;
  private activityFiredThisWindow = false;
  private static readonly ACTIVITY_BYTE_THRESHOLD = 512;
  private static readonly ACTIVITY_WINDOW_MS = 1_000;

  // OSC-based busy/idle detection (primary signal when available)
  private oscBusy = false;
  private hasOscSupport = false;
  private onOscBusy?: (paneId: string) => void;
  private onOscIdle?: (paneId: string) => void;

  constructor(
    paneId: string,
    projectId: string,
    projectPath: string,
    callbacks?: {
      onProcessExit?: () => void;
      onCwdChange?: (cwd: string) => void;
      onActivity?: () => void;
      onOscBusy?: (paneId: string) => void;
      onOscIdle?: (paneId: string) => void;
    },
  ) {
    this.paneId = paneId;
    this.projectPath = projectPath;
    this.onProcessExit = callbacks?.onProcessExit;
    this.onCwdChange = callbacks?.onCwdChange;
    this.onActivity = callbacks?.onActivity;
    this.onOscBusy = callbacks?.onOscBusy;
    this.onOscIdle = callbacks?.onOscIdle;
    this.lastReportedCwd = projectPath;

    logger.info('pty', 'TerminalPane created', { paneId, projectId, projectPath });

    const settings = store.getState().settings;

    this.element = document.createElement('div');
    this.element.className = 'terminal-pane';
    this.element.dataset.paneId = paneId;

    this.scrollBtn = document.createElement('button');
    this.scrollBtn.className = 'scroll-to-bottom-btn';
    this.scrollBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    this.scrollBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.scrollToBottom();
    });
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

    logger.debug('pty', 'Terminal instance configured', {
      paneId,
      fontSize: settings.fontSize,
      scrollback: settings.scrollbackLines,
    });
  }

  async mount(): Promise<void> {
    logger.info('pty', 'Mounting terminal pane', { paneId: this.paneId });
    this.terminal.open(this.element);
    this.element.appendChild(this.scrollBtn);

    // Let global keybindings pass through instead of being consumed by xterm
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;
      if (keybindings.matchesBinding(e)) {
        logger.debug('pty', 'Key intercepted by global binding', {
          paneId: this.paneId,
          key: e.key,
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
        });
        return false;
      }

      // Explicit Ctrl+V paste — Tauri webview may not fire browser paste events
      // reliably for TUI applications (e.g. Claude Code).
      // preventDefault() is required to suppress the browser's native paste event,
      // which would otherwise cause xterm to paste the text a second time.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'v') {
        e.preventDefault();
        this.pasteFromClipboard('Ctrl+V');
        return false;
      }

      // Modified Enter handling (Ctrl+Enter / Shift+Enter).
      //
      // When the Kitty keyboard protocol is active, encode all functional
      // keys (Enter, Tab, Backspace, Escape) as CSI u so the child app
      // receives full key identity and modifiers.
      //
      // When inactive (legacy mode), send a plain line-feed (\n, 0x0A)
      // for Ctrl+Enter and Shift+Enter.  Most TUI apps (e.g. Claude Code)
      // treat \n as "insert newline" vs \r as "submit".  CSI u sequences
      // are NOT understood by apps that haven't negotiated Kitty protocol.
      if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
        const usingKitty = !!(this.kittyFlags & 1);
        logger.info('pty', 'Modified Enter intercepted', {
          paneId: this.paneId,
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          kittyFlags: this.kittyFlags,
          path: usingKitty ? 'kitty-csiu' : 'legacy-lf',
        });
      }
      if (this.kittyFlags & 1) {
        const code = FUNCTIONAL_KEY_CODES[e.key];
        if (code !== undefined) {
          const mod = csiModifier(e);
          const seq = mod > 1 ? `\x1b[${code};${mod}u` : `\x1b[${code}u`;
          if (this.backendId) {
            writeToPtySession(this.backendId, seq);
          } else {
            logger.warn('pty', 'Kitty CSI u key dropped — no backend', {
              paneId: this.paneId,
              key: e.key,
              seq,
            });
          }
          return false;
        }
      } else if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
        // Legacy mode: send \n (line feed) which TUI apps recognise as
        // "insert newline" without needing any keyboard protocol extension.
        if (this.backendId) {
          writeToPtySession(this.backendId, '\n');
        } else {
          logger.warn('pty', 'Legacy modified Enter dropped — no backend', {
            paneId: this.paneId,
          });
        }
        return false;
      }

      return true;
    });

    // Always use WebGL for best text rendering (ClearType glyph atlas).
    // Falls back to canvas automatically on context loss or if unavailable.
    this.tryWebgl();

    this.resizeObserver.observe(this.element);

    await new Promise((r) => requestAnimationFrame(r));
    if (this.disposed) {
      logger.warn('pty', 'Terminal disposed before first fit', { paneId: this.paneId });
      return;
    }
    this.fit();

    this.terminal.onData((data) => {
      if (this.backendId) {
        writeToPtySession(this.backendId, data);
      } else {
        logger.warn('pty', 'Terminal data dropped — no backend', {
          paneId: this.paneId,
          length: data.length,
        });
      }
    });

    this.terminal.onBell(() => {
      logger.debug('pty', 'Bell triggered', { paneId: this.paneId });
      this.element.classList.add('bell');
      setTimeout(() => {
        if (!this.disposed) this.element.classList.remove('bell');
      }, 200);
    });

    this.element.addEventListener('contextmenu', (e) => {
      if (store.getState().settings.rightClickPaste) {
        e.preventDefault();
        this.pasteFromClipboard('Right-click');
      }
    });

    this.terminal.onSelectionChange(() => {
      if (store.getState().settings.copyOnSelect) {
        const text = this.terminal.getSelection();
        if (text) {
          navigator.clipboard.writeText(text).catch((err) => {
            logger.warn('pty', 'Copy-on-select clipboard write failed', {
              paneId: this.paneId,
              error: String(err),
            });
          });
        }
      }
    });

    this.terminal.onScroll(() => {
      const buf = this.terminal.buffer.active;
      const isAtBottom = buf.viewportY >= buf.baseY;
      if (this.autoScroll !== isAtBottom) {
        logger.debug('pty', 'autoScroll changed', {
          paneId: this.paneId,
          autoScroll: isAtBottom,
          viewportY: buf.viewportY,
          baseY: buf.baseY,
          rows: this.terminal.rows,
        });
      }
      this.autoScroll = isAtBottom;
      this.scrollBtn.classList.toggle('visible', !isAtBottom);
    });

    this.terminal.onTitleChange((title) => {
      const cwd = extractCwdFromTitle(title);
      if (cwd && cwd.toLowerCase() !== this.lastReportedCwd.toLowerCase()) {
        logger.debug('pty', 'Working directory changed', {
          paneId: this.paneId,
          from: this.lastReportedCwd,
          to: cwd,
        });
        this.lastReportedCwd = cwd;
        this.onCwdChange?.(cwd);
      }
    });

    const settings = store.getState().settings;
    const dims = this.fitAddon.proposeDimensions();
    logger.info('pty', 'Creating PTY session', {
      paneId: this.paneId,
      projectPath: this.projectPath,
      shell: settings.shellPath ?? '(default)',
      rows: dims?.rows ?? 24,
      cols: dims?.cols ?? 80,
    });

    let info;
    try {
      info = await createPtySession(
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
            this.trackActivity(data.length);
          }
        },
        () => {
          if (!this.disposed) {
            logger.warn('pty', 'Shell process exited', {
              paneId: this.paneId,
              backendId: this.backendId,
            });
            this.onProcessExit?.();
          }
        },
      );
    } catch (err) {
      logger.error('pty', 'Failed to create PTY session', {
        paneId: this.paneId,
        projectPath: this.projectPath,
        shell: settings.shellPath ?? '(default)',
        error: String(err),
      });
      return;
    }

    if (this.disposed) {
      logger.warn('pty', 'Terminal disposed during mount, killing orphaned PTY', {
        paneId: this.paneId,
        backendId: info.id,
      });
      await killPtySession(info.id).catch(() => {});
      return;
    }

    this.backendId = info.id;
    logger.info('pty', 'PTY session created', {
      paneId: this.paneId,
      backendId: info.id,
      pid: info.pid,
    });

    const initialCmd = consumeInitialCommand(this.paneId);
    if (initialCmd) {
      logger.info('pty', 'Sending initial command', {
        paneId: this.paneId,
        command: initialCmd,
      });
      writeToPtySession(this.backendId, initialCmd + '\r');
    }
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
      logger.info('pty', 'WebGL renderer loaded', { paneId: this.paneId });
    } catch (err) {
      logger.warn('pty', 'WebGL not available, using canvas renderer', {
        paneId: this.paneId,
        error: String(err),
      });
      this.webglAddon = null;
    }
  }

  /** Read clipboard text and paste it into the terminal. */
  private pasteFromClipboard(source: string): void {
    navigator.clipboard.readText().then((text) => {
      if (text) {
        logger.debug('pty', `${source} paste`, { paneId: this.paneId, length: text.length });
        this.terminal.paste(text);
      }
    }).catch((err) => {
      logger.warn('pty', `${source} clipboard read failed`, { paneId: this.paneId, error: String(err) });
    });
  }

  /**
   * Accumulate PTY output bytes and fire onActivity at most once per rolling
   * window when cumulative volume exceeds ACTIVITY_BYTE_THRESHOLD.
   * This filters out small idle TUI updates (cursor blinks, status bar
   * refreshes) that don't represent real work.
   */
  private trackActivity(bytes: number): void {
    const now = Date.now();
    if (now - this.activityWindowStart > TerminalPane.ACTIVITY_WINDOW_MS) {
      this.activityBytes = 0;
      this.activityWindowStart = now;
      this.activityFiredThisWindow = false;
    }
    this.activityBytes += bytes;
    if (!this.activityFiredThisWindow && this.activityBytes >= TerminalPane.ACTIVITY_BYTE_THRESHOLD) {
      this.activityFiredThisWindow = true;
      this.onActivity?.();
    }
  }

  /**
   * Intercept Kitty keyboard protocol sequences in PTY output.
   * - Responds to mode queries  (CSI ? u)
   * - Tracks push/pop changes   (CSI > flags u  /  CSI < [count] u)
   * - Strips handled sequences so xterm.js (which lacks Kitty support)
   *   doesn't see them.
   */
  private interceptKittyProtocol(data: Uint8Array): Uint8Array {
    // Fast path: skip if no ESC byte present
    if (!data.includes(0x1b)) return data;

    const text = toLatin1(data);
    const re = /\x1b\[([?><])(\d*)(u)/g;
    let match: RegExpExecArray | null;
    const ranges: [number, number][] = [];

    while ((match = re.exec(text)) !== null) {
      const marker = match[1];
      const num = match[2] ? parseInt(match[2], 10) : 0;

      if (marker === '?') {
        logger.info('pty', 'Kitty protocol QUERY from child app', {
          paneId: this.paneId,
          respondingWith: this.kittyFlags,
          stack: JSON.stringify(this.kittyModeStack),
        });
        if (this.backendId) {
          writeToPtySession(this.backendId, `\x1b[?${this.kittyFlags}u`);
        } else {
          logger.warn('pty', 'Kitty QUERY response dropped — no backend', { paneId: this.paneId });
        }
      } else if (marker === '>') {
        this.kittyModeStack.push(num);
        logger.info('pty', 'Kitty protocol PUSH — child app enabled keyboard protocol', {
          paneId: this.paneId,
          pushedFlags: num,
          newStack: JSON.stringify(this.kittyModeStack),
          activeFlags: this.kittyFlags,
        });
      } else if (marker === '<') {
        const stackBefore = JSON.stringify(this.kittyModeStack);
        // Pop N entries (default 1 when no digit given, 0 = pop all)
        const count = match[2] ? num : 1;
        const toPop = count === 0
          ? this.kittyModeStack.length
          : Math.min(count, this.kittyModeStack.length);
        if (toPop > 0) this.kittyModeStack.splice(-toPop);
        logger.info('pty', 'Kitty protocol POP — child app released keyboard protocol', {
          paneId: this.paneId,
          popCount: toPop,
          stackBefore,
          newStack: JSON.stringify(this.kittyModeStack),
          activeFlags: this.kittyFlags,
        });
      }

      ranges.push([match.index, match.index + match[0].length]);
    }

    if (ranges.length === 0) return data;

    logger.debug('pty', 'Stripped Kitty protocol sequences from PTY output', {
      paneId: this.paneId,
      sequenceCount: ranges.length,
      bytesStripped: ranges.reduce((sum, [s, e]) => sum + (e - s), 0),
    });

    return stripRanges(data, ranges);
  }

  /** Mark OSC support detected on first occurrence. */
  private markOscDetected(source: string): void {
    if (this.hasOscSupport) return;
    this.hasOscSupport = true;
    logger.info('pty', `${source} detected`, { paneId: this.paneId });
  }

  /** Transition to OSC busy state if not already busy. */
  private setOscBusy(reason: string): void {
    if (this.oscBusy) return;
    this.oscBusy = true;
    logger.debug('pty', reason, { paneId: this.paneId });
    this.onOscBusy?.(this.paneId);
  }

  /** Transition to OSC idle state if currently busy. */
  private setOscIdle(reason: string): void {
    if (!this.oscBusy) return;
    this.oscBusy = false;
    logger.debug('pty', reason, { paneId: this.paneId });
    this.onOscIdle?.(this.paneId);
  }

  /**
   * Intercept OSC 133 (shell integration) sequences in PTY output.
   * These mark prompt/command boundaries:
   *   133;A → prompt start (command finished, back at prompt)
   *   133;B → prompt end / command input start
   *   133;C → command started executing
   *   133;D → command finished (often followed by 133;A)
   * Does NOT strip sequences -- xterm.js can use them for shell integration.
   */
  private interceptOsc133(data: Uint8Array): void {
    // Fast path: skip if no ESC byte present
    if (!data.includes(0x1b)) return;

    const text = toLatin1(data);
    // Match OSC 133;X where X is A/B/C/D, terminated by ST (\x1b\\) or BEL (\x07)
    const re = /\x1b\]133;([ABCD])[^\x07\x1b]*(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      const marker = match[1];
      this.markOscDetected('OSC 133 shell integration');

      if (marker === 'C') {
        this.setOscBusy('OSC 133;C — command started');
      } else if (marker === 'D' || marker === 'A') {
        this.setOscIdle(`OSC 133;${marker} — command finished`);
      }
    }
  }

  /**
   * Intercept OSC 9;4 (ConEmu/Windows Terminal progress indicator) sequences.
   * Format: ESC ]9;4;state;value ST
   *   state 0 → hidden (done)
   *   state 1 → default (busy)
   *   state 2 → error
   *   state 3 → indeterminate (busy)
   *   state 4 → paused
   * Strips matched sequences from the data (xterm.js doesn't handle these).
   */
  private interceptOsc9_4(data: Uint8Array): Uint8Array {
    // Fast path: skip if no ESC byte present
    if (!data.includes(0x1b)) return data;

    const text = toLatin1(data);
    const re = /\x1b\]9;4;(\d+);[^\x07\x1b]*(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;
    const ranges: [number, number][] = [];

    while ((match = re.exec(text)) !== null) {
      const state = parseInt(match[1], 10);
      this.markOscDetected('OSC 9;4 progress indicator');

      if (state === 0) {
        this.setOscIdle('OSC 9;4;0 — progress done');
      } else if (state >= 1 && state <= 4) {
        this.setOscBusy(`OSC 9;4;${state} — progress active`);
      }

      ranges.push([match.index, match.index + match[0].length]);
    }

    if (ranges.length === 0) return data;

    return stripRanges(data, ranges);
  }

  private flushOutput(): void {
    this.outputRafId = 0;
    if (this.disposed || this.pendingOutput.length === 0) return;

    let data: Uint8Array;
    if (this.pendingOutput.length === 1) {
      data = this.pendingOutput[0];
    } else {
      // Concatenate all pending chunks into a single write
      let totalLen = 0;
      for (const chunk of this.pendingOutput) totalLen += chunk.length;
      data = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of this.pendingOutput) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
    }
    this.pendingOutput = [];

    // Intercept OSC sequences for busy/idle detection
    this.interceptOsc133(data);          // read-only (does not strip)
    data = this.interceptOsc9_4(data);   // strips OSC 9;4 sequences

    // Handle Kitty keyboard protocol negotiation before xterm sees the data
    data = this.interceptKittyProtocol(data);
    if (data.length > 0) {
      // Use the persistent autoScroll flag instead of re-deriving from buffer
      // state on each flush.  Re-deriving can race: when multiple flushes
      // overlap, baseY increases from the first write but viewportY hasn't
      // caught up, causing the second flush to think the user scrolled up.
      const shouldScroll = this.autoScroll;
      this.terminal.write(data, () => {
        if (!this.disposed && shouldScroll) {
          this.terminal.scrollToBottom();
        }
        if (!this.disposed) {
          const buf = this.terminal.buffer.active;
          const atBottom = buf.viewportY >= buf.baseY;
          if (shouldScroll && !atBottom) {
            logger.debug('pty', 'scrollToBottom did not reach bottom after write', {
              paneId: this.paneId,
              viewportY: buf.viewportY,
              baseY: buf.baseY,
              rows: this.terminal.rows,
              shouldScroll,
              autoScroll: this.autoScroll,
              hidden: this.element.offsetWidth === 0,
            });
          }
        }
      });
    }
  }

  private static readonly RESIZE_THROTTLE_MS = 100;

  fit(): void {
    if (this.disposed || this.element.offsetWidth === 0) return;
    // Snapshot scroll intent before resize.  fitAddon.fit() calls
    // terminal.resize() which fires onScroll synchronously — during resize
    // the viewport position is temporarily inconsistent (viewportY < baseY),
    // causing the onScroll handler to incorrectly flip autoScroll to false.
    const wasAutoScroll = this.autoScroll;
    const prevRows = this.terminal.rows;
    const prevCols = this.terminal.cols;
    try {
      this.fitAddon.fit();
      const dims = this.fitAddon.proposeDimensions();
      if (dims && this.backendId) {
        if (dims.rows !== this.lastSentRows || dims.cols !== this.lastSentCols) {
          this.lastSentRows = dims.rows;
          this.lastSentCols = dims.cols;
          // Throttle PTY resize IPC: fire immediately on leading edge,
          // then at most once per RESIZE_THROTTLE_MS, with a trailing call
          // to ensure the final dimensions are always sent.
          const now = Date.now();
          const elapsed = now - this.lastResizeTime;
          if (this.resizeTimer) clearTimeout(this.resizeTimer);
          if (elapsed >= TerminalPane.RESIZE_THROTTLE_MS) {
            this.sendResize();
          } else {
            this.resizeTimer = setTimeout(() => {
              this.resizeTimer = null;
              this.sendResize();
            }, TerminalPane.RESIZE_THROTTLE_MS - elapsed);
          }
        }
      }
    } catch (err) {
      logger.warn('pty', 'Fit failed (element may not be visible)', {
        paneId: this.paneId,
        error: String(err),
      });
      return;
    }

    const newRows = this.terminal.rows;
    const newCols = this.terminal.cols;
    if (newRows !== prevRows || newCols !== prevCols) {
      const buf = this.terminal.buffer.active;
      logger.debug('pty', 'fit() resized terminal', {
        paneId: this.paneId,
        from: `${prevCols}x${prevRows}`,
        to: `${newCols}x${newRows}`,
        viewportY: buf.viewportY,
        baseY: buf.baseY,
        wasAutoScroll,
        autoScrollAfterResize: this.autoScroll,
      });
    }

    // Restore scroll intent and re-sync position after resize.
    // This also recovers from the hidden-pane case: scrollToBottom() calls
    // in write callbacks are no-ops while the terminal has display:none,
    // so the viewport can be stuck when the pane becomes visible again.
    if (wasAutoScroll) {
      this.autoScroll = true;
      this.terminal.scrollToBottom();
      this.scrollBtn.classList.remove('visible');

      const buf = this.terminal.buffer.active;
      if (buf.viewportY < buf.baseY) {
        logger.warn('pty', 'scrollToBottom did not reach bottom after fit()', {
          paneId: this.paneId,
          viewportY: buf.viewportY,
          baseY: buf.baseY,
          rows: newRows,
        });
      }
    }
  }

  private sendResize(): void {
    if (this.disposed || !this.backendId) return;
    this.lastResizeTime = Date.now();
    resizePtySession(this.backendId, this.lastSentRows, this.lastSentCols).catch((err) => {
      logger.error('pty', 'PTY resize IPC failed', {
        paneId: this.paneId,
        backendId: this.backendId,
        rows: this.lastSentRows,
        cols: this.lastSentCols,
        error: String(err),
      });
    });
    logger.debug('pty', 'Terminal resized', {
      paneId: this.paneId,
      rows: this.lastSentRows,
      cols: this.lastSentCols,
    });
  }

  focus(): void {
    this.terminal.focus();
    this.element.classList.add('focused');
  }

  blur(): void {
    this.element.classList.remove('focused');
  }

  applySettings(settings: AppSettings): void {
    logger.info('pty', 'Applying settings to terminal', {
      paneId: this.paneId,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      scrollback: settings.scrollbackLines,
    });

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
    logger.debug('pty', 'Clearing scrollback', { paneId: this.paneId });
    this.terminal.clear();
  }

  scrollToBottom(): void {
    const buf = this.terminal.buffer.active;
    logger.debug('pty', 'scrollToBottom (manual)', {
      paneId: this.paneId,
      viewportY: buf.viewportY,
      baseY: buf.baseY,
      rows: this.terminal.rows,
    });
    this.autoScroll = true;
    this.terminal.scrollToBottom();
    this.scrollBtn.classList.remove('visible');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.outputRafId) cancelAnimationFrame(this.outputRafId);
    if (this.resizeRafId) cancelAnimationFrame(this.resizeRafId);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.pendingOutput = [];
    // Clean up OSC busy state so tracking Sets stay consistent
    this.setOscIdle('Pane disposed while busy');
    logger.info('pty', 'Disposing terminal pane', {
      paneId: this.paneId,
      backendId: this.backendId,
      kittyStack: JSON.stringify(this.kittyModeStack),
    });
    this.resizeObserver.disconnect();
    if (this.backendId) {
      await killPtySession(this.backendId).catch((err) => {
        logger.error('pty', 'Failed to kill PTY session during dispose', {
          paneId: this.paneId,
          backendId: this.backendId,
          error: String(err),
        });
      });
    }
    this.webglAddon?.dispose();
    this.terminal.dispose();
    logger.debug('pty', 'Terminal pane disposed', { paneId: this.paneId });
  }
}
