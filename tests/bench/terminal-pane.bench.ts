// @vitest-environment jsdom

import { afterAll, bench, describe } from 'vitest';
import {
  createTerminalPaneForTest,
  installTerminalPaneModuleMocks,
  ptyMocks,
  resetPtyMocks,
} from '../helpers/terminal-pane-harness';

installTerminalPaneModuleMocks();

const encoder = new TextEncoder();
const originalDateNow = Date.now;

Date.now = (() => {
  let now = 0;
  return () => {
    now += 200;
    return now;
  };
})();

afterAll(() => {
  Date.now = originalDateNow;
});

describe('TerminalPane frontend benchmarks', async () => {
  const { pane, fitAddon } = await createTerminalPaneForTest();
  (pane as unknown as { backendId: string | null }).backendId = 'bench-session';

  bench('output flush latency (2000 chunks)', () => {
    const raw = pane as unknown as { pendingOutput: Uint8Array[]; flushOutput: () => void };
    raw.pendingOutput = [];

    for (let i = 0; i < 2000; i++) {
      raw.pendingOutput.push(encoder.encode(`bench-line-${i}-xxxxxxxxxxxxxxxxxxxxxxxx\n`));
    }
    raw.flushOutput();
  });

  bench('resize fit latency (200 fits)', () => {
    resetPtyMocks();
    for (let i = 0; i < 200; i++) {
      fitAddon.setDimensions(24 + (i % 20), 80 + (i % 40));
      pane.fit();
    }
  });

  bench('resize IPC dispatch count (200 fits)', () => {
    resetPtyMocks();
    for (let i = 0; i < 200; i++) {
      fitAddon.setDimensions(30 + (i % 15), 100 + (i % 30));
      pane.fit();
    }
    // Keep benchmark side effects alive so vitest doesn't prune the call path.
    const dispatchCount = ptyMocks.resizePtySession.mock.calls.length;
    if (dispatchCount < 0) {
      throw new Error('unreachable');
    }
  });
});
