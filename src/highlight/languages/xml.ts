import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'xml',
    rules: [
      // Comments
      { pattern: /<!--[\s\S]*?-->/y, token: 'comment' },
      // Processing instructions
      { pattern: /<\?[\s\S]*?\?>/y, token: 'meta' },
      // CDATA
      { pattern: /<!\[CDATA\[[\s\S]*?\]\]>/y, token: 'string' },
      // DOCTYPE
      { pattern: /<!DOCTYPE\b[^>]*>/iy, token: 'meta' },
      // Closing tags
      { pattern: /<\/[a-zA-Z_:][\w:.-]*\s*>/y, token: 'tag' },
      // Opening tag start
      { pattern: /<[a-zA-Z_:][\w:.-]*/y, token: 'tag' },
      { pattern: /\/?\s*>/y, token: 'tag' },
      // Namespace prefix
      { pattern: /[a-zA-Z_][\w-]*(?=:)/y, token: 'type' },
      // Attribute names
      { pattern: /[a-zA-Z_:][\w:.-]*(?=\s*=)/y, token: 'attribute' },
      // Attribute values
      { pattern: /"[^"]*"/y, token: 'string' },
      { pattern: /'[^']*'/y, token: 'string' },
      // Entities
      { pattern: /&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/y, token: 'escape' },
      // Operators
      { pattern: /=/y, token: 'operator' },
    ],
  };
}

registerGrammar('xml', create);
