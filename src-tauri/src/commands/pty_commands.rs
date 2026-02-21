use tauri::ipc::Channel;
use tauri::State;

use crate::models::PtySessionInfo;
use crate::pty::manager::SessionManager;
use crate::pty::shell::normalize_shell_path;

fn validate_dimensions(rows: u16, cols: u16) -> Result<(), String> {
    if rows == 0 || cols == 0 || rows > 500 || cols > 500 {
        return Err(format!(
            "Invalid terminal dimensions: {}x{} (must be 1–500)",
            cols, rows
        ));
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
    let shell_path = normalize_shell_path(shell_path)?;
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
