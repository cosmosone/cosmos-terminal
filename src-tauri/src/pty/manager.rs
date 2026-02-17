use std::collections::HashMap;

use parking_lot::Mutex;
use tauri::ipc::Channel;
use uuid::Uuid;

use super::session::SessionHandle;
use crate::models::PtySessionInfo;

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, SessionHandle>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_session(
        &self,
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
        self.sessions.lock().insert(id.clone(), handle);
        Ok(PtySessionInfo { id, pid })
    }

    pub fn write_to_session(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        self.with_session(session_id, |handle| handle.write(data))
    }

    pub fn resize_session(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        self.with_session(session_id, |handle| handle.resize(rows, cols))
    }

    pub fn kill_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let handle = sessions
            .remove(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        handle.kill();
        Ok(())
    }

    pub fn kill_all(&self) {
        // Drain into a Vec and release the lock before joining threads.
        // kill() blocks on thread::join; holding the Mutex during that
        // would prevent any in-flight Tauri command from completing.
        let handles: Vec<SessionHandle> = self.sessions.lock().drain().map(|(_, h)| h).collect();
        for handle in handles {
            handle.kill();
        }
    }

    fn with_session<F, R>(&self, session_id: &str, f: F) -> Result<R, String>
    where
        F: FnOnce(&SessionHandle) -> Result<R, String>,
    {
        let sessions = self.sessions.lock();
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        f(handle)
    }
}
