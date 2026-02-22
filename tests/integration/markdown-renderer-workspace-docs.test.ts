import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/services/markdown-renderer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'logs',
  'src-tauri',
]);

function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      out.push(...collectMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(fullPath);
    }
  }

  return out;
}

function toRelative(path: string): string {
  return path.slice(ROOT.length + 1).replace(/\\/g, '/');
}

describe('markdown renderer workspace validation', () => {
  it('renders real workspace markdown files without unsafe link/script output', () => {
    const files = collectMarkdownFiles(ROOT)
      .filter((f) => !toRelative(f).startsWith('tests/fixtures/markdown/'))
      .sort();

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const html = renderMarkdown(source);

      expect(html.length).toBeGreaterThan(0);
      expect(html).not.toContain('<script>');
      expect(html).not.toMatch(/href=["']javascript:/i);
    }
  });
});
