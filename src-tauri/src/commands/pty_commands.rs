use tauri::ipc::Channel;
use tauri::State;

use crate::models::PtySessionInfo;
use crate::pty::manager::SessionManager;

#[tauri::command]
pub fn create_session(
    session_manager: State<'_, SessionManager>,
    project_path: String,
    shell_path: Option<String>,
    rows: u16,
    cols: u16,
    on_output: Channel<Vec<u8>>,
    on_exit: Channel<bool>,
) -> Result<PtySessionInfo, String> {
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
    session_manager.resize_session(&session_id, rows, cols)
}

#[tauri::command]
pub fn kill_session(
    session_manager: State<'_, SessionManager>,
    session_id: String,
) -> Result<(), String> {
    session_manager.kill_session(&session_id)
}
