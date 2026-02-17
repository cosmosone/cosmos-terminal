import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'shell',
    rules: [
      // Comments
      { pattern: /#[^\n]*/y, token: 'comment' },
      // Heredocs (simplified)
      { pattern: /<<-?'(\w+)'[\s\S]*?\n\1/y, token: 'string' },
      { pattern: /<<-?(\w+)[\s\S]*?\n\1/y, token: 'string' },
      // ANSI-C quoting
      { pattern: /\$'(?:\\[\s\S]|[^'\\])*'/y, token: 'string' },
      // Double-quoted strings
      { pattern: /"(?:\\[\s\S]|\$\{[^}]*\}|\$[a-zA-Z_]\w*|\$\([^)]*\)|[^"\\\n])*"/y, token: 'string' },
      // Single-quoted strings
      { pattern: /'[^']*'/y, token: 'string' },
      // Variables
      { pattern: /\$\{[^}]*\}/y, token: 'property' },
      { pattern: /\$[a-zA-Z_]\w*/y, token: 'property' },
      { pattern: /\$[0-9@*#?$!-]/y, token: 'property' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F]+/y, token: 'number' },
      { pattern: /\d+/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:if|then|else|elif|fi|case|esac|for|while|until|do|done|in|function|select|time|coproc)\b/y, token: 'keyword' },
      // Built-in commands
      { pattern: /\b(?:echo|printf|read|cd|pwd|pushd|popd|dirs|export|unset|local|declare|typeset|readonly|set|shopt|source|eval|exec|exit|return|shift|trap|wait|kill|test|true|false|alias|unalias|type|which|hash|getopts|let|bg|fg|jobs|disown|suspend|builtin|command|enable|help|logout|mapfile|readarray|ulimit|umask)\b/y, token: 'function' },
      // Operators
      { pattern: /\|\||&&|;;|[;&|]|>>|>|<<|<|2>&1|&>/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\]]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('shell', create);
