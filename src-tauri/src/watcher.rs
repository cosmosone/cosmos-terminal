use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

use crate::IGNORED_DIRS;

struct Inner {
    _watcher: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    _thread: std::thread::JoinHandle<()>,
}

pub struct FsWatcher {
    app: AppHandle,
    inner: Mutex<Option<Inner>>,
}

impl FsWatcher {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Mutex::new(None),
        }
    }

    pub fn watch(&self, path: &str) -> Result<(), String> {
        // Stop any existing watcher first
        self.unwatch();

        let watch_path = PathBuf::from(path);
        if !watch_path.is_dir() {
            return Err(format!("Not a directory: {path}"));
        }

        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
            .map_err(|e| format!("Failed to create watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(&watch_path, notify::RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {e}"))?;

        let app = self.app.clone();
        let root = watch_path.clone();
        let thread = std::thread::spawn(move || {
            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(_) => continue,
                };

                // Collect unique parent directories, filtering ignored dirs.
                // Cap at MAX_EMIT_DIRS to avoid flooding the frontend on
                // mass-rename / bulk-delete operations; if exceeded, emit a
                // single root-level event so the UI does a full refresh.
                const MAX_EMIT_DIRS: usize = 50;

                let mut affected_dirs = HashSet::new();
                for event in &events {
                    if event.kind != DebouncedEventKind::Any {
                        continue;
                    }
                    if is_ignored(&event.path, &root) {
                        continue;
                    }
                    if let Some(parent) = event.path.parent() {
                        affected_dirs.insert(parent.to_string_lossy().to_string());
                    }
                    if affected_dirs.len() > MAX_EMIT_DIRS {
                        break;
                    }
                }

                if affected_dirs.len() > MAX_EMIT_DIRS {
                    // Too many dirs changed — emit the watched root for a full refresh
                    let _ = app.emit("fs-change", &root.to_string_lossy().to_string());
                } else {
                    for dir in affected_dirs {
                        let _ = app.emit("fs-change", &dir);
                    }
                }
            }
        });

        *self.inner.lock() = Some(Inner {
            _watcher: debouncer,
            _thread: thread,
        });

        Ok(())
    }

    pub fn unwatch(&self) {
        // Dropping the Inner struct stops the watcher and the channel,
        // which causes the receiver thread to exit.
        *self.inner.lock() = None;
    }
}

/// Returns true if the path passes through any ignored directory.
fn is_ignored(path: &Path, root: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    relative.components().any(|c| {
        matches!(c, std::path::Component::Normal(name) if name.to_str().is_some_and(|s| IGNORED_DIRS.contains(&s)))
    })
}
