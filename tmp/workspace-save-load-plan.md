# Workspace Save/Load Feature

## Context

Users want to save the current app state (project tabs, terminal sessions, file tabs, browser tabs with URLs, pane layouts, sidebar state) to a file and restore it later. This is separate from the existing auto-save (`workspace.json` in app data dir) which continues working unchanged.

## UI/UX: Unified Hamburger Menu

**Replace the existing settings gear icon with a single hamburger menu button (☰)** in the `project-tab-actions` area. This becomes the app's primary action menu, containing both workspace operations and settings access.

```
Project Tab Bar (right side):

  [...tabs...]  [+]  [☰]
                      │
                      ▼
              ┌───────────────────────┐
              │ Save Workspace As...  │  Ctrl+Shift+S
              │ Open Workspace...     │  Ctrl+Shift+O
              │───────────────────────│
              │ Settings              │  (existing shortcut)
              └───────────────────────┘
```

**Why merge?**
- Reduces button clutter — one menu entry point instead of two icons
- Settings is a rarely-used action; it doesn't need a dedicated always-visible button
- Standard pattern in modern apps (VS Code, Windows Terminal use a single menu for all actions)
- The hamburger menu can grow to include more actions in the future without adding more buttons

**Keyboard shortcuts remain unchanged:**
- `Ctrl+Shift+S` — Save Workspace As
- `Ctrl+Shift+O` — Open Workspace
- Existing settings shortcut continues to work

## File Format: `.cosmosw`

```json
{
  "version": 1,
  "savedAt": "2026-03-07T12:00:00Z",
  "workspace": {
    "projects": [...],
    "activeProjectId": "...",
    "gitSidebar": { ... },
    "fileBrowserSidebar": { ... }
  }
}
```

**Saved**: projects (with sessions, pane trees, file tabs, browser tabs + URLs), sidebar UI state.
**Not saved**: settings (global), git states (runtime), activity flags, dirty/loading flags.

## State Restoration Flow

1. User confirms ("Loading will close all current sessions. Continue?")
2. Tear down: cleanup session tracking + close all browser webviews
3. Reset store with loaded data (preserving current settings)
4. `splitContainer.render()` — disposes old terminals, creates new PTY sessions
5. Auto-save fires naturally, keeping `workspace.json` in sync

Key insight: `SplitContainer.render()` already handles creating terminals for new pane IDs and disposing orphans — no special handling needed.

## Implementation Steps

### 1. Add `dialog:allow-save` capability
**File**: `src-tauri/capabilities/default.json`
- Add `"dialog:allow-save"` to permissions array

### 2. Add keybinding config entries
**File**: `src/state/types.ts` — add `saveWorkspaceAs` and `openWorkspace` to `KeybindingConfig`
**File**: `src/services/settings-service.ts` — add defaults `Ctrl+Shift+s` / `Ctrl+Shift+o`

### 3. Create workspace file service
**New file**: `src/services/workspace-file-service.ts`
- `saveWorkspaceToFile()` — `save()` dialog → clean transient state → `writeTextFile()`
- `loadWorkspaceFromFile()` — `open()` dialog → `readTextFile()` → parse + validate
- Reuse same cleaning logic as `workspace-service.ts`

### 4. Add teardown + replace actions
**File**: `src/state/actions.ts`
- `teardownAllProjects()` — iterate all projects, cleanup tracking, close browser webviews
- `replaceWorkspaceState()` — teardown → reset store with new data (keep settings)

### 5. Replace settings gear with hamburger menu
**File**: `src/utils/icons.ts` — add `menuIcon()` (three horizontal lines)
**File**: `src/components/project-tab-bar.ts`
- Remove the dedicated settings gear button
- Add hamburger menu button in its place
- Dropdown panel with: "Save Workspace As...", "Open Workspace...", separator, "Settings"
- "Settings" item calls `toggleSettingsView()` (same as the old gear button)
- Reuse existing dropdown panel pattern from the project list dropdown

**File**: `src/styles/project-tabs.css` — styles for menu dropdown (reuse existing dropdown pattern, add separator style)

### 6. Wire keyboard shortcuts + load logic
**File**: `src/main.ts`
- Extract `migrateWorkspaceProjects()` helper (shared with startup migration code)
- Register `saveWorkspaceAs` and `openWorkspace` keybindings
- Load handler: confirm → load file → migrate → `replaceWorkspaceState()` → `render()`

### 7. Add keybinding rows to settings
**File**: `src/components/settings-page.ts` — add UI rows for the two new keybindings

## Files Summary

| File | Action |
|------|--------|
| `src-tauri/capabilities/default.json` | Modify — add `dialog:allow-save` |
| `src/state/types.ts` | Modify — add keybinding entries |
| `src/services/settings-service.ts` | Modify — add keybinding defaults |
| `src/services/workspace-file-service.ts` | **Create** — save/load `.cosmosw` files |
| `src/state/actions.ts` | Modify — add teardown/replace actions |
| `src/utils/icons.ts` | Modify — add menu icon |
| `src/components/project-tab-bar.ts` | Modify — replace gear with hamburger menu + dropdown |
| `src/styles/project-tabs.css` | Modify — menu dropdown styles |
| `src/main.ts` | Modify — keybindings, migration helper, load logic |
| `src/components/settings-page.ts` | Modify — keybinding settings rows |

## Verification

1. `python scripts/test.py` — type check + Rust checks pass
2. `npm run tauri dev` — manual testing:
   - Open multiple projects with sessions, splits, file tabs, browser tabs
   - Save workspace via hamburger menu and via `Ctrl+Shift+S`
   - Close all projects, load the saved file via menu and via `Ctrl+Shift+O`
   - Verify all projects/sessions/tabs/pane layouts restored
   - Verify settings gear button is gone, settings accessible via hamburger menu
   - Verify existing auto-save still works after load
