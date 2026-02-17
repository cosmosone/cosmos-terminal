import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'python',
    rules: [
      // Triple-quoted strings (must come before single-line strings)
      { pattern: /"""[\s\S]*?"""/y, token: 'string' },
      { pattern: /'''[\s\S]*?'''/y, token: 'string' },
      // F-string / raw string prefixes with triple quotes
      { pattern: /[fFrRbBuU]{1,2}"""[\s\S]*?"""/y, token: 'string' },
      { pattern: /[fFrRbBuU]{1,2}'''[\s\S]*?'''/y, token: 'string' },
      // Single-line strings with prefixes
      { pattern: /[fFrRbBuU]{1,2}"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      { pattern: /[fFrRbBuU]{1,2}'(?:\\[\s\S]|[^'\\\n])*'/y, token: 'string' },
      // Regular strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:\\[\s\S]|[^'\\\n])*'/y, token: 'string' },
      // Comments
      { pattern: /#[^\n]*/y, token: 'comment' },
      // Decorators
      { pattern: /@[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/y, token: 'decorator' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+[jJ]?/y, token: 'number' },
      { pattern: /0[bB][01_]+/y, token: 'number' },
      { pattern: /0[oO][0-7_]+/y, token: 'number' },
      { pattern: /\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d[\d_]*)?[jJ]?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:True|False|None|NotImplemented|Ellipsis|__name__|__main__)\b/y, token: 'constant' },
      // Built-in types
      { pattern: /\b(?:int|float|str|bool|list|dict|set|tuple|bytes|bytearray|memoryview|range|frozenset|complex|type|object|super|classmethod|staticmethod|property)\b/y, token: 'type' },
      // Built-in functions
      { pattern: /\b(?:print|len|range|enumerate|zip|map|filter|sorted|reversed|any|all|min|max|sum|abs|round|input|open|isinstance|issubclass|hasattr|getattr|setattr|delattr|repr|id|hash|iter|next|callable|vars|dir|help|type)\b(?=\s*\()/y, token: 'function' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/y, token: 'function' },
      // Operators
      { pattern: /\*\*=?|\/\/=?|<<=?|>>=?|[!=<>]=|[+\-*/%@&|^~]=?|:=|->|\.{3}/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('python', create);
