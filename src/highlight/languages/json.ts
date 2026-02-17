import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'json',
    rules: [
      // JSONC comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Property keys (string before colon)
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"(?=\s*:)/y, token: 'property' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      // Numbers
      { pattern: /-?\d+\.?\d*(?:[eE][+-]?\d+)?/y, token: 'number' },
      // Constants
      { pattern: /\b(?:true|false|null)\b/y, token: 'constant' },
      // Punctuation
      { pattern: /[{}()\[\]:,]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('json', create);
