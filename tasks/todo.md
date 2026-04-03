# Frontend Hot-Swap — Implementation Plan

## Overview

Stop embedding frontend assets into the exe. Instead, serve them from a `frontend/` directory on disk next to the exe. This lets `build.py` skip Rust compilation when only frontend code changed (~2-3s vs ~2min).

The app watches `frontend/` for changes and auto-reloads the WebView. PTY sessions and all Rust state survive the reload.

---

## Architecture

```
D:\Apps\Cosmos-Terminal\
  cosmos-terminal.exe          <-- only rebuilt when Rust code changes
  frontend\                    <-- rebuilt on EVERY build (~2s)
    index.html
    assets\
      index-abc123.js
      xterm-CWKXqyIO.js
      index-BzT3qmmQ.css
```

**Asset loading**: Custom URI scheme protocol `cosmos://` registered in Rust. The WebView loads `cosmos://localhost/index.html`. The protocol handler reads files from `{exe_dir}/frontend/` and returns them with correct MIME types.

**Fallback**: If `frontend/` directory does not exist, the app uses embedded assets (traditional Tauri behaviour). This ensures the app always works, even without the directory.

**Reload flow**: Rust file watcher detects changes in `frontend/` -> emits `frontend-updated` event -> frontend saves workspace state -> `location.reload()` -> workspace restored from persisted state.

---

## Build Modes (Updated)

| Mode | Version | Rust Build | Frontend Build | Git | Install |
|---|---|---|---|---|---|
| `build.py` | Interactive | Smart detect | Always | If bumped + backend changes | "Install to app folder? [y/N]" |
| `--dev` | No | Smart detect | Always | No | Silent auto-install (warn on failure) |
| `--release` | Auto patch | Smart detect | Always | Tag+release only if backend changes; commit+push always | Silent auto-install (warn on failure) |
| `--local` | No | Dev server | Dev server | No | No |

**Smart detect**: Hash all Rust source files (`src-tauri/src/**/*.rs`, `Cargo.lock`, `build.rs`, `Cargo.toml` minus version line, `tauri.conf.json` minus version field). Compare with saved hash from last Rust build. If different -> full build. If same -> frontend only. Guard: if exe doesn't exist at target, force full build regardless.

---

## Implementation Steps

### Step 1: Add `mime_guess` dependency
- **File**: `src-tauri/Cargo.toml`
- Add `mime_guess = "2"` to `[dependencies]`

### Step 2: Register `cosmos://` custom protocol
- **File**: `src-tauri/src/lib.rs`
- Resolve `frontend_dir` = `{exe_dir}/frontend/`
- Register `cosmos://` protocol on `tauri::Builder` via `.register_uri_scheme_protocol("cosmos", ...)`
- Handler logic:
  1. Parse request URI path (e.g., `/assets/index-abc123.js`)
  2. Map to `frontend_dir.join(path)` — default `/` to `/index.html`
  3. **Path traversal guard**: canonicalise and verify the resolved path starts with `frontend_dir`
  4. Read file bytes from disk
  5. Detect MIME type via `mime_guess::from_path()`
  6. Return `tauri::http::Response` with `Content-Type` and `Cache-Control: no-cache` headers
  7. Return 404 for missing files

### Step 3: Startup navigation to `cosmos://`
- **File**: `src-tauri/src/lib.rs`
- In `.setup()` callback, after existing setup code:
  1. Check if `{exe_dir}/frontend/index.html` exists
  2. If YES: navigate main WebView to `cosmos://localhost/index.html`
  3. If NO: do nothing (embedded assets are used — fallback)

### Step 4: Frontend watcher (auto-reload trigger)
- **File**: `src-tauri/src/frontend_watcher.rs` (new)
- Struct `FrontendWatcher` with `Mutex<Option<Inner>>` (same pattern as `watcher.rs`)
- Watches `{exe_dir}/frontend/` recursively with **1500ms debounce**
- On any file change: emit `"frontend-updated"` event via `app.emit()`
- Ignores changes to dotfiles (`.reload-trigger`, etc.) — actually no, trigger on ALL changes
- **File**: `src-tauri/src/lib.rs`
  - Add `mod frontend_watcher;`
  - In `.setup()`: if `frontend/` dir exists, create and manage `FrontendWatcher`

