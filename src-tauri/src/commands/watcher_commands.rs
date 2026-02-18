use tauri::State;

use crate::watcher::FsWatcher;

#[tauri::command]
pub fn watch_directory(watcher: State<'_, FsWatcher>, path: String) -> Result<(), String> {
    watcher.watch(&path)
}

#[tauri::command]
pub fn unwatch_directory(watcher: State<'_, FsWatcher>) {
    watcher.unwatch();
}
