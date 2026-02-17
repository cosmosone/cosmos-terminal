import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'html',
    rules: [
      // Comments
      { pattern: /<!--[\s\S]*?-->/y, token: 'comment' },
      // DOCTYPE
      { pattern: /<!DOCTYPE\b[^>]*>/iy, token: 'meta' },
      // CDATA
      { pattern: /<!\[CDATA\[[\s\S]*?\]\]>/y, token: 'comment' },
      // Script / style blocks (highlight as strings)
      { pattern: /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/iy, token: 'string' },
      // Closing tags
      { pattern: /<\/[a-zA-Z][\w-]*\s*>/y, token: 'tag' },
      // Self-closing / opening tags with attributes
      { pattern: /<[a-zA-Z][\w-]*/y, token: 'tag' },
      { pattern: /\/?\s*>/y, token: 'tag' },
      // Attribute names
      { pattern: /[a-zA-Z_:][\w:.-]*(?=\s*=)/y, token: 'attribute' },
      // Attribute values
      { pattern: /"[^"]*"/y, token: 'string' },
      { pattern: /'[^']*'/y, token: 'string' },
      // Entities
      { pattern: /&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/y, token: 'escape' },
      // Operators (=)
      { pattern: /=/y, token: 'operator' },
    ],
  };
}

registerGrammar('html', create);
