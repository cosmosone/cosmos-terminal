import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readUtf8(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function extractIpcMapCommands(ipcSource: string): string[] {
  return uniqueSorted(
    [...ipcSource.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]),
  );
}

function extractGenerateHandlerCommands(libSource: string): string[] {
  const body = libSource.match(/generate_handler!\[(?<body>[\s\S]*?)\]/m)?.groups?.body ?? '';
  return uniqueSorted(
    [...body.matchAll(/::([a-z_]+)\s*,/g)].map((m) => m[1]),
  );
}

describe('IPC drift protection', () => {
  it('keeps TS IPC command map aligned with Rust generate_handler list', () => {
    const ipcSource = readUtf8('src/services/ipc.ts');
    const libSource = readUtf8('src-tauri/src/lib.rs');

    const tsCommands = extractIpcMapCommands(ipcSource);
    const rustCommands = extractGenerateHandlerCommands(libSource);

    const missingInTs = rustCommands.filter((cmd) => !tsCommands.includes(cmd));
    const missingInRust = tsCommands.filter((cmd) => !rustCommands.includes(cmd));

    expect(missingInTs).toEqual([]);
    expect(missingInRust).toEqual([]);
  });

  it('prevents raw string-based invoke calls in service wrappers', () => {
    const serviceFiles = [
      'src/services/fs-service.ts',
      'src/services/git-service.ts',
      'src/services/pty-service.ts',
      'src/services/system-monitor.ts',
    ];

    const rawInvokeRegex = /\binvoke(?:<[^>]+>)?\(\s*['"][a-z_]+['"]/;

    for (const file of serviceFiles) {
      const source = readUtf8(file);
      expect(source).not.toMatch(rawInvokeRegex);
    }
  });
});
