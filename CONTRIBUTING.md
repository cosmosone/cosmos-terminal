# Contributing to Cosmos Terminal

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

## Setup

```bash
git clone https://github.com/user/cosmos-tauri-terminal.git
cd cosmos-tauri-terminal
npm install
npm run tauri dev
```

## Project Structure

```
src/                  # Frontend (TypeScript + xterm.js)
  components/         # UI components
  services/           # PTY, settings, git, OpenAI services
  state/              # Centralised state management
  styles/             # CSS stylesheets
  layout/             # Pane tree layout logic

src-tauri/            # Backend (Rust + Tauri v2)
  src/
    commands/          # Tauri IPC command handlers
    pty/               # PTY session management
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npx tsc --noEmit` to check for type errors
4. Run `cargo clippy` in `src-tauri/` to check for Rust warnings
5. Test your changes with `npm run tauri dev`
6. Submit a pull request

## Code Style

- **TypeScript**: Strict mode with `noUnusedLocals` and `noUnusedParameters` enabled
- **Rust**: Standard formatting via `cargo fmt`, linting via `cargo clippy`
- **CSS**: One file per component, BEM-style class naming with `git-`, `pane-`, `settings-` prefixes
- **Commits**: [Conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, etc.)

## Reporting Issues

- Search existing issues before creating a new one
- Include steps to reproduce, expected behaviour, and actual behaviour
- Include your OS and app version

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
