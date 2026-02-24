import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Root as MdastRoot, RootContent } from 'mdast';
import type { Element, Parent, Root as HastRoot } from 'hast';

const MARKDOWN_CACHE_MAX_ENTRIES = 128;
const ALLOWED_HREF_PROTOCOL_RE = /^(https?:|mailto:)/i;

const renderCache = new Map<string, string>();
let cacheHits = 0;
let cacheMisses = 0;

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n?/g, '\n');
}

function escapeHtml(source: string): string {
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hashSource(source: string): string {
  // FNV-1a 32-bit hash for deterministic cache keys.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function makeCacheKey(path: string, source: string, mtime?: number): string {
  const stamp = Number.isFinite(mtime) ? String(mtime) : 'no-mtime';
  return `${path}::${stamp}::${hashSource(source)}`;
}

function getCachedRender(key: string): string | null {
  const value = renderCache.get(key);
  if (value == null) return null;
  renderCache.delete(key);
  renderCache.set(key, value);
  cacheHits++;
  return value;
}

function setCachedRender(key: string, html: string): void {
  if (renderCache.has(key)) {
    renderCache.delete(key);
  }
  renderCache.set(key, html);

  if (renderCache.size <= MARKDOWN_CACHE_MAX_ENTRIES) return;

  const oldestKey = renderCache.keys().next().value;
  if (oldestKey) {
    renderCache.delete(oldestKey);
  }
}

function countBlankLinesInRange(sourceLines: string[], startLine: number, endLine: number): number {
  if (endLine < startLine) return 0;
  let count = 0;
  for (let line = startLine; line <= endLine && line <= sourceLines.length; line++) {
    if ((sourceLines[line - 1] ?? '').trim() === '') {
      count++;
    }
  }
  return count;
}

function lineStart(node: RootContent): number | null {
  return node.position?.start?.line ?? null;
}

function lineEnd(node: RootContent): number | null {
  return node.position?.end?.line ?? null;
}

function createEmptyLineNode(): RootContent {
  return {
    type: 'mdEmptyLine',
    data: {
      hName: 'p',
      hProperties: {
        className: ['md-empty-line'],
      },
      hChildren: [],
    },
  } as unknown as RootContent;
}

function remarkPreserveBlankLines(sourceLines: string[]) {
  return () => (tree: MdastRoot) => {
    if (tree.children.length === 0) return;

    const out: RootContent[] = [];

    const firstStart = lineStart(tree.children[0]);
    if (firstStart != null && firstStart > 1) {
      const leadingBlankLines = countBlankLinesInRange(sourceLines, 1, firstStart - 1);
      for (let i = 0; i < leadingBlankLines; i++) {
        out.push(createEmptyLineNode());
      }
    }

    for (let i = 0; i < tree.children.length; i++) {
      const current = tree.children[i];
      out.push(current);

      if (i === tree.children.length - 1) continue;

      const next = tree.children[i + 1];
      const endLine = lineEnd(current);
      const startLine = lineStart(next);
      if (endLine == null || startLine == null || startLine <= endLine) continue;

      const blankLines = countBlankLinesInRange(sourceLines, endLine + 1, startLine - 1);
      for (let j = 0; j < blankLines; j++) {
        out.push(createEmptyLineNode());
      }
    }

    tree.children = out;
  };
}

function extractText(node: Parent | Element): string {
  let text = '';
  for (const child of node.children) {
    if (child.type === 'text') {
      text += child.value;
      continue;
    }
    if (child.type === 'element') {
      text += extractText(child);
    }
  }
  return text;
}

function linkHref(node: Element): string {
  const raw = node.properties?.href;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    return typeof first === 'string' ? first : '';
  }
  return '';
}

function isAllowedHref(href: string): boolean {
  return ALLOWED_HREF_PROTOCOL_RE.test(href.trim());
}

function rehypeLinkPolicy() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'a') return;

      const href = linkHref(node);
      if (!isAllowedHref(href)) {
        if (typeof index === 'number' && parent && 'children' in parent) {
          const replacement = { type: 'text', value: extractText(node) } as const;
          (parent as Parent).children[index] = replacement;
        }
        return;
      }

      node.properties = {
        ...node.properties,
        href,
        target: '_blank',
        rel: ['noopener', 'noreferrer'],
      };
    });
  };
}

const sanitizedTagNames = new Set([
  ...(defaultSchema.tagNames ?? []),
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
]);

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...sanitizedTagNames],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
    p: [...(defaultSchema.attributes?.p ?? []), ['className', 'md-empty-line']],
    th: [...(defaultSchema.attributes?.th ?? []), 'align'],
    td: [...(defaultSchema.attributes?.td ?? []), 'align'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
};

function renderFallback(normalizedSource: string): string {
  return `<pre>${escapeHtml(normalizedSource)}</pre>`;
}

function renderMarkdownInternal(normalizedSource: string): string {
  const sourceLines = normalizedSource.split('\n');

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkPreserveBlankLines(sourceLines))
    .use(remarkRehype)
    .use(rehypeLinkPolicy)
    .use(rehypeSanitize, sanitizeSchema as any)
    .use(rehypeStringify);

  try {
    return String(processor.processSync(normalizedSource));
  } catch {
    return renderFallback(normalizedSource);
  }
}

export function renderMarkdown(source: string): string {
  return renderMarkdownInternal(normalizeLineEndings(source));
}

export function clearMarkdownRenderCache(): void {
  renderCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function getMarkdownRenderCacheStats(): { entries: number; hits: number; misses: number } {
  return { entries: renderCache.size, hits: cacheHits, misses: cacheMisses };
}

export function renderMarkdownCached(path: string, source: string, mtime?: number): string {
  const normalized = normalizeLineEndings(source);
  const key = makeCacheKey(path, normalized, mtime);
  const cached = getCachedRender(key);
  if (cached != null) return cached;

  cacheMisses++;
  const rendered = renderMarkdownInternal(normalized);
  setCachedRender(key, rendered);
  return rendered;
}
