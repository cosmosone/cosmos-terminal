import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'dart',
    rules: [
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments / doc comments
      { pattern: /\/\/\/?[^\n]*/y, token: 'comment' },
      // Triple-quoted strings
      { pattern: /"""[\s\S]*?"""/y, token: 'string' },
      { pattern: /'''[\s\S]*?'''/y, token: 'string' },
      // Raw strings
      { pattern: /r"[^"]*"/y, token: 'string' },
      { pattern: /r'[^']*'/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|\$\{[^}]*\}|\$\w+|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:\\[\s\S]|\$\{[^}]*\}|\$\w+|[^'\\\n])*'/y, token: 'string' },
      // Annotations / metadata
      { pattern: /@[a-zA-Z_]\w*/y, token: 'decorator' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F]+/y, token: 'number' },
      { pattern: /\d+\.?\d*(?:[eE][+-]?\d+)?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:abstract|as|assert|async|await|base|break|case|catch|class|const|continue|covariant|default|deferred|do|dynamic|else|enum|export|extends|extension|external|factory|final|finally|for|Function|get|hide|if|implements|import|in|interface|is|late|library|mixin|new|null|on|operator|part|required|rethrow|return|sealed|set|show|static|super|switch|sync|this|throw|try|typedef|var|void|while|with|yield)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|null)\b/y, token: 'constant' },
      // Types
      { pattern: /\b(?:int|double|num|String|bool|List|Map|Set|Iterable|Future|Stream|Object|dynamic|void|Never|Null|Type|Symbol|Function|Record)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*[(<])/y, token: 'function' },
      // Cascade, null-aware, spread
      { pattern: /\.{2,3}\??|=>|\?\?=?|\?\.|\?\[|[!=<>]=?|&&|\|\||[+\-*~/%&|^]=?|<<=?|>>=?|>>>=?/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('dart', create);
