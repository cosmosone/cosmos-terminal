// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readStyle(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

const STYLE_TEXT = [
  readStyle('src/styles/layout.css'),
  readStyle('src/styles/file-tab.css'),
].join('\n');

describe('file tab layout scroll sizing', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;
    document.head.appendChild(style);

    document.body.innerHTML = `
      <div id="app">
        <div id="main-content">
          <div id="terminal-container"></div>
          <div id="file-tab-container">
            <div class="file-tab-header"></div>
            <div class="file-tab-content"></div>
          </div>
        </div>
      </div>
    `;
  });

  it('keeps main-content children shrinkable to avoid clipped scroll ranges', () => {
    const terminalContainer = document.getElementById('terminal-container') as HTMLElement;
    const fileTabContainer = document.getElementById('file-tab-container') as HTMLElement;

    expect(getComputedStyle(terminalContainer).minHeight).toBe('0px');
    expect(getComputedStyle(fileTabContainer).minHeight).toBe('0px');
  });

  it('keeps file-tab content as a dedicated scroll container', () => {
    const content = document.querySelector('.file-tab-content') as HTMLElement;
    const styles = getComputedStyle(content);

    expect(styles.minHeight).toBe('0px');

    const rules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);

    const fileTabContentRule = rules.find((rule) => rule.selectorText === '.file-tab-content');

    expect(fileTabContentRule).toBeDefined();
    expect(fileTabContentRule?.style.overflow).toBe('auto');
  });
});
