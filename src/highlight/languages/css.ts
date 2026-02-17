import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'css',
    rules: [
      // Comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // SCSS single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      { pattern: /'(?:\\[\s\S]|[^'\\\n])*'/y, token: 'string' },
      // URL function
      { pattern: /url\([^)]*\)/y, token: 'string' },
      // At-rules
      { pattern: /@(?:import|media|charset|font-face|keyframes|supports|layer|container|property|scope|starting-style|mixin|include|extend|use|forward|if|else|each|for|while|function|return|at-root|debug|warn|error)\b/y, token: 'keyword' },
      // Custom properties
      { pattern: /--[a-zA-Z_][\w-]*/y, token: 'property' },
      // Hex colors
      { pattern: /#[0-9a-fA-F]{3,8}\b/y, token: 'number' },
      // Numbers with units
      { pattern: /-?\d+\.?\d*(?:px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|deg|rad|grad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx|fr)?/y, token: 'number' },
      // SCSS variables
      { pattern: /\$[a-zA-Z_][\w-]*/y, token: 'property' },
      // Important
      { pattern: /!important\b/y, token: 'keyword' },
      // Pseudo-elements and pseudo-classes
      { pattern: /::?(?:before|after|first-line|first-letter|selection|placeholder|backdrop|marker|root|hover|active|focus|focus-within|focus-visible|visited|link|any-link|checked|disabled|enabled|empty|first-child|first-of-type|last-child|last-of-type|nth-child|nth-of-type|only-child|only-of-type|not|is|where|has|lang|dir)\b/y, token: 'keyword' },
      // Property names (word before colon, within declaration blocks)
      { pattern: /[a-zA-Z-]+(?=\s*:)/y, token: 'attribute' },
      // Tag selectors
      { pattern: /\b(?:html|body|div|span|p|a|h[1-6]|ul|ol|li|table|tr|td|th|form|input|button|select|textarea|img|section|article|nav|header|footer|main|aside|figure|figcaption|details|summary|dialog|canvas|svg|video|audio)\b/y, token: 'tag' },
      // Operators
      { pattern: /[>~+*=/]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('css', create);
