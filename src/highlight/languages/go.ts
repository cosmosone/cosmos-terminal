import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'go',
    rules: [
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Raw backtick strings
      { pattern: /`[^`]*`/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      // Rune literals
      { pattern: /'(?:\\[\s\S]|[^'\\\n])'/y, token: 'string' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+/y, token: 'number' },
      { pattern: /0[bB][01_]+/y, token: 'number' },
      { pattern: /0[oO][0-7_]+/y, token: 'number' },
      { pattern: /\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d[\d_]*)?i?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|nil|iota)\b/y, token: 'constant' },
      // Built-in types
      { pattern: /\b(?:bool|byte|complex64|complex128|error|float32|float64|int|int8|int16|int32|int64|rune|string|uint|uint8|uint16|uint32|uint64|uintptr|any|comparable)\b/y, token: 'type' },
      // Built-in functions
      { pattern: /\b(?:append|cap|clear|close|complex|copy|delete|imag|len|make|max|min|new|panic|print|println|real|recover)\b(?=\s*\()/y, token: 'function' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/y, token: 'function' },
      // Operators
      { pattern: /:=|<-|\.{3}|&&|\|\||<<=?|>>=?|&\^=?|[!=<>]=?|[+\-*/%&|^]=?|[!~]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('go', create);
