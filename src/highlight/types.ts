export type TokenType =
  | 'keyword' | 'type' | 'string' | 'number' | 'comment' | 'constant'
  | 'function' | 'operator' | 'punctuation' | 'decorator' | 'tag' | 'attribute'
  | 'property' | 'escape' | 'heading' | 'meta';

export interface Token {
  type: TokenType | null;
  value: string;
}

export interface GrammarRule {
  pattern: RegExp; // Must include the sticky (y) flag; may combine with i or m
  token: TokenType;
}

export interface Grammar {
  name: string;
  rules: GrammarRule[];
}
