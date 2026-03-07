# Browser Tab Robustness Improvements — Phase 2

## Previously Completed (Phase 1)

H1 IStream read loop, H2 suppress race condition, M1 skip resize when suppressed,
M2 background color, L1 scoped getWebviewArea, S1 color match, S2 catch-up resize,
S3 dropdown flicker fix — all done and tested.

## Phase 2: Remaining Opportunities

### R1. suppressCount desync protection (`browser-tab-content.ts`)

**Problem**: If a caller suppresses but never restores (error path, component destroyed,
re-render), suppressCount gets stuck > 0 and the webview is permanently hidden.
The log-viewer close button calls `restoreBrowserWebview()` from a different file
than the matching suppress (in status-bar), making the pairing fragile.

**Fix**:
- Reset `suppressCount` to 0 when the browser tab deactivates (activeTabId → null).
  At that point no webview is visible anyway, so the count is meaningless.
- Also reset when a new tab activates — fresh context, fresh count.
- Clean up the screenshot background (and revoke any object URL) during reset.
- Log a warning if suppressCount exceeds 3 (indicates likely leak).

**Files**: `src/components/browser-tab-content.ts`

---

### R2. Base64 data URL → Blob + createObjectURL (`browser-tab-content.ts`)

**Problem**: The screenshot is embedded as an inline `data:image/jpeg;base64,...`
CSS background-image. For large screenshots (4K displays), this creates a multi-MB
string in the DOM style attribute, causing GC pressure and unnecessary memory use.

**Fix**:
- Decode the base64 string to a `Uint8Array`, create a `Blob`, then use
  `URL.createObjectURL(blob)` for the background-image URL.
- Store the object URL at module scope so `restoreBrowserWebview()` can call
  `URL.revokeObjectURL()` during cleanup.

**Files**: `src/components/browser-tab-content.ts`

---

### R3. Async suppress pattern — SKIP (no change needed)

**Rationale**: The async pattern is intentional. Callers `await suppress` so the
screenshot is ready before the overlay appears. Making it synchronous would
reintroduce the flickering bug that was fixed in Phase 1 (S3). This is a deliberate
design choice, not a leaked implementation detail.

---

### R4. Cross-language event name constant (`browser_commands.rs`)

**Problem**: Rust emits `"browser-navigated"` as a raw string literal. TypeScript
defines `BROWSER_NAVIGATED_EVENT = 'browser-navigated'` as a constant. If either
side changes the string, the contract silently breaks with no compile-time error.

**Fix**:
- Add `const BROWSER_NAVIGATED_EVENT: &str = "browser-navigated"` in
  `browser_commands.rs` (or a shared constants location) and use it in the
  `emit_to` call.
- This doesn't create cross-language safety, but it gives the Rust side a single
  source of truth and makes the coupling visible via a searchable symbol name.

**Files**: `src-tauri/src/commands/browser_commands.rs`

---

### R5. Project dropdown re-render race (`project-tab-bar.ts`)

**Problem**: The dropdown state (`dropdownPanel`, `closeDropdown`, outside-click
handler) is defined inside `render()`. If `render()` fires while the dropdown is
open (e.g., a new project is added), the old dropdown panel (appended to
`document.body`) and its outside-click handler are orphaned. The old panel stays
visible with stale data until the user clicks somewhere. The suppress count from
the orphaned dropdown is stuck until that click.

**Fix**:
- Move `dropdownPanel`, `closeDropdown`, and `onDropdownOutsideClick` out of
  `render()` to the `initProjectTabBar` scope.
- Call `closeDropdown()` at the top of `render()` to clean up any open dropdown
  before rebuilding the bar.
- The dropdown item creation helpers (`createDropdownItem`, `positionDropdownPanel`)
  stay inside render since they depend on the current `projects`/`activeId` snapshot.

**Files**: `src/components/project-tab-bar.ts`

## Checklist

- [x] R1. suppressCount desync protection
- [x] R2. Base64 → Blob + createObjectURL
- [x] R4. Cross-language event name constant
- [x] R5. Project dropdown re-render race

## Simplify Review

- **Fixed**: Extracted `decodeBase64ToBytes` to `src/utils/base64.ts` (was duplicated in `pty-service.ts` and inline in `browser-tab-content.ts`)
- **Fixed**: Un-exported `resetSuppression()` — only used internally, exposing it would let external callers corrupt suppress count
- **Noted** (out of scope): `'fs-change'` raw string on both Rust/TS sides should get the same constant treatment as `browser-navigated`
- **Clean**: No memory leaks, no event listener leaks, no redundant work, no hot-path bloat
