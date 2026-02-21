// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  createTerminalPaneForTest,
  installTerminalPaneModuleMocks,
  resetPtyMocks,
} from '../helpers/terminal-pane-harness';

installTerminalPaneModuleMocks();

const encoder = new TextEncoder();

function pushAndFlush(pane: unknown, payload: string): void {
  const raw = pane as { pendingOutput: Uint8Array[]; flushOutput: () => void };
  raw.pendingOutput.push(encoder.encode(payload));
  raw.flushOutput();
}

describe('TerminalPane stress behaviour', () => {
  it('keeps viewport pinned to bottom under sustained output when auto-scroll is enabled', async () => {
    const { pane, terminal } = await createTerminalPaneForTest();
    resetPtyMocks();

    for (let i = 0; i < 4000; i++) {
      pushAndFlush(pane, `line-${i}\n`);
    }

    expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);
    await pane.dispose();
  });

  it('preserves user scrollback position under sustained output when auto-scroll is disabled', async () => {
    const { pane, terminal } = await createTerminalPaneForTest();
    resetPtyMocks();

    terminal.buffer.active.baseY = 2000;
    terminal.buffer.active.viewportY = 1700;
    (pane as unknown as { autoScroll: boolean }).autoScroll = false;

    for (let i = 0; i < 2500; i++) {
      pushAndFlush(pane, `burst-${i}\n`);
    }

    expect(terminal.buffer.active.viewportY).toBeLessThan(terminal.buffer.active.baseY);
    await pane.dispose();
  });

  it('holds scroll invariants across randomized high-pressure output, scroll, and visibility changes', async () => {
    const { pane, terminal, setHidden } = await createTerminalPaneForTest();
    resetPtyMocks();

    let rng = 0x12345678;
    const nextRand = (): number => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 0x100000000;
    };

    for (let i = 0; i < 3000; i++) {
      const r = nextRand();

      if (r < 0.08) {
        // User scrolls up into scrollback
        terminal.buffer.active.viewportY = Math.max(0, terminal.buffer.active.baseY - 120);
        (pane as unknown as { autoScroll: boolean }).autoScroll = false;
      } else if (r < 0.14) {
        // User requests bottom sync
        pane.scrollToBottom();
      } else if (r < 0.18) {
        // Simulate pane hide/show transitions
        setHidden(true);
        setHidden(false);
      }

      pushAndFlush(pane, `rnd-${i}-${'x'.repeat(20)}\n`);

      const autoScroll = (pane as unknown as { autoScroll: boolean }).autoScroll;
      expect(terminal.buffer.active.viewportY).toBeLessThanOrEqual(terminal.buffer.active.baseY);
      if (autoScroll) {
        expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);
      }
    }

    await pane.dispose();
  });
});
