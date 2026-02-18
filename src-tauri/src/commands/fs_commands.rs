use std::io::Read;

use crate::models::{DirEntry, DirectoryListing, FileContent};

/// Build a `DirEntry` from a `std::fs::DirEntry` and its pre-fetched metadata.
fn dir_entry_from(entry: &std::fs::DirEntry, metadata: &std::fs::Metadata) -> DirEntry {
    let name = entry.file_name().to_string_lossy().to_string();
    let is_dir = metadata.is_dir();
    DirEntry {
        path: entry.path().to_string_lossy().to_string(),
        is_dir,
        size: if is_dir { 0 } else { metadata.len() },
        modified: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        extension: if is_dir {
            String::new()
        } else {
            std::path::Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default()
        },
        name,
    }
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<DirectoryListing, String> {
    tokio::task::spawn_blocking(move || list_directory_sync(&path))
        .await
        .map_err(|e| e.to_string())?
}

const MAX_DIR_ENTRIES: usize = 1000;

fn list_directory_sync(path: &str) -> Result<DirectoryListing, String> {
    let read_dir = std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {e}"))?;

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let dir_entry = dir_entry_from(&entry, &metadata);

        if dir_entry.is_dir {
            dirs.push(dir_entry);
        } else {
            files.push(dir_entry);
        }

        if dirs.len() + files.len() >= MAX_DIR_ENTRIES {
            break;
        }
    }

    dirs.sort_by_cached_key(|e| e.name.to_lowercase());
    files.sort_by_cached_key(|e| e.name.to_lowercase());

    let mut entries = dirs;
    entries.append(&mut files);

    Ok(DirectoryListing {
        path: path.to_string(),
        entries,
    })
}

const DEFAULT_MAX_READ_BYTES: u64 = 5 * 1024 * 1024;

#[tauri::command]
pub async fn read_text_file(path: String, max_bytes: Option<u64>) -> Result<FileContent, String> {
    tokio::task::spawn_blocking(move || read_text_file_sync(&path, max_bytes))
        .await
        .map_err(|e| e.to_string())?
}

fn read_text_file_sync(path: &str, max_bytes: Option<u64>) -> Result<FileContent, String> {
    let max = max_bytes.unwrap_or(DEFAULT_MAX_READ_BYTES);
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    let file_size = metadata.len();
    let truncated = file_size > max;

    let read_len = std::cmp::min(file_size, max) as usize;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mut buf = vec![0u8; read_len];
    file.read_exact(&mut buf)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    // Null-byte heuristic (same as git): if the buffer contains \0, it's binary
    let binary = buf.contains(&0);

    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&buf).to_string()
    };

    Ok(FileContent {
        path: path.to_string(),
        content,
        size: file_size,
        truncated,
        binary,
    })
}

const MAX_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_DEPTH: usize = 20;

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "target",
    ".vite",
    ".vite-temp",
    ".next",
    "build",
    "__pycache__",
    ".serena",
];

#[tauri::command]
pub async fn search_files(root_path: String, query: String) -> Result<Vec<DirEntry>, String> {
    tokio::task::spawn_blocking(move || search_files_sync(&root_path, &query))
        .await
        .map_err(|e| e.to_string())?
}

fn search_files_sync(root_path: &str, query: &str) -> Result<Vec<DirEntry>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    // Stack entries carry their depth to enforce MAX_SEARCH_DEPTH
    let mut stack = vec![(std::path::PathBuf::from(root_path), 0usize)];

    while let Some((dir, depth)) = stack.pop() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        for entry in read_dir {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let name = entry.file_name().to_string_lossy().to_string();

            if metadata.is_dir() {
                if depth < MAX_SEARCH_DEPTH && !IGNORED_DIRS.contains(&name.as_str()) {
                    stack.push((entry.path(), depth + 1));
                }
                continue;
            }

            if name.to_lowercase().contains(&query_lower) {
                results.push(dir_entry_from(&entry, &metadata));
                if results.len() >= MAX_SEARCH_RESULTS {
                    return Ok(results);
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn show_in_explorer(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{path}"))
                .spawn()
                .map_err(|e| format!("Failed to open explorer: {e}"))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(|e| format!("Failed to open Finder: {e}"))?;
        }
        #[cfg(target_os = "linux")]
        {
            let p = std::path::Path::new(&path);
            let dir = p.parent().unwrap_or(p);
            std::process::Command::new("xdg-open")
                .arg(dir.as_os_str())
                .spawn()
                .map_err(|e| format!("Failed to open file manager: {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
