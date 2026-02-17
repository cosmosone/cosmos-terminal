import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'typescript',
    rules: [
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Regex literals
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
      // TS-specific keywords
      { pattern: /\b(?:abstract|as|asserts|async|await|break|case|catch|class|const|constructor|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|infer|instanceof|interface|is|keyof|let|module|namespace|never|new|of|override|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|unique|unknown|var|void|while|with|yield)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|null|undefined|NaN|Infinity)\b/y, token: 'constant' },
      // Utility types
      { pattern: /\b(?:Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|Parameters|ReturnType|InstanceType|Awaited|Uppercase|Lowercase|Capitalize|Uncapitalize)\b/y, token: 'type' },
      // Built-in types
      { pattern: /\b(?:Array|Boolean|Date|Error|Function|JSON|Map|Math|Number|Object|Promise|Proxy|Reflect|RegExp|Set|String|Symbol|WeakMap|WeakSet|BigInt|console|globalThis|window|document|any|string|number|boolean|symbol|bigint|object|void|never|unknown)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_$][\w$]*(?=\s*[\(<])/y, token: 'function' },
      // Decorators
      { pattern: /@[a-zA-Z_$][\w$]*/y, token: 'decorator' },
      // Operators
      { pattern: /=>|\.{3}|\?\?|[!=]==?|[<>]=?|&&|\|\||[+\-*/%]=?|[&|^~]=?|<<=?|>>>?=?|\?\.|[!?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('typescript', create);
