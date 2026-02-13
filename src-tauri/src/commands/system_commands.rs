use parking_lot::Mutex;
use sysinfo::{ProcessesToUpdate, System};
use tauri::State;

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

#[tauri::command]
pub fn get_system_stats(monitor: State<'_, SystemMonitor>) -> SystemStats {
    let mut sys = monitor.sys.lock();

    // Only refresh our own process — skip system-wide refresh_memory/refresh_cpu_usage
    let (memory_mb, cpu_percent) = sysinfo::get_current_pid()
        .ok()
        .and_then(|pid| {
            sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
            sys.process(pid)
        })
        .map(|process| {
            (
                process.memory() as f64 / 1_048_576.0,
                process.cpu_usage() as f64,
            )
        })
        .unwrap_or((0.0, 0.0));

    SystemStats {
        memory_mb,
        cpu_percent,
    }
}
