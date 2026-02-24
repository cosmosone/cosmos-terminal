use std::path::{Component, Path, PathBuf};

/// Canonicalize an existing filesystem path after basic input validation.
pub fn canonicalize_existing_path(path: &str) -> Result<PathBuf, String> {
    validate_raw_path(path)?;
    std::fs::canonicalize(path).map_err(|e| format!("Invalid path: {e}"))
}

/// Canonicalize an existing directory path.
pub fn canonicalize_existing_dir(path: &str) -> Result<PathBuf, String> {
    let canonical = canonicalize_existing_path(path)?;
    if !canonical.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    Ok(canonical)
}

/// Canonicalize an existing file path.
pub fn canonicalize_existing_file(path: &str) -> Result<PathBuf, String> {
    let canonical = canonicalize_existing_path(path)?;
    if !canonical.is_file() {
        return Err(format!("Not a file: {path}"));
    }
    Ok(canonical)
}

/// Canonicalize a write/delete target.
///
/// Existing targets are canonicalized directly. New targets are resolved via
/// their canonicalized parent directory.
pub fn canonicalize_write_target(path: &str) -> Result<PathBuf, String> {
    validate_raw_path(path)?;

    let p = Path::new(path);
    reject_parent_components(p)?;

    let canonical = if p.exists() {
        std::fs::canonicalize(p).map_err(|e| format!("Invalid path: {e}"))?
    } else {
        let parent = p
            .parent()
            .ok_or_else(|| "Path must include a parent directory".to_string())?;
        let canonical_parent =
            std::fs::canonicalize(parent).map_err(|e| format!("Invalid path: {e}"))?;
        let file_name = p
            .file_name()
            .ok_or_else(|| "Path must reference a file or directory name".to_string())?;
        canonical_parent.join(file_name)
    };

    if is_system_critical_path(&canonical) {
        return Err("Cannot modify system directories".to_string());
    }

    Ok(canonical)
}

/// Reject empty strings and NUL bytes at the IPC boundary.
fn validate_raw_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if path.as_bytes().contains(&0) {
        return Err("Path contains unsupported null bytes".to_string());
    }
    Ok(())
}

/// Reject `..` segments before canonicalization to reduce traversal risk.
fn reject_parent_components(path: &Path) -> Result<(), String> {
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err("Path must not contain '..' components".to_string());
        }
    }
    Ok(())
}

/// Block a small set of system-critical roots.
fn is_system_critical_path(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut lower = path.to_string_lossy().to_lowercase().replace('/', "\\");
        if let Some(stripped) = lower.strip_prefix("\\\\?\\") {
            lower = stripped.to_string();
        }
        for prefix in [
            "c:\\windows",
            "c:\\program files",
            "c:\\program files (x86)",
            "c:\\programdata",
        ] {
            if lower == prefix || lower.starts_with(&format!("{prefix}\\")) {
                return true;
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        [
            "/bin", "/sbin", "/usr", "/etc", "/boot", "/lib", "/proc", "/sys",
        ]
        .iter()
        .any(|prefix| path.starts_with(prefix))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalize_existing_path_rejects_empty() {
        assert!(canonicalize_existing_path("").is_err());
    }

    #[test]
    fn canonicalize_existing_path_rejects_nul() {
        let err = canonicalize_existing_path("abc\0def").expect_err("nul path must fail");
        assert!(err.contains("null bytes"));
    }

    #[test]
    fn canonicalize_write_target_rejects_parent_dir_segments() {
        assert!(canonicalize_write_target("../outside.txt").is_err());
        assert!(canonicalize_write_target("a/../b.txt").is_err());
    }

    #[test]
    fn canonicalize_write_target_allows_new_file_under_existing_parent() {
        let base = std::env::temp_dir().join("cosmos_path_guard_write_target");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let target = base.join("notes.txt");
        let canonical = canonicalize_write_target(target.to_string_lossy().as_ref()).unwrap();
        assert!(canonical.ends_with("notes.txt"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn canonicalize_write_target_rejects_windows_system_dir() {
        assert!(canonicalize_write_target("C:\\Windows\\System32\\drivers\\etc\\hosts").is_err());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn canonicalize_write_target_rejects_unix_system_dir() {
        assert!(canonicalize_write_target("/etc/passwd").is_err());
    }
}
