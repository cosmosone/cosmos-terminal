use tauri::{AppHandle, Manager};

use crate::commands::task::spawn_blocking_result;
use crate::watcher::FsWatcher;

#[tauri::command]
pub async fn watch_directory(app: AppHandle, path: String) -> Result<(), String> {
    spawn_blocking_result(move || {
        let watcher = app.state::<FsWatcher>();
        watcher.watch(&path)
    })
    .await
}

#[tauri::command]
pub async fn unwatch_directory(app: AppHandle) -> Result<(), String> {
    spawn_blocking_result(move || {
        let watcher = app.state::<FsWatcher>();
        watcher.unwatch();
        Ok(())
    })
    .await
}
