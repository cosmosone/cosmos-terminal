import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'kotlin',
    rules: [
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Triple-quoted strings
      { pattern: /"""[\s\S]*?"""/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|\$\{[^}]*\}|\$\w+|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:\\[\s\S]|[^'\\\n])'/y, token: 'string' },
      // Annotations
      { pattern: /@[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/y, token: 'decorator' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+[lL]?/y, token: 'number' },
      { pattern: /0[bB][01_]+[lL]?/y, token: 'number' },
      { pattern: /\d[\d_]*\.[\d_]*(?:[eE][+-]?\d[\d_]*)?[fF]?/y, token: 'number' },
      { pattern: /\d[\d_]*[lLfF]?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:abstract|actual|annotation|as|break|by|catch|class|companion|const|constructor|continue|crossinline|data|delegate|do|dynamic|else|enum|expect|external|final|finally|for|fun|get|if|import|in|infix|init|inline|inner|interface|internal|is|lateinit|noinline|object|open|operator|out|override|package|private|protected|public|reified|return|sealed|set|super|suspend|tailrec|this|throw|try|typealias|val|var|vararg|when|where|while|yield)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|null)\b/y, token: 'constant' },
      // Types
      { pattern: /\b(?:Any|Boolean|Byte|Char|Double|Float|Int|Long|Nothing|Number|Short|String|Unit|Array|List|Map|Set|MutableList|MutableMap|MutableSet|Pair|Triple|Sequence|Iterable)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*[(<])/y, token: 'function' },
      // Operators
      { pattern: /\.{2}|->|=>|\?\.|!!|\?:|::|\?\?|&&|\|\||[!=<>]=?|[+\-*/%&|^]=?|[!~?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('kotlin', create);
