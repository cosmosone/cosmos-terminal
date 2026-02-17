import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'swift',
    rules: [
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Compiler directives
      { pattern: /#(?:if|elseif|else|endif|available|sourceLocation|warning|error|selector|keyPath|colorLiteral|fileLiteral|imageLiteral)\b[^\n]*/y, token: 'meta' },
      // Multi-line strings
      { pattern: /"""[\s\S]*?"""/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|\\\([^)]*\)|[^"\\\n])*"/y, token: 'string' },
      // Attributes
      { pattern: /@[a-zA-Z_]\w*/y, token: 'decorator' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+(?:\.[0-9a-fA-F_]+)?(?:[pP][+-]?\d[\d_]*)?/y, token: 'number' },
      { pattern: /0[bB][01_]+/y, token: 'number' },
      { pattern: /0[oO][0-7_]+/y, token: 'number' },
      { pattern: /\d[\d_]*\.[\d_]+(?:[eE][+-]?\d[\d_]*)?/y, token: 'number' },
      { pattern: /\d[\d_]*/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:actor|any|as|associatedtype|async|await|break|case|catch|class|continue|convenience|deinit|default|defer|do|dynamic|else|enum|extension|fallthrough|fileprivate|final|for|func|get|guard|if|import|in|indirect|infix|init|inout|internal|is|isolated|lazy|let|macro|mutating|nonisolated|nonmutating|open|operator|optional|override|package|postfix|precedencegroup|prefix|private|protocol|public|repeat|required|rethrows|return|self|Self|set|some|static|struct|subscript|super|switch|throws|try|typealias|unowned|var|weak|where|while|willSet|didSet)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|nil)\b/y, token: 'constant' },
      // Types
      { pattern: /\b(?:Int|Int8|Int16|Int32|Int64|UInt|UInt8|UInt16|UInt32|UInt64|Float|Double|Bool|String|Character|Array|Dictionary|Set|Optional|Result|Void|Any|AnyObject|Error|Codable|Equatable|Hashable|Comparable|Identifiable|Sendable)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*[(<])/y, token: 'function' },
      // Operators
      { pattern: /\.{2,3}<?|->|=>|&&|\|\||[!=<>]=?|[+\-*/%&|^~]=?|\?\?|[?!.:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];,]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('swift', create);
