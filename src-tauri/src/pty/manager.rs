use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::ipc::Channel;
use uuid::Uuid;

use super::session::SessionHandle;
use crate::models::PtySessionInfo;

struct SessionEntry {
    handle: Arc<SessionHandle>,
    pane_id: String,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, SessionEntry>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_session(
        &self,
        pane_id: String,
        shell_path: Option<String>,
        cwd: String,
        rows: u16,
        cols: u16,
        output_channel: Channel<String>,
        exit_channel: Channel<bool>,
    ) -> Result<PtySessionInfo, String> {
        let id = Uuid::new_v4().to_string();
        let handle =
            SessionHandle::spawn(shell_path, cwd, rows, cols, output_channel, exit_channel)?;
        let pid = handle.pid;
        self.sessions.lock().insert(
            id.clone(),
            SessionEntry { handle: Arc::new(handle), pane_id: pane_id.clone() },
        );
        Ok(PtySessionInfo { id, pane_id, pid })
    }

    pub fn write_to_session(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        self.with_session(session_id, |handle| handle.write(data))
    }

    pub fn resize_session(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        self.with_session(session_id, |handle| handle.resize(rows, cols))
    }

    pub fn kill_session(&self, session_id: &str) -> Result<(), String> {
        let entry = self
            .sessions
            .lock()
            .remove(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        entry.handle.kill();
        Ok(())
    }

    /// Return the IDs of all live sessions.
    pub fn list_sessions(&self) -> Vec<PtySessionInfo> {
        self.sessions
            .lock()
            .iter()
            .filter(|(_, e)| e.handle.is_alive())
            .map(|(id, e)| PtySessionInfo {
                id: id.clone(),
                pane_id: e.pane_id.clone(),
                pid: e.handle.pid,
            })
            .collect()
    }

    /// Reconnect an existing session with new IPC channels.
    pub fn reconnect_session(
        &self,
        session_id: &str,
        output_channel: Channel<String>,
        exit_channel: Channel<bool>,
        skip_replay: bool,
    ) -> Result<(), String> {
        self.with_session(session_id, |handle| {
            handle.reconnect(output_channel, exit_channel, skip_replay)
        })
    }

    /// Drain all sessions from the registry without killing them.
    /// The caller is responsible for calling `kill()` on each handle.
    pub fn drain_all(&self) -> Vec<Arc<SessionHandle>> {
        self.sessions
            .lock()
            .drain()
            .map(|(_, e)| e.handle)
            .collect()
    }

    /// Look up a session by ID and invoke `f` on it.  The map lock is released
    /// before `f` runs so that concurrent writes/resizes on different sessions
    /// never contend on the global lock.
    fn with_session<F, R>(&self, session_id: &str, f: F) -> Result<R, String>
    where
        F: FnOnce(&SessionHandle) -> Result<R, String>,
    {
        let handle = self
            .sessions
            .lock()
            .get(session_id)
            .map(|e| e.handle.clone())
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        f(&handle)
    }
}
