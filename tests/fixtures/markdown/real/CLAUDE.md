# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run tauri dev              # Full dev mode (frontend + Rust backend)
npm run dev                    # Frontend only (Vite at localhost:1420)
npm run build                  # Frontend production build (tsc + vite)
npm run tauri build            # Full production build (installer in src-tauri/target/release/bundle/)

npx tsc --noEmit               # TypeScript type check
cd src-tauri && cargo clippy --all-targets   # Rust linting
cd src-tauri && cargo test      # Rust tests
cd src-tauri && cargo fmt --check            # Rust format check
```

No frontend test framework. Verification is `tsc --noEmit` + manual testing via `tauri dev`.

### Plan Execution Rule

After implementing any plan, always run:

```bash
python scripts/build-test.py
```

If any step fails, continue fixing issues and re-run `build-test.py` until the full pipeline passes with zero failures.

## Architecture

Tauri v2 desktop app: vanilla TypeScript frontend + Rust backend. Windows-first (ConPTY, WebView2, dark mode title bar). No React/Vue/Svelte — direct DOM manipulation.

### Frontend (`src/`)

**State**: Custom Redux-like store (`state/store.ts`) with selector-based subscriptions. `store.select(selector, listener)` only fires when the selector's output changes (shallow equality). All mutations go through action functions in `state/actions.ts`. All interfaces in `state/types.ts`.

**Components** (`components/`): Init functions that receive a container, set up DOM, and subscribe to store. Pattern:
```typescript
export function initComponent(onLayoutChange: () => void): void {
  const el = $('#container')!;
  store.select(selector, (value) => { /* re-render */ });
}
```

**Services** (`services/`): One file per domain. Thin wrappers around `@tauri-apps/api/core.invoke()` for IPC. PTY output streams via Tauri `Channel` (base64-encoded).

**Layout** (`layout/`): Recursive binary tree for pane splits. `PaneNode = PaneLeaf | PaneBranch`. `computeLayout(paneTree, rect)` calculates bounding boxes. Resize updates `ratios` array on branch nodes.

**DOM helpers**: `createElement()` and `$()` from `utils/dom.ts`. Use `textContent` for user data; `innerHTML` only for trusted SVG from `utils/icons.ts`.

### Backend (`src-tauri/`)

**IPC commands** (`commands/`): One file per domain (pty, git, fs, system, watcher). All serialized as camelCase via `#[serde(rename_all = "camelCase")]` in `models.rs`.

**PTY** (`pty/`): `SessionManager` holds a global registry of `SessionHandle`s. Each session spawns a thread for reading PTY output. Uses `portable-pty` crate with ConPTY backend.

**Git**: Uses `git2` crate for all operations except push (falls back to CLI `git push`).

**Concurrency**: `parking_lot::Mutex` preferred over `std::sync::Mutex`. Blocking I/O wrapped in `tokio::task::spawn_blocking`. Lightweight ops (PTY write/resize) are sync commands.

**Error handling**: IPC commands return `Result<T, String>`.

### Data Flow

```
User input → xterm.js → writeToPtySession(invoke) → Rust write_to_session
PTY output → Rust reader thread → Channel(base64) → Frontend decode → xterm.js terminal.write()
Git ops    → git-service.ts(invoke) → Rust git2 commands → serialized response
State      → actions.ts mutates store → selectors notify subscribed components → DOM updates
```

### Hierarchy

Projects → Sessions → Panes (3-level). Each project has its own git state, file browser scope, and set of sessions. Each session has a pane tree for splits.

## Conventions

- **Australian English** in user-facing strings and commit messages (colour, initialise, behaviour, organisation)
- **Conventional commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `style:`, `test:`, `perf:`
- **CSS**: One file per component in `styles/`. Theme via CSS custom properties in `theme.css`. BEM-style prefixes (`git-`, `pane-`, `settings-`)
- **TypeScript strict mode**: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- **Type imports**: `import type { ... }` for type-only imports
- **Rust**: Edition 2021, `cargo fmt` formatting, input validation on IPC boundaries (`validate_dimensions()`, `validate_shell_path()`, `validate_write_path()`)

## Commit Message Generation (In-App)

The AI commit message prompt lives in `src/services/openai-service.ts` (the `SYSTEM_PROMPT` constant). Changes to commit message style/format should be made there, not in external config. Uses OpenAI `gpt-5-nano` with `reasoning_effort: 'low'`. Large diffs use a two-tier batching strategy (summarise batches → final message).
