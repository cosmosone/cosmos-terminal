import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'toml',
    rules: [
      // Comments
      { pattern: /#[^\n]*/y, token: 'comment' },
      // Table headers
      { pattern: /\[\[[^\]]*\]\]/y, token: 'tag' },
      { pattern: /\[[^\]]*\]/y, token: 'tag' },
      // Multi-line literal strings
      { pattern: /'''[\s\S]*?'''/y, token: 'string' },
      // Multi-line basic strings
      { pattern: /"""[\s\S]*?"""/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'[^'\n]*'/y, token: 'string' },
      // Dates/times
      { pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/y, token: 'number' },
      { pattern: /\d{4}-\d{2}-\d{2}/y, token: 'number' },
      { pattern: /\d{2}:\d{2}:\d{2}(?:\.\d+)?/y, token: 'number' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+/y, token: 'number' },
      { pattern: /0[oO][0-7_]+/y, token: 'number' },
      { pattern: /0[bB][01_]+/y, token: 'number' },
      { pattern: /[+-]?(?:inf|nan)\b/y, token: 'number' },
      { pattern: /[+-]?\d[\d_]*\.[\d_]+(?:[eE][+-]?\d[\d_]*)?/y, token: 'number' },
      { pattern: /[+-]?\d[\d_]*/y, token: 'number' },
      // Constants
      { pattern: /\b(?:true|false)\b/y, token: 'constant' },
      // Keys (bare or dotted)
      { pattern: /[a-zA-Z_][\w-]*(?=\s*[=.])/y, token: 'property' },
      // Operators
      { pattern: /[=.]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}\[\],]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('toml', create);
