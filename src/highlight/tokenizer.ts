import type { Grammar, Token } from './types';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function tokenize(source: string, grammar: Grammar): Token[] {
  const tokens: Token[] = [];
  const { rules } = grammar;
  let pos = 0;
  let plainStart = -1;

  while (pos < source.length) {
    let matched = false;
    for (const rule of rules) {
      rule.pattern.lastIndex = pos;
      const m = rule.pattern.exec(source);
      if (m && m.index === pos) {
        // Flush accumulated plain text
        if (plainStart !== -1) {
          tokens.push({ type: null, value: source.slice(plainStart, pos) });
          plainStart = -1;
        }
        tokens.push({ type: rule.token, value: m[0] });
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (plainStart === -1) plainStart = pos;
      pos++;
    }
  }

  // Flush remaining plain text
  if (plainStart !== -1) {
    tokens.push({ type: null, value: source.slice(plainStart, pos) });
  }

  return tokens;
}

export function tokensToHtml(tokens: Token[]): string {
  let html = '';
  for (const token of tokens) {
    const escaped = escapeHtml(token.value);
    if (token.type) {
      html += `<span class="tok-${token.type}">${escaped}</span>`;
    } else {
      html += escaped;
    }
  }
  return html;
}