### Step 5: Frontend reload listener
- **File**: `src/main.ts`
- After all component initialisation, add:
  ```typescript
  listen('frontend-updated', async () => {
    const s = store.getState();
    await saveWorkspace(s.projects, s.activeProjectId, s.gitSidebar, s.fileBrowserSidebar);
    await saveSettings(s.settings);
    location.reload();
  });
  ```
- The existing workspace restoration code in `main()` handles state recovery on reload

### Step 6: CSP update
- **File**: `src-tauri/tauri.conf.json`
- Add `cosmos:` to all relevant CSP directives:
  ```
  default-src 'self' cosmos:;
  script-src 'self' cosmos:;
  style-src 'self' 'unsafe-inline' cosmos:;
  font-src 'self' cosmos:;
  connect-src ipc: http://ipc.localhost https://api.openai.com cosmos:;
  img-src 'self' asset: https://asset.localhost data: cosmos:;
  ```
- **File**: `index.html`
- Update the inline `<meta>` CSP tag to match

### Step 7: Build script — smart detect function
- **File**: `scripts/build.py`
- New constant: `RUST_HASH_FILE = ROOT / "src-tauri" / "target" / ".rust-build-hash"`
- New function `compute_rust_hash() -> str`:
  1. SHA-256 hash of all `*.rs` files in `src-tauri/src/` (sorted for determinism)
  2. Hash `Cargo.lock` content
  3. Hash `build.rs` content (if exists)
  4. Hash `Cargo.toml` content with `version = "..."` line stripped
  5. Hash `tauri.conf.json` content with `"version"` key removed
  6. Return hex digest
- New function `detect_build_type() -> str`:
  1. If `RUST_HASH_FILE` doesn't exist -> return `'full'`
  2. If exe doesn't exist at `COSMOS_TERMINAL_APP_DIR` -> return `'full'`
  3. Compute current hash, compare with saved hash
  4. If different -> return `'full'`
  5. If same -> return `'frontend'`
- New function `save_rust_hash()`:
  - Write `compute_rust_hash()` result to `RUST_HASH_FILE`
  - Called only after successful Rust build

### Step 8: Build script — frontend-only build function
- **File**: `scripts/build.py`
- New function `build_frontend_only()`:
  1. Print: `"Frontend-only build (no Rust changes detected)"`
  2. Run `npm run build` (Vite)
  3. Done — no Rust compilation

### Step 9: Build script — install function
- **File**: `scripts/build.py`
- Rename `copy_exe_prompt()` to `install_prompt(build_type: str)`:
  1. Check `COSMOS_TERMINAL_APP_DIR` env var
  2. Ask: `"Install to app folder? [y/N]"`
  3. If yes: call `install_to_app_folder(build_type)`
- New function `install_to_app_folder(build_type: str)`:
  1. Always: copy `dist/` -> `{APP_DIR}/frontend/` (using `shutil.copytree` with `dirs_exist_ok=True`)
  2. If `build_type == 'full'`: also copy `cosmos-terminal.exe` to `{APP_DIR}/`
  3. Print what was installed (e.g., "Installed frontend to app folder" or "Installed exe + frontend to app folder")
- New function `try_silent_install(build_type: str) -> bool`:
  1. Same as `install_to_app_folder` but wrapped in try/except
  2. If frontend-only: always succeeds, print success message
  3. If full and exe copy fails (PermissionError — file locked):
     - Still copy frontend (that succeeds)
     - Print warning: `"Frontend installed. Exe could not be copied (app is running). Close the app, copy the exe manually, and restart."`
     - Print source path of exe for convenience
  4. Return success/failure

