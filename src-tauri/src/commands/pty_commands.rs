use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::commands::task::spawn_blocking_result;
use crate::models::PtySessionInfo;
use crate::pty::manager::SessionManager;
use crate::pty::process_monitor::ProcessMonitor;
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
pub async fn create_session(
    app: AppHandle,
    pane_id: String,
    project_path: String,
    shell_path: Option<String>,
    rows: u16,
    cols: u16,
    on_output: Channel<String>,
    on_exit: Channel<bool>,
) -> Result<PtySessionInfo, String> {
    validate_session_id(&pane_id)?;
    validate_dimensions(rows, cols)?;
    spawn_blocking_result(move || {
        let shell_path = normalize_shell_path(shell_path)?;
        let session_manager = app.state::<SessionManager>();
        let info =
            session_manager.create_session(pane_id, shell_path, project_path, rows, cols, on_output, on_exit)?;
        let monitor = app.state::<ProcessMonitor>();
        monitor.register(info.id.clone(), info.pid);
        Ok(info)
    })
    .await
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    const UUID_LEN: usize = 36;
    const HYPHEN_POSITIONS: [usize; 4] = [8, 13, 18, 23];

    let bytes = session_id.as_bytes();
    if bytes.len() != UUID_LEN {
        return Err("Invalid session id".to_string());
    }

    for (index, b) in bytes.iter().enumerate() {
        if HYPHEN_POSITIONS.contains(&index) {
            if *b != b'-' {
                return Err("Invalid session id".to_string());
            }
            continue;
        }
        if !b.is_ascii_hexdigit() {
            return Err("Invalid session id".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn write_to_session(
    app: AppHandle,
    session_id: String,
    data: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    spawn_blocking_result(move || {
        let session_manager = app.state::<SessionManager>();
        session_manager.write_to_session(&session_id, data.as_bytes())
    })
    .await
}

#[tauri::command]
pub async fn resize_session(
    app: AppHandle,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    validate_dimensions(rows, cols)?;
    validate_session_id(&session_id)?;
    spawn_blocking_result(move || {
        let session_manager = app.state::<SessionManager>();
        session_manager.resize_session(&session_id, rows, cols)
    })
    .await
}

#[tauri::command]
pub async fn list_sessions(app: AppHandle) -> Result<Vec<PtySessionInfo>, String> {
    spawn_blocking_result(move || {
        let session_manager = app.state::<SessionManager>();
        Ok(session_manager.list_sessions())
    })
    .await
}

#[tauri::command]
pub async fn reconnect_session(
    app: AppHandle,
    session_id: String,
    on_output: Channel<String>,
    on_exit: Channel<bool>,
    skip_replay: Option<bool>,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let skip = skip_replay.unwrap_or(false);
    spawn_blocking_result(move || {
        let session_manager = app.state::<SessionManager>();
        session_manager.reconnect_session(&session_id, on_output, on_exit, skip)
    })
    .await
}

#[tauri::command]
pub async fn kill_session(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    spawn_blocking_result(move || {
        let monitor = app.state::<ProcessMonitor>();
        monitor.unregister(&session_id);
        let session_manager = app.state::<SessionManager>();
        session_manager.kill_session(&session_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::validate_session_id;

    #[test]
    fn accepts_uuid_session_ids() {
        assert!(validate_session_id("123e4567-e89b-12d3-a456-426614174000").is_ok());
    }

    #[test]
    fn rejects_non_uuid_session_ids() {
        assert!(validate_session_id("not-a-session").is_err());
        assert!(validate_session_id("123e4567e89b12d3a456426614174000").is_err());
        assert!(validate_session_id("123e4567-e89b-12d3-a456-42661417400z").is_err());
    }
}
