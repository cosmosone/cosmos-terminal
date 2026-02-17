import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'javascript',
    rules: [
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Regex literals (after operator context)
      { pattern: /\/(?![/*])(?:\\.|[^/\\\n])+\/[gimsuy]*/y, token: 'string' },
      // Template literals
      { pattern: /`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:\\[\s\S]|[^'\\\n])*'/y, token: 'string' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+n?/y, token: 'number' },
      { pattern: /0[bB][01_]+n?/y, token: 'number' },
      { pattern: /0[oO][0-7_]+n?/y, token: 'number' },
      { pattern: /\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d[\d_]*)?n?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|null|undefined|NaN|Infinity)\b/y, token: 'constant' },
      // Built-in types / globals
      { pattern: /\b(?:Array|Boolean|Date|Error|Function|JSON|Map|Math|Number|Object|Promise|Proxy|Reflect|RegExp|Set|String|Symbol|WeakMap|WeakSet|BigInt|console|globalThis|window|document)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_$][\w$]*(?=\s*\()/y, token: 'function' },
      // Decorators
      { pattern: /@[a-zA-Z_$][\w$]*/y, token: 'decorator' },
      // Operators
      { pattern: /=>|\.{3}|\?\?|[!=]==?|[<>]=?|&&|\|\||[+\-*/%]=?|[&|^~]=?|<<=?|>>>?=?|\?\.|[!?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('javascript', create);
