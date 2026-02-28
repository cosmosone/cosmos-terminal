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

async function waitForFrames(count = 2): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('TerminalPane stress behaviour', () => {
  it('keeps viewport pinned to bottom under sustained output when follow-output is enabled', async () => {
    const { pane, terminal } = await createTerminalPaneForTest();
    resetPtyMocks();
    await pane.mount();

    for (let i = 0; i < 4000; i++) {
      pushAndFlush(pane, `line-${i}\n`);
    }

    await waitForFrames(4);
    expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);
    await pane.dispose();
  });

  it('preserves user scrollback position under sustained output when follow-output is disabled', async () => {
    const { pane, terminal } = await createTerminalPaneForTest();
    resetPtyMocks();
    await pane.mount();

    terminal.buffer.active.baseY = 2000;
    terminal.buffer.active.viewportY = 1700;
    (pane as unknown as { followOutput: boolean }).followOutput = false;

    for (let i = 0; i < 2500; i++) {
      pushAndFlush(pane, `burst-${i}\n`);
    }

    expect(terminal.buffer.active.viewportY).toBeLessThan(terminal.buffer.active.baseY);
    await pane.dispose();
  });

  it('holds scroll invariants across randomized high-pressure output, scroll, and visibility changes', async () => {
    const { pane, terminal, setHidden } = await createTerminalPaneForTest();
    resetPtyMocks();
    await pane.mount();

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
        (pane as unknown as { followOutput: boolean }).followOutput = false;
      } else if (r < 0.14) {
        // User requests bottom sync
        pane.scrollToBottom();
      } else if (r < 0.18) {
        // Simulate pane hide/show transitions
        setHidden(true);
        setHidden(false);
      }

      pushAndFlush(pane, `rnd-${i}-${'x'.repeat(20)}\n`);
      if (i % 20 === 0) {
        await waitForFrames();
      }

      const followOutput = (pane as unknown as { followOutput: boolean }).followOutput;
      expect(terminal.buffer.active.viewportY).toBeLessThanOrEqual(terminal.buffer.active.baseY);
      expect(typeof followOutput).toBe('boolean');
    }

    await waitForFrames(6);
    const finalFollowOutput = (pane as unknown as { followOutput: boolean }).followOutput;
    if (finalFollowOutput) {
      expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);
    }

    await pane.dispose();
  });

  it('disables follow-output on wheel-up at bottom and restores on manual bottom request', async () => {
    const { pane, terminal } = await createTerminalPaneForTest();
    resetPtyMocks();
    await pane.mount();

    terminal.buffer.active.baseY = 400;
    terminal.buffer.active.viewportY = 400;
    terminal.dispatchWheel(-120);

    expect((pane as unknown as { followOutput: boolean }).followOutput).toBe(false);

    pane.scrollToBottom();
    await waitForFrames();
    expect((pane as unknown as { followOutput: boolean }).followOutput).toBe(true);
    expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);

    await pane.dispose();
  });

  it('reconciles to bottom after hide/show when follow-output remains enabled', async () => {
    const { pane, terminal } = await createTerminalPaneForTest();
    resetPtyMocks();
    await pane.mount();

    terminal.buffer.active.baseY = 1200;
    terminal.buffer.active.viewportY = 900;
    (pane as unknown as { followOutput: boolean }).followOutput = true;

    pane.setVisible(false);
    pane.setVisible(true);

    await waitForFrames(6);
    expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);
    expect(pane.element.style.display).toBe('');

    await pane.dispose();
  });

  it('recovers follow-output after simulated alt-buffer exit viewport jump', async () => {
    const { pane, terminal } = await createTerminalPaneForTest();
    resetPtyMocks();
    await pane.mount();

    terminal.buffer.active.baseY = 1800;
    terminal.buffer.active.viewportY = 1800;

    // Simulate alternate buffer enter/exit transitions that can desync viewport.
    terminal.buffer.active.baseY = 0;
    terminal.buffer.active.viewportY = 0;
    terminal.buffer.active.baseY = 2100;
    terminal.buffer.active.viewportY = 1700;

    pushAndFlush(pane, 'post-alt-buffer\n');
    await waitForFrames(6);

    expect((pane as unknown as { followOutput: boolean }).followOutput).toBe(true);
    expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);

    await pane.dispose();
  });
});