### Step 10: Build script — update mode handlers
- **File**: `scripts/build.py`
- **`build_dev()`**:
  1. `ensure_node_modules()`
  2. `build_type = detect_build_type()`
  3. If `'full'`: run `run_cargo_build(...)` with existing fast profile + `--no-bundle`, then `save_rust_hash()`
  4. If `'frontend'`: run `build_frontend_only()`
  5. `try_silent_install(build_type)` (no prompt, same as `--release`)
- **Default mode (interactive)**:
  1. `ensure_node_modules()`
  2. Version bump prompt (unchanged)
  3. `build_type = detect_build_type()`
  4. If `'full'`: run `run_cargo_build()`, then `save_rust_hash()`
  5. If `'frontend'`: run `build_frontend_only()`
  6. If bumped AND `build_type == 'full'`: `commit_and_tag()`, `create_release()`
  7. If bumped AND `build_type == 'frontend'`: commit version bump only, push commit (no tag, no release)
  8. `install_prompt(build_type)`
- **`build_release()` (NEW)**:
  1. `ensure_node_modules()`
  2. Auto bump patch version (silent)
  3. `build_type = detect_build_type()`
  4. If `'full'`: run `run_cargo_build()`, then `save_rust_hash()`
  5. If `'frontend'`: run `build_frontend_only()`
  6. If `build_type == 'full'`: `commit_and_tag()`, `create_release()`
  7. If `build_type == 'frontend'`: commit version bump, push commit only (no tag, no release)
  8. `try_silent_install(build_type)`

### Step 11: Build script — argument parser update
- **File**: `scripts/build.py`
- Add `--release` to the mutually exclusive group
- Wire to new `build_release()` handler

---

## Edge Cases

1. **First ever build**: No hash file exists -> forces full build. Correct.
2. **No `frontend/` dir**: App uses embedded assets (fallback). Correct.
3. **Exe locked during `--release`**: Frontend still installed, user warned about exe. Correct.
4. **Version bump changes Cargo.toml/tauri.conf.json**: Hash computation strips version fields, so version-only changes don't trigger full build. Correct.
5. **Rapid frontend updates**: Watcher debounced at 1500ms, prevents reload spam. Correct.
6. **WebView reload state loss**: Workspace saved before reload, restored on init. Correct.
7. **Dependency change (new crate)**: Changes `Cargo.lock` -> hash changes -> full build. Correct.
8. **IPC after protocol navigation**: Tauri injects `__TAURI_INTERNALS__` regardless of origin. Needs verification during implementation.

---

## Verification

After implementation, run:
```bash
python scripts/test.py
```

Manual testing matrix:
- [ ] `build.py --dev` with Rust changes -> full build, silent auto-install
- [ ] `build.py --dev` with frontend-only changes -> frontend build, silent auto-install
- [ ] `build.py --release` with Rust changes -> full build, tag, release, auto-install
- [ ] `build.py --release` with frontend-only changes -> frontend build, no tag/release, auto-install
- [ ] `build.py` interactive with version bump + Rust changes -> full flow
- [ ] `build.py` interactive with version bump + frontend-only -> commit+push, no tag/release
- [ ] App starts without `frontend/` dir -> uses embedded assets (fallback)
- [ ] App starts with `frontend/` dir -> loads from `cosmos://`
- [ ] Frontend files updated while app running -> auto-reload, state preserved
- [ ] PTY sessions survive WebView reload
- [ ] IPC commands work after reload (git status, file browser, etc.)

## Checklist

- [ ] Step 1: Add `mime_guess` dependency
- [ ] Step 2: Register `cosmos://` custom protocol
- [ ] Step 3: Startup navigation to `cosmos://`
- [ ] Step 4: Frontend watcher (auto-reload trigger)
- [ ] Step 5: Frontend reload listener
- [ ] Step 6: CSP update
- [ ] Step 7: Build script — smart detect function
- [ ] Step 8: Build script — frontend-only build function
- [ ] Step 9: Build script — install function
- [ ] Step 10: Build script — update mode handlers
- [ ] Step 11: Build script — argument parser update
