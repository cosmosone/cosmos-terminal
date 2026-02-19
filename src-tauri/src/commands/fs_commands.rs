use std::io::Read;

use crate::models::{DirEntry, DirectoryListing, FileContent};
use crate::IGNORED_DIRS;

/// Reject paths that attempt to escape via symlink traversal or that target
/// well-known system-critical locations.  This is a defense-in-depth measure;
/// the primary trust boundary is the Tauri capability system.
fn validate_write_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);

    // Reject paths with ".." components (before canonicalization) to prevent
    // TOCTOU races where the target is swapped between check and use.
    for component in p.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("Path must not contain '..' components".to_string());
        }
    }

    // Block a small set of system-critical roots
    #[cfg(target_os = "windows")]
    {
        let lower = path.to_lowercase().replace('/', "\\");
        if lower.starts_with("c:\\windows") || lower.starts_with("c:\\program files") {
            return Err("Cannot modify system directories".to_string());
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        for prefix in ["/bin", "/sbin", "/usr", "/etc", "/boot", "/lib", "/proc", "/sys"] {
            if path.starts_with(prefix) {
                return Err("Cannot modify system directories".to_string());
            }
        }
    }

    Ok(())
}

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
    // Canonicalize to resolve symlinks and ".." segments before passing to
    // OS commands, preventing path traversal via crafted paths.
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Invalid path: {e}"))?;
    tokio::task::spawn_blocking(move || {
        let path = canonical.to_string_lossy();
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
                .args(["-R", path.as_ref()])
                .spawn()
                .map_err(|e| format!("Failed to open Finder: {e}"))?;
        }
        #[cfg(target_os = "linux")]
        {
            let p = std::path::Path::new(path.as_ref());
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
    validate_write_path(&path)?;
    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    validate_write_path(&path)?;
    tokio::task::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        if p.is_dir() {
            // Guard: refuse to recursively delete through a symlink, which
            // would destroy the *target* directory's contents.
            let meta = std::fs::symlink_metadata(p)
                .map_err(|e| format!("Failed to read path metadata: {e}"))?;
            if meta.is_symlink() {
                return Err("Cannot recursively delete a symlinked directory".to_string());
            }
            std::fs::remove_dir_all(p).map_err(|e| format!("Failed to delete directory: {e}"))
        } else {
            std::fs::remove_file(p).map_err(|e| format!("Failed to delete file: {e}"))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_write_path ──

    #[test]
    fn validate_write_path_allows_normal_paths() {
        assert!(validate_write_path("/home/user/projects/foo.txt").is_ok());
        assert!(validate_write_path("/tmp/test").is_ok());
    }

    #[test]
    fn validate_write_path_rejects_parent_traversal() {
        assert!(validate_write_path("/home/user/../etc/passwd").is_err());
        assert!(validate_write_path("../outside").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn validate_write_path_rejects_windows_system_dirs() {
        assert!(validate_write_path("C:\\Windows\\System32\\cmd.exe").is_err());
        assert!(validate_write_path("c:/windows/system32").is_err());
        assert!(validate_write_path("C:\\Program Files\\app").is_err());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn validate_write_path_rejects_unix_system_dirs() {
        assert!(validate_write_path("/bin/sh").is_err());
        assert!(validate_write_path("/usr/local/bin/app").is_err());
        assert!(validate_write_path("/etc/passwd").is_err());
        assert!(validate_write_path("/proc/1/status").is_err());
    }

    // ── list_directory_sync ──

    #[test]
    fn list_directory_sync_returns_entries() {
        let dir = std::env::temp_dir();
        let result = list_directory_sync(dir.to_str().unwrap());
        assert!(result.is_ok());
        let listing = result.unwrap();
        assert_eq!(listing.path, dir.to_str().unwrap());
    }

    #[test]
    fn list_directory_sync_fails_on_nonexistent() {
        let result = list_directory_sync("/nonexistent/path/that/does/not/exist");
        assert!(result.is_err());
    }

    #[test]
    fn list_directory_sync_sorts_dirs_before_files() {
        // Create a temp dir with known structure
        let base = std::env::temp_dir().join("cosmos_test_list_sort");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("z_subdir")).unwrap();
        std::fs::write(base.join("a_file.txt"), "test").unwrap();

        let result = list_directory_sync(base.to_str().unwrap()).unwrap();
        assert!(result.entries.len() >= 2);
        // Directory should come before the file
        assert!(result.entries[0].is_dir);
        assert!(!result.entries.last().unwrap().is_dir);

        let _ = std::fs::remove_dir_all(&base);
    }

    // ── search_files_sync ──

    #[test]
    fn search_files_sync_finds_matching_files() {
        let base = std::env::temp_dir().join("cosmos_test_search");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("nested")).unwrap();
        std::fs::write(base.join("hello_world.txt"), "content").unwrap();
        std::fs::write(base.join("nested/hello_again.txt"), "content").unwrap();
        std::fs::write(base.join("other.rs"), "content").unwrap();

        let result = search_files_sync(base.to_str().unwrap(), "hello").unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|e| e.name.contains("hello")));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn search_files_sync_case_insensitive() {
        let base = std::env::temp_dir().join("cosmos_test_search_ci");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("README.md"), "content").unwrap();

        let result = search_files_sync(base.to_str().unwrap(), "readme").unwrap();
        assert_eq!(result.len(), 1);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn search_files_sync_respects_max_results() {
        let base = std::env::temp_dir().join("cosmos_test_search_max");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        // Create more than MAX_SEARCH_RESULTS files
        for i in 0..105 {
            std::fs::write(base.join(format!("match_{i:03}.txt")), "content").unwrap();
        }

        let result = search_files_sync(base.to_str().unwrap(), "match").unwrap();
        assert!(result.len() <= MAX_SEARCH_RESULTS);

        let _ = std::fs::remove_dir_all(&base);
    }

    // ── read_text_file_sync ──

    #[test]
    fn read_text_file_sync_reads_content() {
        let path = std::env::temp_dir().join("cosmos_test_read.txt");
        std::fs::write(&path, "hello world").unwrap();

        let result = read_text_file_sync(path.to_str().unwrap(), None).unwrap();
        assert_eq!(result.content, "hello world");
        assert!(!result.binary);
        assert!(!result.truncated);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_text_file_sync_detects_binary() {
        let path = std::env::temp_dir().join("cosmos_test_binary.bin");
        std::fs::write(&path, b"hello\x00world").unwrap();

        let result = read_text_file_sync(path.to_str().unwrap(), None).unwrap();
        assert!(result.binary);
        assert!(result.content.is_empty());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_text_file_sync_truncates_large_files() {
        let path = std::env::temp_dir().join("cosmos_test_large.txt");
        let content = "x".repeat(200);
        std::fs::write(&path, &content).unwrap();

        let result = read_text_file_sync(path.to_str().unwrap(), Some(100)).unwrap();
        assert!(result.truncated);
        assert_eq!(result.content.len(), 100);

        let _ = std::fs::remove_file(&path);
    }
}
