import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'markdown',
    rules: [
      // Fenced code blocks
      { pattern: /```[\s\S]*?```/y, token: 'string' },
      // Inline code
      { pattern: /`[^`\n]+`/y, token: 'string' },
      // Headings
      { pattern: /^#{1,6}\s+[^\n]*/ym, token: 'heading' },
      // Blockquotes
      { pattern: /^>\s+[^\n]*/ym, token: 'comment' },
      // Horizontal rules
      { pattern: /^(?:---+|\*\*\*+|___+)\s*$/ym, token: 'meta' },
      // Unordered list markers
      { pattern: /^[ \t]*[-*+]\s/ym, token: 'punctuation' },
      // Ordered list markers
      { pattern: /^[ \t]*\d+\.\s/ym, token: 'punctuation' },
      // Links [text](url)
      { pattern: /\[[^\]]*\]\([^)]*\)/y, token: 'string' },
      // Reference links [text][ref]
      { pattern: /\[[^\]]*\]\[[^\]]*\]/y, token: 'string' },
      // Images ![alt](url)
      { pattern: /!\[[^\]]*\]\([^)]*\)/y, token: 'string' },
      // Bold + italic
      { pattern: /\*\*\*[^*]+\*\*\*/y, token: 'keyword' },
      // Bold
      { pattern: /\*\*[^*]+\*\*/y, token: 'keyword' },
      { pattern: /__[^_]+__/y, token: 'keyword' },
      // Italic
      { pattern: /\*[^*\n]+\*/y, token: 'comment' },
      { pattern: /_[^_\n]+_/y, token: 'comment' },
      // HTML entities
      { pattern: /&[a-zA-Z]+;|&#\d+;/y, token: 'escape' },
      // HTML tags in markdown
      { pattern: /<\/?[a-zA-Z][\w-]*[^>]*>/y, token: 'tag' },
    ],
  };
}

registerGrammar('markdown', create);
