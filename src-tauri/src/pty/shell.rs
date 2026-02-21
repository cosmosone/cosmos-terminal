use std::ffi::OsStr;
use std::path::{Path, PathBuf};

const ALLOWED_NAMES: &[&str] = &[
    "powershell.exe",
    "pwsh.exe",
    "cmd.exe",
    "bash.exe",
    "bash",
    "zsh",
    "fish",
    "sh",
    "dash",
    "pwsh",
    "powershell",
    "nu",
    "elvish",
];

/// Validate and normalize a user-supplied shell path.
///
/// - Absolute path: must exist and be a regular file.
/// - Bare name: must be allowlisted and resolvable from PATH.
pub fn normalize_shell_path(shell_path: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = shell_path else {
        return Ok(None);
    };

    let shell = raw.trim();
    if shell.is_empty() {
        return Err("Shell path cannot be empty".to_string());
    }

    let path = Path::new(shell);
    if path.is_absolute() {
        let canonical =
            std::fs::canonicalize(path).map_err(|e| format!("Shell not found: {shell} ({e})"))?;
        let meta = std::fs::metadata(&canonical).map_err(|e| format!("Invalid shell path: {e}"))?;
        if !meta.is_file() {
            return Err(format!("Shell path is not a file: {shell}"));
        }
        return Ok(Some(canonical.to_string_lossy().to_string()));
    }

    if !is_allowed_shell_name(shell) {
        return Err(format!(
            "Shell must be an absolute path or a known shell name, got: {shell}"
        ));
    }

    let resolved =
        resolve_shell_in_path(shell).ok_or_else(|| format!("Shell not found in PATH: {shell}"))?;
    Ok(Some(resolved.to_string_lossy().to_string()))
}

fn is_allowed_shell_name(name: &str) -> bool {
    ALLOWED_NAMES.iter().any(|s| name.eq_ignore_ascii_case(s))
}

fn resolve_shell_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let pathext_var = std::env::var_os("PATHEXT");
    resolve_shell_in_path_with(name, &path_var, pathext_var.as_deref())
}

fn resolve_shell_in_path_with(
    name: &str,
    path_var: &OsStr,
    pathext_var: Option<&OsStr>,
) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let candidates = windows_name_candidates(name, pathext_var);
    #[cfg(not(target_os = "windows"))]
    let candidates = vec![name.to_string()];

    for dir in std::env::split_paths(path_var) {
        for candidate_name in &candidates {
            let candidate = dir.join(candidate_name);
            if is_executable_file(&candidate) {
                return Some(std::fs::canonicalize(&candidate).unwrap_or(candidate));
            }
        }
    }
    None
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return meta.permissions().mode() & 0o111 != 0;
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(target_os = "windows")]
fn windows_name_candidates(name: &str, pathext_var: Option<&OsStr>) -> Vec<String> {
    if Path::new(name).extension().is_some() {
        return vec![name.to_string()];
    }

    let exts = pathext_var
        .and_then(|v| v.to_str())
        .unwrap_or(".COM;.EXE;.BAT;.CMD")
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|ext| {
            if ext.starts_with('.') {
                ext.to_string()
            } else {
                format!(".{ext}")
            }
        });

    exts.map(|ext| format!("{name}{ext}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn normalize_shell_path_rejects_unknown_shell_name() {
        let err = normalize_shell_path(Some("not-a-shell".to_string()))
            .expect_err("unknown shell name must be rejected");
        assert!(err.contains("known shell name"));
    }

    #[test]
    fn normalize_shell_path_rejects_missing_absolute_path() {
        let path = std::env::temp_dir().join("cosmos_missing_shell_1234");
        let err = normalize_shell_path(Some(path.to_string_lossy().to_string()))
            .expect_err("missing absolute path must be rejected");
        assert!(err.contains("Shell not found"));
    }

    #[test]
    fn normalize_shell_path_rejects_directory_path() {
        let dir = std::env::temp_dir().join("cosmos_shell_dir_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let err = normalize_shell_path(Some(dir.to_string_lossy().to_string()))
            .expect_err("directory path must be rejected");
        assert!(err.contains("not a file"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_shell_in_path_uses_provided_path_value() {
        let base = std::env::temp_dir().join("cosmos_shell_path_resolve");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();

        #[cfg(target_os = "windows")]
        let file_name = "pwsh.exe";
        #[cfg(not(target_os = "windows"))]
        let file_name = "bash";

        let shell_path = base.join(file_name);
        fs::write(&shell_path, b"#!/bin/sh\n").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&shell_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&shell_path, perms).unwrap();
        }

        let path_var = std::env::join_paths([base.as_os_str()]).unwrap();
        let resolved = resolve_shell_in_path_with(
            #[cfg(target_os = "windows")]
            "pwsh",
            #[cfg(not(target_os = "windows"))]
            "bash",
            &path_var,
            Some(OsStr::new(".EXE;.CMD")),
        )
        .expect("shell should resolve from provided PATH");

        assert_eq!(
            resolved.file_name().and_then(|s| s.to_str()),
            Some(file_name)
        );

        let _ = fs::remove_dir_all(&base);
    }
}
