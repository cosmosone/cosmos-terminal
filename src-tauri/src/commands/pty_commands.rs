use tauri::ipc::Channel;
use tauri::State;

use crate::models::PtySessionInfo;
use crate::pty::manager::SessionManager;

fn validate_dimensions(rows: u16, cols: u16) -> Result<(), String> {
    if rows == 0 || cols == 0 || rows > 500 || cols > 500 {
        return Err(format!(
            "Invalid terminal dimensions: {}x{} (must be 1–500)",
            cols, rows
        ));
    }
    Ok(())
}

/// Validate that a user-supplied shell path is either a known shell name
/// (resolved via PATH) or an absolute path to an existing file.
fn validate_shell_path(shell_path: &str) -> Result<(), String> {
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

    let path = std::path::Path::new(shell_path);

    if !path.is_absolute() {
        // Bare name: must match an allowlisted shell
        if !ALLOWED_NAMES
            .iter()
            .any(|s| shell_path.eq_ignore_ascii_case(s))
        {
            return Err(format!(
                "Shell must be an absolute path or a known shell name, got: {shell_path}"
            ));
        }
        return Ok(());
    }

    // Absolute path: verify the file exists
    if !path.exists() {
        return Err(format!("Shell not found: {shell_path}"));
    }

    Ok(())
}

#[tauri::command]
pub fn create_session(
    session_manager: State<'_, SessionManager>,
    project_path: String,
    shell_path: Option<String>,
    rows: u16,
    cols: u16,
    on_output: Channel<String>,
    on_exit: Channel<bool>,
) -> Result<PtySessionInfo, String> {
    validate_dimensions(rows, cols)?;
    if let Some(ref sp) = shell_path {
        validate_shell_path(sp)?;
    }
    session_manager.create_session(shell_path, project_path, rows, cols, on_output, on_exit)
}

#[tauri::command]
pub fn write_to_session(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    session_manager.write_to_session(&session_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_session(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    validate_dimensions(rows, cols)?;
    session_manager.resize_session(&session_id, rows, cols)
}

#[tauri::command]
pub fn kill_session(
    session_manager: State<'_, SessionManager>,
    session_id: String,
) -> Result<(), String> {
    session_manager.kill_session(&session_id)
}
