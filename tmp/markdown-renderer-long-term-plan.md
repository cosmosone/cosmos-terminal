# Markdown Rendering Architecture Plan

This checklist tracks the long-term migration from the current custom regex renderer to a robust, testable, secure markdown pipeline.

## Status
- [x] Phase 1: Requirements and fixtures baseline
- [x] Phase 2: Dedicated renderer module
- [x] Phase 3: AST pipeline + sanitization + spacing plugin
- [x] Phase 4: UI integration behind feature flag
- [x] Phase 5: Tests and regression coverage
- [x] Phase 6: Performance and cleanup
- [x] Phase 7: Rollout and deprecation of legacy renderer

## Phase 1 - Baseline and Spec
- [x] Create fixtures folder: `tests/fixtures/markdown/`
- [x] Add real-file fixtures (`CLAUDE.md`, `CONTRIBUTING.md`, etc.)
- [x] Add edge-case fixtures (blank lines, nested lists, tables, long links, code fences, CRLF)
- [x] Write renderer behavior spec (including blank-line preservation rule)
- [x] Define acceptance examples for expected view HTML output

## Phase 2 - Renderer Service
- [x] Add `src/services/markdown-renderer.ts`
- [x] Add `src/services/markdown-types.ts`
- [x] Define stable render interface:
- [x] `renderMarkdown(source: string): string`
- [x] `renderMarkdownCached(path: string, source: string, mtime?: number): string`
- [x] Keep legacy renderer in place temporarily for safe migration

## Phase 3 - AST Pipeline
- [x] Add dependencies: `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-sanitize`, `rehype-stringify`
- [x] Normalize line endings at renderer input boundary
- [x] Implement markdown parse -> AST -> sanitized HTML pipeline
- [x] Implement explicit blank-line preservation plugin (product rule)
- [x] Implement safe-link policy (`http`, `https`, `mailto`)
- [x] Ensure external links include `target="_blank"` + `rel="noopener noreferrer"`
- [x] Disallow unsafe raw HTML by default

## Phase 4 - UI Integration
- [x] Add renderer feature flag in app settings/state (for staged rollout)
- [x] Update `src/components/file-tab-content.ts` to call new renderer in markdown view mode
- [x] Keep markdown edit mode as plain textarea (already adopted)
- [x] Preserve existing View/Edit context-menu behavior
- [x] Add fallback path to legacy renderer while flag is off

## Phase 5 - Test Coverage
- [x] Unit tests for renderer service
- [x] Unit tests for blank-line preservation behavior
- [x] Unit tests for link sanitization and protocol rules
- [x] Security tests for XSS-like payloads
- [x] Snapshot tests for fixture corpus
- [x] Integration tests for file-tab View <-> Edit transitions
- [x] Regression tests for CRLF/LF consistency
- [x] Large markdown performance test fixture

## Phase 6 - Performance and Cleanup
- [x] Add LRU/content-hash cache for render results
- [x] Avoid rerender when source unchanged
- [x] Keep markdown CSS spacing rules minimal and semantic
- [x] Remove legacy regex renderer from `file-tab-content.ts`
- [x] Remove temporary migration code and dead paths

## Phase 7 - Rollout
- [x] Enable new renderer by default in dev/internal builds
- [x] Run manual validation across real workspace docs
- [x] Enable by default for all users
- [x] Keep one-release fallback flag for safety
- [x] Remove fallback flag and legacy code after stabilization window

## Risks and Mitigations
- [x] Visual diff risk mitigated with fixture snapshots and staged rollout
- [x] Security risk mitigated with sanitize schema and explicit tests
- [x] Spec mismatch risk mitigated by documented product rule for blank lines

## Progress Log
- [x] Phase 1 completed: fixtures created under `tests/fixtures/markdown/` and spec added at `docs/markdown-renderer-spec.md`.
- [x] Phase 2 completed: renderer API and legacy fallback moved to `src/services/markdown-renderer.ts`.
- [x] Phase 3 completed: AST-based markdown pipeline with sanitization, link hardening, and explicit blank-line spacer insertion.
- [x] Phase 4 completed: `file-tab-content` delegates markdown view rendering to renderer service (initially flag-gated).
- [x] Phase 5 completed: renderer tests added (`tests/integration/markdown-renderer.test.ts`) plus markdown View/Edit integration test (`tests/integration/file-tab-markdown-flow.test.ts`).
- [x] Phase 6 completed: cache, CSS cleanup, and temporary migration/dead-path removal completed.
- [x] Phase 7 rollout step: default flipped on for all users during rollout.
- [x] Validation step: added workspace markdown sweep test (`tests/integration/markdown-renderer-workspace-docs.test.ts`) and executed passing run.
- [x] Finalization: fallback flag and legacy renderer path removed; markdown view now uses the new renderer pipeline unconditionally.
- [x] Review cleanup: renderer service decoupled from syntax-highlight module (`escapeHtml` localized) and unused renderer facade/type surface removed.
- [x] Dependency security follow-up: resolved `npm audit` chain by pinning patched transitive `minimatch` via `package.json` `overrides`.
