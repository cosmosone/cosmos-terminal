use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use parking_lot::Mutex;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

use crate::models::SessionChildrenEvent;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const EVENT_NAME: &str = "session-children-changed";

struct MonitoredSession {
    shell_pid: u32,
    has_children: bool,
}

pub struct ProcessMonitor {
    sessions: Arc<Mutex<HashMap<String, MonitoredSession>>>,
    alive: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            alive: Arc::new(AtomicBool::new(true)),
            thread: Mutex::new(None),
        }
    }

    pub fn start(&self, app: AppHandle) {
        let sessions = self.sessions.clone();
        let alive = self.alive.clone();

        let handle = std::thread::spawn(move || {
            Self::monitor_loop(app, sessions, alive);
        });

        *self.thread.lock() = Some(handle);
    }

    pub fn register(&self, session_id: String, shell_pid: u32) {
        self.sessions.lock().insert(
            session_id,
            MonitoredSession {
                shell_pid,
                has_children: false,
            },
        );
    }

    pub fn unregister(&self, session_id: &str) {
        self.sessions.lock().remove(session_id);
    }

    pub fn stop(&self) {
        self.alive.store(false, Ordering::Release);
        if let Some(handle) = self.thread.lock().take() {
            let _ = handle.join();
        }
    }

    fn monitor_loop(
        app: AppHandle,
        sessions: Arc<Mutex<HashMap<String, MonitoredSession>>>,
        alive: Arc<AtomicBool>,
    ) {
        let mut sys = System::new();

        loop {
            if !alive.load(Ordering::Acquire) {
                break;
            }
            std::thread::sleep(POLL_INTERVAL);
            if !alive.load(Ordering::Acquire) {
                break;
            }

            // Snapshot shell PIDs under the lock, then release before the
            // expensive system-wide process enumeration to avoid blocking
            // register()/unregister() calls from IPC threads.
            let shell_pids: Vec<u32> = {
                let guard = sessions.lock();
                if guard.is_empty() {
                    continue;
                }
                guard.values().map(|m| m.shell_pid).collect()
            };

            sys.refresh_processes(ProcessesToUpdate::All, false);

            // Build set of shell PIDs that currently have children
            let mut pids_with_children = std::collections::HashSet::new();
            for process in sys.processes().values() {
                if let Some(parent) = process.parent() {
                    let ppid = parent.as_u32();
                    if shell_pids.contains(&ppid) {
                        pids_with_children.insert(ppid);
                    }
                }
            }

            // Re-acquire lock for state transition checks and event emission
            let mut guard = sessions.lock();
            for (session_id, monitored) in guard.iter_mut() {
                let has_children = pids_with_children.contains(&monitored.shell_pid);
                if has_children != monitored.has_children {
                    monitored.has_children = has_children;
                    let _ = app.emit(
                        EVENT_NAME,
                        SessionChildrenEvent {
                            session_id: session_id.clone(),
                            has_children,
                        },
                    );
                }
            }
        }
    }
}

impl Default for ProcessMonitor {
    fn default() -> Self {
        Self::new()
    }
}
