use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

/// Must match `FRONTEND_UPDATED_EVENT` in `src/state/types.ts`.
const FRONTEND_UPDATED_EVENT: &str = "frontend-updated";

struct Inner {
    watcher: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    thread: std::thread::JoinHandle<()>,
}

impl Inner {
    fn shutdown(self) {
        drop(self.watcher);
        std::thread::spawn(move || {
            let _ = self.thread.join();
        });
    }
}

pub struct FrontendWatcher {
    inner: Mutex<Option<Inner>>,
}

impl FrontendWatcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Watch for changes in `frontend_dir` by monitoring its parent directory.
    ///
    /// Watching the parent instead of `frontend/` directly means the watcher
    /// survives the directory being deleted and recreated (e.g. by the build
    /// script), because the parent directory handle stays valid.
    pub fn watch(&self, app: &AppHandle, frontend_dir: &Path) -> Result<(), String> {
        self.stop();

        let parent = frontend_dir
            .parent()
            .ok_or_else(|| "frontend_dir has no parent".to_string())?;

        if !parent.is_dir() {
            return Err(format!("Parent directory does not exist: {}", parent.display()));
        }

        let frontend_canonical = dunce::canonicalize(parent)
            .map_err(|e| format!("Failed to canonicalise parent: {e}"))?
            .join(
                frontend_dir
                    .file_name()
                    .ok_or_else(|| "frontend_dir has no file name".to_string())?,
            );

        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(1500), tx)
            .map_err(|e| format!("Failed to create frontend watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(parent, notify::RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {e}"))?;

        let app = app.clone();
        let thread = std::thread::spawn(move || {
            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(_) => continue,
                };

                let has_frontend_changes = events.iter().any(|e| {
                    e.kind == DebouncedEventKind::Any
                        && e.path.starts_with(&frontend_canonical)
                });

                if has_frontend_changes {
                    let _ = app.emit(FRONTEND_UPDATED_EVENT, ());
                }
            }
        });

        *self.inner.lock() = Some(Inner {
            watcher: debouncer,
            thread,
        });

        Ok(())
    }

    pub fn stop(&self) {
        if let Some(inner) = self.inner.lock().take() {
            inner.shutdown();
        }
    }
}
