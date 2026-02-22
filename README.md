# Cosmos Terminal

**A terminal built for coding on Windows.** Project-level workspace organization, split panes, a file browser, and a built-in Git sidebar — so you can write, navigate, and commit without ever leaving the terminal.

Built with [Tauri v2](https://v2.tauri.app/) + Rust. Developed and tested on Windows 11.

![Cosmos Terminal in action — terminal with integrated Git sidebar showing source control, commit history, and file changes](resources/cosmos-terminal.png)

---

## The Problem

Developers on Windows don't have many great options. Windows Terminal is fast but it's just a shell — no project awareness, no source control. VS Code has an integrated terminal but you're running an entire IDE just to use a terminal with Git. Tabby and Hyper are Electron-based, cross-platform afterthoughts that don't feel native on Windows.

**Cosmos Terminal fills the gap**: a lightweight Windows terminal that understands your coding workflow.

## What Makes It Different

### Project-Level Organization

Most terminals give you a flat list of tabs. That breaks down when you're working across multiple codebases. Cosmos Terminal organizes terminals in two levels — **projects** at the top, **sessions** within each project:

```
cosmos-api          ← project tab
  ├── terminal 1    →  dev server
  ├── terminal 2    →  database
  └── terminal 3    →  tests

cosmos-frontend     ← project tab
  ├── terminal 1    →  vite dev
  └── terminal 2    →  playwright
```

Switch projects with one click. Each project keeps its own terminals, split layouts, and working directory — all persisted across restarts.

### Tab Activity Indicators

When a background terminal has a running command, a pulsing blue dot appears on its session tab and project tab — so you always know where work is happening without switching tabs to check.

- Detects activity via **OSC 133 shell integration** (precise command start/finish signals) with automatic fallback to **output volume heuristics** for shells without OSC support
- Dots only appear on **background tabs** — never on the tab you're already looking at
- Auto-clears when the command finishes (OSC) or output stops for 5 seconds (fallback)
- Suppresses false positives from terminal resize/repaint bursts after tab switches

### Built-in Git Sidebar

Stage files, review diffs, write commit messages, and push — right next to your terminal. No context switching to another app. Toggle it with `Ctrl+Shift+G`.

Projects with no working-tree file changes stay compact in the list (no expand chevron and no commit action panel) to reduce visual noise.

Optionally generate conventional commit messages with AI (OpenAI) for large changesets.

### File Browser Sidebar

Browse your project's files without leaving the terminal. Toggle it with `Alt+F` — a tree view of the active project's directory appears on the right side, mirroring the Git sidebar's position.

- **Tree navigation** — Expand and collapse folders inline. The tree auto-scopes to the active project's root directory.
- **Open any file** — Double-click any file to open it in a built-in viewer tab. Text files open directly in an editable textarea. Markdown files (`.md`) render as formatted output with a right-click "Edit" option to switch to a raw editor, and "View" to switch back.
- **File tabs in the session bar** — Opened files appear as tabs alongside your terminal sessions, separated by a divider. Dirty (unsaved) files show a `*` prefix. Save with the header button after editing.
- **Real-time file refresh + safe saves** — Open file tabs auto-check for external changes from filesystem events, tab re-activation, window focus, and periodic fallback polling. Saves are conflict-aware: if the file changed on disk, you can reload or explicitly overwrite.
- **Tab locking** — Right-click any tab (terminal or file) and select "Lock" to protect it from "Close Others". Locked tabs show a lock icon in place of the close button — click the icon to unlock.
- **Sidebar mutual exclusion** — Only one sidebar (file browser or Git) is open at a time. Opening one automatically closes the other.
- **Resizable** — Drag the left edge of the sidebar to adjust width (200–500px). Width persists across restarts.

### Built and Tested on Windows 11

This isn't a Linux terminal ported to Windows. Cosmos Terminal is developed and tested on Windows 11 from day one:

- **ConPTY** backend — works with PowerShell, CMD, Git Bash, and other Windows shells
- **WebGL rendering** with ClearType LCD text optimizations
- **Windows 11 dark mode** title bar integration
- **Tauri v2 + Rust** backend — uses the system WebView2 already on Windows 11, no bundled browser

---

## Features

- **Multi-project workspaces** — Top-level project tabs, each with its own terminals and layout
- **Sessions per project** — Tabbed sessions within each project, each with independent split panes
- **Split panes** — Horizontal and vertical splits with keyboard navigation
- **Activity indicators** — Pulsing blue dots on project and session tabs when background terminals have running commands or output, powered by OSC 133 shell integration with volume-based fallback
- **File browser sidebar** — Tree view of the project directory; double-click any file to open it in a built-in viewer/editor tab
- **File tabs** — Text and Markdown viewer/editor tabs alongside terminal sessions, with real-time external change detection and conflict-safe save flows
- **Tab locking** — Lock any tab (terminal or file) to protect it from "Close Others"
- **Git sidebar** — Stage, diff, commit, push, and browse commit history from a collapsible panel
- **AI commit messages** — Generate conventional commit messages from staged changes (OpenAI, optional)
- **WebGL rendering** — GPU-accelerated terminal via xterm.js WebGL addon with ClearType optimizations
- **Workspace persistence** — Projects, sessions, splits, and sidebar state restored on restart
- **Configurable keybindings** — Customize shortcuts for splits, navigation, and session cycling
- **System monitor** — CPU and memory usage in the status bar
- **Lightweight** — Tauri v2 + Rust backend, small install footprint

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Build and Run

```bash
npm install
npm run tauri dev
```

### Build for Production

```bash
npm run tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

## Keybindings

| Action | Shortcut |
|--------|----------|
| New session | `Ctrl+Shift+T` |
| Close session | `Ctrl+Shift+W` |
| Settings | `Ctrl+,` |
| File browser | `Alt+F` |
| Git sidebar | `Ctrl+Shift+G` / `Alt+D` |
| Split panes | Configurable in settings |
| Navigate panes | Configurable in settings |
| Cycle sessions/projects | Configurable in settings |

## Project Structure

```
src/                  # Frontend (TypeScript + xterm.js)
  components/         # UI components (tabs, settings, git sidebar, file browser)
  services/           # PTY, settings, git, filesystem, system monitor
  state/              # Centralized state management
  layout/             # Pane tree and split layout logic
  utils/              # Shared utilities (icons, path helpers, file types)

src-tauri/            # Backend (Rust + Tauri v2)
  src/commands/       # Tauri IPC handlers (git, PTY, filesystem, system)
  src/pty/            # PTY session management (ConPTY)
```

## License

[MIT](LICENSE)
