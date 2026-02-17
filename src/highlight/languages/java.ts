import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'java',
    rules: [
      // Multi-line comments / Javadoc
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Text blocks (triple-quoted)
      { pattern: /"""[\s\S]*?"""/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      // Char literals
      { pattern: /'(?:\\[\s\S]|[^'\\\n])'/y, token: 'string' },
      // Annotations
      { pattern: /@[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/y, token: 'decorator' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+[lL]?/y, token: 'number' },
      { pattern: /0[bB][01_]+[lL]?/y, token: 'number' },
      { pattern: /\d[\d_]*\.[\d_]*(?:[eE][+-]?\d[\d_]*)?[fFdD]?/y, token: 'number' },
      { pattern: /\d[\d_]*[lLfFdD]?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:abstract|assert|break|case|catch|class|continue|default|do|else|enum|extends|final|finally|for|if|implements|import|instanceof|interface|native|new|package|private|protected|public|return|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|volatile|while|var|record|sealed|non-sealed|permits|yield|when)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|null)\b/y, token: 'constant' },
      // Primitive types
      { pattern: /\b(?:boolean|byte|char|double|float|int|long|short|void|String|Integer|Long|Double|Float|Boolean|Character|Byte|Short|Object|Class|System|Thread|Runnable|Exception|RuntimeException)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/y, token: 'function' },
      // Operators
      { pattern: />>>?=?|<<=?|->|&&|\|\||[!=<>]=?|[+\-*/%&|^~]=?|[?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('java', create);
