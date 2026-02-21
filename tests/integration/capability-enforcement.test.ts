import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readUtf8(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('Capability enforcement', () => {
  it('keeps default capability least-privilege for active plugin usage', () => {
    const capability = JSON.parse(readUtf8('src-tauri/capabilities/default.json')) as {
      permissions: string[];
    };

    const permissions = [...capability.permissions].sort();
    const expected = ['core:default', 'dialog:allow-open', 'shell:default', 'store:default'].sort();
    expect(permissions).toEqual(expected);

    expect(permissions).not.toContain('dialog:default');
    expect(permissions).not.toContain('shell:allow-execute');
    expect(permissions).not.toContain('shell:allow-spawn');
    expect(permissions).not.toContain('shell:allow-stdin-write');
  });

  it('matches actual plugin command usage in frontend + tauri config', () => {
    const projectTabs = readUtf8('src/components/project-tab-bar.ts');
    const terminalPane = readUtf8('src/components/terminal-pane.ts');
    const capability = JSON.parse(readUtf8('src-tauri/capabilities/default.json')) as {
      permissions: string[];
    };
    const tauriConfig = JSON.parse(readUtf8('src-tauri/tauri.conf.json')) as {
      plugins?: { shell?: { open?: boolean } };
    };

    if (projectTabs.includes("@tauri-apps/plugin-dialog")) {
      expect(capability.permissions).toContain('dialog:allow-open');
    }

    if (terminalPane.includes("@tauri-apps/plugin-shell")) {
      expect(capability.permissions).toContain('shell:default');
      expect(tauriConfig.plugins?.shell?.open).toBe(true);
    }
  });
});
