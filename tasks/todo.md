# Browser Tab Feature — Implementation

## Phase 1: Types, State & Settings
- [ ] 1.1 Add `BrowserTab` interface to `state/types.ts`
- [ ] 1.2 Extend `Project` with `browserTabs` + `activeBrowserTabId`
- [ ] 1.3 Add `browserHomePage` to `AppSettings`
- [ ] 1.4 Add default in `settings-service.ts`
- [ ] 1.5 Add "Browser" section in `settings-page.ts`
- [ ] 1.6 Add browser tab actions in `actions.ts`

## Phase 2: Rust Backend — Webview Management
- [ ] 2.1 Create `browser/mod.rs` + `browser/manager.rs`
- [ ] 2.2 Create `commands/browser_commands.rs`
- [ ] 2.3 Add `BrowserNavEvent` model
- [ ] 2.4 Register module, state, commands in `lib.rs`
- [ ] 2.5 Update capabilities if needed

## Phase 3: Frontend — Browser Service
- [ ] 3.1 Create `services/browser-service.ts`

## Phase 4: Frontend — UI Components
- [ ] 4.1 Add `globeIcon` to `utils/icons.ts`
- [ ] 4.2 Add browser button + browser tabs to `session-tab-bar.ts`
- [ ] 4.3 Add `#browser-tab-container` to `index.html` + stylesheet link
- [ ] 4.4 Create `styles/browser-tabs.css`
- [ ] 4.5 Create `components/browser-tab-content.ts`
- [ ] 4.6 Update visibility logic in `main.ts`

## Phase 5: URL Click → Browser Tab
- [ ] 5.1 Modify `terminal-pane.ts` `openExternalUri`

## Phase 6: Persistence
- [ ] 6.1 Update `workspace-service.ts` save cleanup
- [ ] 6.2 Update `main.ts` restore/migration

## Phase 7: Z-Order & Overlay Handling
- [ ] 7.1 Export suppress/restore in `browser-tab-content.ts`
- [ ] 7.2 Wire into `context-menu.ts` and `confirm-dialog.ts`

## Verification
- [ ] `npx tsc --noEmit` passes
- [ ] `cd src-tauri && cargo clippy --all-targets` passes
- [ ] `python scripts/test.py` passes
