pub fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Validate SHELL through the same allowlist used for user-supplied paths
        // to prevent untrusted env vars from selecting arbitrary binaries.
        std::env::var("SHELL")
            .ok()
            .and_then(|s| super::shell::normalize_shell_path(Some(s)).ok().flatten())
            .unwrap_or_else(|| "/bin/zsh".to_string())
    }
}
