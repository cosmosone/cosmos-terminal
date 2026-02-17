import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'yaml',
    rules: [
      // Comments
      { pattern: /#[^\n]*/y, token: 'comment' },
      // Document markers
      { pattern: /^(?:---|\.\.\.)\s*$/ym, token: 'meta' },
      // Tags
      { pattern: /!![a-zA-Z]+/y, token: 'type' },
      { pattern: /![a-zA-Z][\w-]*/y, token: 'type' },
      // Anchors and aliases
      { pattern: /[&*][a-zA-Z_][\w-]*/y, token: 'decorator' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:''|[^'\n])*'/y, token: 'string' },
      // Block scalars
      { pattern: /[|>][+-]?\s*$/ym, token: 'operator' },
      // Timestamps / dates
      { pattern: /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/y, token: 'number' },
      // Numbers
      { pattern: /[+-]?(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.inf|\.Inf|\.INF|\.nan|\.NaN|\.NAN)\b/y, token: 'number' },
      // Constants
      { pattern: /\b(?:true|false|null|True|False|Null|TRUE|FALSE|NULL|yes|no|Yes|No|YES|NO|on|off|On|Off|ON|OFF)\b/y, token: 'constant' },
      // Keys (word before colon)
      { pattern: /[a-zA-Z_][\w.-]*(?=\s*:)/y, token: 'property' },
      // Merge key
      { pattern: /<</y, token: 'keyword' },
      // Punctuation
      { pattern: /[{}\[\]:,\-?]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('yaml', create);
