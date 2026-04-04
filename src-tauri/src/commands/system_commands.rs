use std::collections::HashMap;

use parking_lot::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

use crate::commands::task::spawn_blocking_result;
use crate::models::SystemStats;

pub struct SystemMonitor {
    sys: Mutex<System>,
}

impl SystemMonitor {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        Self {
            sys: Mutex::new(sys),
        }
    }
}

impl Default for SystemMonitor {
    fn default() -> Self {
        Self::new()
    }
}

fn collect_descendants(sys: &System, root: Pid) -> Vec<Pid> {
    let mut children_map: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, proc_info) in sys.processes() {
        if let Some(parent) = proc_info.parent() {
            children_map.entry(parent).or_default().push(*pid);
        }
    }
    let mut result = vec![root];
    let mut queue = vec![root];
    while let Some(parent) = queue.pop() {
        if let Some(kids) = children_map.get(&parent) {
            for &child in kids {
                result.push(child);
                queue.push(child);
            }
        }
    }
    result
}

#[tauri::command]
pub async fn get_system_stats(app: AppHandle) -> Result<SystemStats, String> {
    spawn_blocking_result(move || {
        let monitor = app.state::<SystemMonitor>();
        let mut sys = monitor.sys.lock();

        let our_pid = sysinfo::get_current_pid().ok();

        // Refresh all processes so we can walk the full tree
        sys.refresh_processes(ProcessesToUpdate::All, true);

        let (memory_mb, cpu_percent) = our_pid
            .map(|pid| {
                let descendants = collect_descendants(&sys, pid);
                let mut total_mem: u64 = 0;
                let mut total_cpu: f32 = 0.0;
                for desc_pid in &descendants {
                    if let Some(p) = sys.process(*desc_pid) {
                        total_mem += p.memory();
                        total_cpu += p.cpu_usage();
                    }
                }
                (
                    total_mem as f64 / 1_048_576.0,
                    total_cpu as f64,
                )
            })
            .unwrap_or((0.0, 0.0));

        Ok(SystemStats {
            memory_mb,
            cpu_percent,
        })
    })
    .await
}

/// Swap the running exe with a new build and relaunch.
///
/// Windows blocks overwriting a running executable but allows renaming it.
/// We rename the current exe to `.exe.old`, copy the new build into place,
/// then spawn the new process and exit.
#[tauri::command]
pub async fn restart_with_update(app: AppHandle, exe_source: String) -> Result<(), String> {
    let source = crate::security::path_guard::canonicalize_existing_file(&exe_source)?;

    spawn_blocking_result(move || {
        let current = std::env::current_exe()
            .map_err(|e| format!("Failed to get current exe path: {e}"))?;

        let old = current.with_extension("exe.old");

        // Remove leftover .old from a previous update (may not exist)
        let _ = std::fs::remove_file(&old);

        // Rename the running exe — Windows allows rename but not overwrite
        std::fs::rename(&current, &old)
            .map_err(|e| format!("Failed to rename current exe: {e}"))?;

        // Copy new build into the original location
        std::fs::copy(&source, &current)
            .map_err(|e| {
                let _ = std::fs::rename(&old, &current);
                format!("Failed to copy new exe: {e}")
            })?;

        // Spawn the new exe
        std::process::Command::new(&current)
            .spawn()
            .map_err(|e| {
                let _ = std::fs::remove_file(&current);
                let _ = std::fs::rename(&old, &current);
                format!("Failed to launch new exe: {e}")
            })?;

        // Give the IPC response a moment to reach the frontend before exiting
        std::thread::sleep(std::time::Duration::from_millis(200));
        app.exit(0);

        Ok(())
    })
    .await
}
