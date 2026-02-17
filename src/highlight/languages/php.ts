import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'php',
    rules: [
      // Multi-line comments / PHPDoc
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      { pattern: /#[^\n]*/y, token: 'comment' },
      // Heredoc/Nowdoc
      { pattern: /<<<'(\w+)'[\s\S]*?\n\1;?/y, token: 'string' },
      { pattern: /<<<(\w+)[\s\S]*?\n\1;?/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|\{\$[^}]+\}|\$[a-zA-Z_]\w*|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:\\[\s\S]|[^'\\\n])*'/y, token: 'string' },
      // Variables
      { pattern: /\$[a-zA-Z_]\w*/y, token: 'property' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+/y, token: 'number' },
      { pattern: /0[bB][01_]+/y, token: 'number' },
      { pattern: /0[oO][0-7_]+/y, token: 'number' },
      { pattern: /\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d[\d_]*)?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|die|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|enum|eval|exit|extends|final|finally|fn|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|match|namespace|new|or|print|private|protected|public|readonly|require|require_once|return|static|switch|this|throw|trait|try|unset|use|var|while|xor|yield)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|null|TRUE|FALSE|NULL|__CLASS__|__DIR__|__FILE__|__FUNCTION__|__LINE__|__METHOD__|__NAMESPACE__|__TRAIT__)\b/y, token: 'constant' },
      // Types
      { pattern: /\b(?:int|float|string|bool|array|object|void|never|mixed|iterable|self|parent|static|null)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/y, token: 'function' },
      // Operators
      { pattern: /=>|->|::|\.{3}|\?\?=?|\?->|<=>|&&|\|\||<<=?|>>=?|[!=<>]=?|[+\-*/%&|^~.]=?|[!~@?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('php', create);
