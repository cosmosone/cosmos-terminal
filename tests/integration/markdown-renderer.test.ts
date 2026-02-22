import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMarkdownRenderCache,
  getMarkdownRenderCacheStats,
  renderMarkdown,
  renderMarkdownCached,
} from '../../src/services/markdown-renderer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES_ROOT = resolve(ROOT, 'tests/fixtures/markdown');

function readFixture(relativePath: string): string {
  return readFileSync(resolve(FIXTURES_ROOT, relativePath), 'utf8');
}

function fixtureFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...fixtureFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function toFixtureRelative(fullPath: string): string {
  return fullPath.slice(FIXTURES_ROOT.length + 1).replace(/\\/g, '/');
}

describe('markdown renderer', () => {
  beforeEach(() => {
    clearMarkdownRenderCache();
  });

  it('preserves explicit blank lines as spacer paragraphs', () => {
    const source = readFixture('edge/blank-lines.md');
    const html = renderMarkdown(source);

    const spacerCount = (html.match(/class="md-empty-line"/g) ?? []).length;
    expect(spacerCount).toBeGreaterThanOrEqual(5);
    expect(html).toContain('<h1>Blank Line Preservation</h1>');
    expect(html).toContain('<h2>Next Section</h2>');
  });

  it('enforces safe-link protocol policy and hardening attributes', () => {
    const source = readFixture('edge/links.md');
    const html = renderMarkdown(source);

    expect(html).toContain('href="https://openai.com"');
    expect(html).toContain('href="mailto:test@example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="file:///');
    expect(html).not.toContain('href="javascript:');
  });

  it('sanitizes raw html and script-like payloads', () => {
    const source = readFixture('edge/security.md');
    const html = renderMarkdown(source);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('onclick=');
    expect(html).toContain('inline in code is safe text');
  });

  it('renders CRLF and LF input consistently', () => {
    const crlf = readFixture('edge/crlf.md');
    const lf = crlf.replace(/\r\n/g, '\n');

    expect(renderMarkdown(crlf)).toBe(renderMarkdown(lf));
  });

  it('reuses cached results for repeated renders', () => {
    const source = readFixture('edge/large.md');

    const first = renderMarkdownCached('edge/large.md', source, 1234);
    const second = renderMarkdownCached('edge/large.md', source, 1234);

    expect(second).toBe(first);
    expect(getMarkdownRenderCacheStats()).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
    });
  });

  it('matches snapshot output for the fixture corpus', () => {
    const files = fixtureFiles(FIXTURES_ROOT)
      .map((f) => toFixtureRelative(f))
      .filter((relativePath) => relativePath !== 'edge/large.md')
      .sort();

    const outputs = Object.fromEntries(
      files.map((relativePath) => {
        const html = renderMarkdown(readFixture(relativePath));
        return [relativePath, html];
      }),
    );

    expect(outputs).toMatchSnapshot();
  });
});
