use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;

use super::platform::default_shell;

pub struct SessionHandle {
    master_write: Mutex<Option<Box<dyn Write + Send>>>,
    master_pty: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    alive: Arc<AtomicBool>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    pub pid: u32,
}

impl SessionHandle {
    pub fn spawn(
        shell_path: Option<String>,
        cwd: String,
        rows: u16,
        cols: u16,
        output_channel: Channel<Vec<u8>>,
        exit_channel: Channel<bool>,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let shell = shell_path.unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);

        // Windows PowerShell: suppress logo
        #[cfg(target_os = "windows")]
        {
            if shell.to_lowercase().contains("powershell") {
                cmd.arg("-NoLogo");
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let pid = child.process_id().unwrap_or(0);

        let master_read = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone master reader: {}", e))?;

        let master_write = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take master writer: {}", e))?;

        let alive = Arc::new(AtomicBool::new(true));
        let alive_for_reader = alive.clone();

        // Thread 1: Read PTY output
        let reader_handle = std::thread::spawn(move || {
            Self::reader_loop(master_read, output_channel, alive_for_reader);
        });

        // Thread 2: Wait for child process to exit, then notify frontend
        let alive_for_exit = alive.clone();
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
            alive_for_exit.store(false, Ordering::Relaxed);
            let _ = exit_channel.send(true);
        });

        // Drop slave side - we only need master
        drop(pair.slave);

        Ok(SessionHandle {
            master_write: Mutex::new(Some(master_write)),
            master_pty: Mutex::new(Some(pair.master)),
            alive,
            reader_thread: Mutex::new(Some(reader_handle)),
            pid,
        })
    }

    fn reader_loop(
        mut reader: Box<dyn Read + Send>,
        channel: Channel<Vec<u8>>,
        alive: Arc<AtomicBool>,
    ) {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    if channel.send(buf[..n].to_vec()).is_err() {
                        break; // Channel closed
                    }
                }
                Err(_) => break,
            }
        }
        alive.store(false, Ordering::Relaxed);
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut guard = self.master_write.lock();
        let writer = guard.as_mut().ok_or("Session closed")?;
        writer
            .write_all(data)
            .map_err(|e| format!("Write error: {}", e))?;
        writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let guard = self.master_pty.lock();
        let master = guard.as_ref().ok_or("Session closed")?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize error: {}", e))
    }

    pub fn kill(&self) {
        self.alive.store(false, Ordering::Relaxed);

        // Drop the master writer and PTY — closing the PTY fd causes the
        // child to receive EOF/SIGHUP and the reader thread to see EOF.
        self.master_write.lock().take();
        self.master_pty.lock().take();

        // Wait for reader thread to finish
        if let Some(handle) = self.reader_thread.lock().take() {
            let _ = handle.join();
        }
    }
}
