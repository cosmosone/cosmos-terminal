import type { Grammar } from '../types';

type GrammarFactory = () => Grammar;

const factories = new Map<string, GrammarFactory>();
const cache = new Map<string, Grammar>();

export function registerGrammar(id: string, factory: GrammarFactory): void {
  factories.set(id, factory);
}

export function getGrammar(languageId: string): Grammar | null {
  const cached = cache.get(languageId);
  if (cached) return cached;
  const factory = factories.get(languageId);
  if (!factory) return null;
  const grammar = factory();
  cache.set(languageId, grammar);
  return grammar;
}

const extensionMap: Record<string, string> = {
  // JavaScript
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  // TypeScript
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  // Python
  py: 'python', pyw: 'python', pyi: 'python',
  // Rust
  rs: 'rust',
  // Go
  go: 'go',
  // Java
  java: 'java',
  // C / C++
  c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', hxx: 'cpp', hh: 'cpp',
  // Dart
  dart: 'dart',
  // Kotlin
  kt: 'kotlin', kts: 'kotlin',
  // Swift
  swift: 'swift',
  // Ruby
  rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
  // PHP
  php: 'php',
  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', psm1: 'shell',
  // SQL
  sql: 'sql',
  // JSON
  json: 'json', jsonc: 'json', json5: 'json',
  // HTML
  html: 'html', htm: 'html', svg: 'html',
  // XML
  xml: 'xml', xsl: 'xml', xsd: 'xml', plist: 'xml',
  // CSS
  css: 'css', scss: 'css', less: 'css',
  // YAML
  yaml: 'yaml', yml: 'yaml',
  // TOML
  toml: 'toml',
  // Markdown
  md: 'markdown', mdx: 'markdown',
};

export function languageFromExtension(ext: string): string {
  return extensionMap[ext.toLowerCase()] ?? 'text';
}
