import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'ruby',
    rules: [
      // Block comments =begin...=end
      { pattern: /^=begin[\s\S]*?^=end/ym, token: 'comment' },
      // Single-line comments
      { pattern: /#[^\n]*/y, token: 'comment' },
      // Heredocs (simplified)
      { pattern: /<<[-~]?'(\w+)'[\s\S]*?\n\1/y, token: 'string' },
      { pattern: /<<[-~]?"?(\w+)"?[\s\S]*?\n\1/y, token: 'string' },
      // Regex literals
      { pattern: /\/(?:\\.|[^/\\\n])+\/[imxouesn]*/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|#\{[^}]*\}|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:\\[\s\S]|[^'\\\n])*'/y, token: 'string' },
      // Symbols
      { pattern: /:[a-zA-Z_]\w*[?!]?/y, token: 'constant' },
      // Class/instance/global variables
      { pattern: /@@?[a-zA-Z_]\w*/y, token: 'property' },
      { pattern: /\$[a-zA-Z_]\w*/y, token: 'property' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+/y, token: 'number' },
      { pattern: /0[bB][01_]+/y, token: 'number' },
      { pattern: /0[oO]?[0-7_]+/y, token: 'number' },
      { pattern: /\d[\d_]*\.[\d_]+(?:[eE][+-]?\d[\d_]*)?/y, token: 'number' },
      { pattern: /\d[\d_]*/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:alias|and|begin|break|case|class|def|defined\?|do|else|elsif|end|ensure|extend|for|if|in|include|module|next|nil|not|or|prepend|raise|redo|require|require_relative|rescue|retry|return|self|super|then|unless|until|when|while|yield|__FILE__|__LINE__|__dir__)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|nil|TRUE|FALSE|NIL|ARGV|STDIN|STDOUT|STDERR)\b/y, token: 'constant' },
      // Types (capitalized identifiers)
      { pattern: /\b[A-Z]\w*\b/y, token: 'type' },
      // Function calls / method calls
      { pattern: /\b[a-z_]\w*[?!]?(?=\s*[({])/y, token: 'function' },
      // Operators
      { pattern: /\.{2,3}|<=>|=>|&&|\|\||<<=?|>>=?|[!=<>]=?|[+\-*/%&|^~]=?|[!~?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('ruby', create);
