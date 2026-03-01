# Scripts

All scripts are run from the repository root.

## `local.py` — Development

Starts the full dev environment (frontend + Rust backend) with hot reload.

```bash
python scripts/local.py
```

Auto-runs `npm install` if `node_modules` is missing. Equivalent to `cargo tauri dev`.

## `build.py` — Build

### Production release (interactive)

```bash
python scripts/build.py
```

Walks through an interactive flow:

1. Version bump prompt — accept the suggested patch bump, decline, or enter a custom version
2. Full release build with NSIS and MSI installers
3. Publish prompt — commit, tag, push, and create a GitHub release in one step
4. Copy exe prompt — copies the built exe to `COSMOS_TERMINAL_APP_DIR` if set

### Fast local build

```bash
python scripts/build.py --dev
```

Builds the exe only (no installers) using a fast Cargo profile — thin LTO, 8 codegen-units, opt-level 2, incremental compilation. Useful for testing a release binary without the full build overhead.

## `test.py` — Test Pipeline

Runs the full verification pipeline: ESLint, integration tests, stress tests, frontend benchmarks, TypeScript typecheck, Vite build, Rust Clippy, and Rust unit tests.

```bash
python scripts/test.py
```

Logs are saved to `logs/test/<timestamp>/` with one file per step.
