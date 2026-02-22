# Markdown Renderer Behaviour Spec

## Goal
Provide deterministic, safe markdown rendering for file tab View mode while preserving user-authored visual spacing.

## Scope
- View mode for `.md` files in `src/components/file-tab-content.ts`.
- Edit mode remains plain textarea.
- Rendering is performed by `src/services/markdown-renderer.ts`.
- Markdown view mode now uses the new renderer unconditionally (legacy/flag fallback removed).

## Pipeline
1. Normalize line endings (`CRLF`/`CR` -> `LF`).
2. Parse markdown with GFM support.
3. Insert explicit blank-line spacer nodes between block nodes.
4. Transform markdown AST to HTML AST.
5. Enforce link policy (`http`, `https`, `mailto`) and external-link attributes.
6. Sanitize HTML tree.
7. Stringify to HTML.
8. If parsing fails unexpectedly, fall back to escaped source inside `<pre>...</pre>` for safe readability.

## Product Rules
- Blank-line preservation:
  - Each explicit blank line between adjacent top-level block nodes is rendered as one spacer node: `<p class="md-empty-line"></p>`.
  - Spacer nodes are semantic placeholders used only for visual spacing.
- Links:
  - Allowed: `http:`, `https:`, `mailto:`.
  - Disallowed protocols are downgraded to plain text (not clickable).
  - Allowed links include `target="_blank"` and `rel="noopener noreferrer"`.
- Raw HTML:
  - Unsafe/inline raw HTML is not executed and is sanitized.
- Tables/lists/code:
  - GFM tables, lists, and fenced code blocks are supported.

## Acceptance Examples

### Example A: Blank lines
Input:
```md
# Title

Paragraph one.


Paragraph two.
```

Expected output includes (order preserved):
```html
<h1>Title</h1>
<p class="md-empty-line"></p>
<p>Paragraph one.</p>
<p class="md-empty-line"></p>
<p class="md-empty-line"></p>
<p>Paragraph two.</p>
```

### Example B: Link policy
Input:
```md
[Safe](https://example.com)
[Unsafe](javascript:alert(1))
```

Expected output includes:
```html
<a href="https://example.com" target="_blank" rel="noopener noreferrer">Safe</a>
Unsafe
```

### Example C: CRLF compatibility
Input stored with CRLF line endings must produce the same HTML output as LF input.
