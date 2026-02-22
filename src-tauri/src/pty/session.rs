use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::Engine as _;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;

use super::platform::default_shell;

pub struct SessionHandle {
    master_write: Mutex<Option<Box<dyn Write + Send>>>,
    master_pty: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    alive: Arc<AtomicBool>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    output_thread: Mutex<Option<JoinHandle<()>>>,
    exit_thread: Mutex<Option<JoinHandle<()>>>,
    pub pid: u32,
}

const IPC_BATCH_WINDOW: Duration = Duration::from_millis(8);
const IPC_BATCH_MAX_BYTES: usize = 128 * 1024;

impl SessionHandle {
    pub fn spawn(
        shell_path: Option<String>,
        cwd: String,
        rows: u16,
        cols: u16,
        output_channel: Channel<String>,
        exit_channel: Channel<bool>,
    ) -> Result<Self, String> {
        // Validate CWD exists and is a directory
        let cwd_path = std::path::Path::new(&cwd);
        if !cwd_path.is_dir() {
            return Err(format!("Working directory does not exist: {}", cwd));
        }

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
        let (output_tx, output_rx) = mpsc::channel::<Vec<u8>>();
        let alive_for_reader = alive.clone();

        // Thread 1: Read PTY output
        let reader_handle = std::thread::spawn(move || {
            Self::reader_loop(master_read, output_tx, alive_for_reader);
        });

        // Thread 2: Batch output chunks before crossing the Tauri IPC boundary.
        let output_handle = std::thread::spawn(move || {
            Self::output_loop(output_rx, output_channel);
        });

        // Thread 3: Wait for child process to exit, then notify frontend
        let alive_for_exit = alive.clone();
        let exit_handle = std::thread::spawn(move || {
            let mut child = child;
            const POLL_INTERVAL: Duration = Duration::from_millis(100);

            // Wait for the child to exit naturally or the PTY to close.
            while alive_for_exit.load(Ordering::Relaxed) {
                match child.try_wait() {
                    Ok(Some(_)) | Err(_) => break,
                    Ok(None) => std::thread::sleep(POLL_INTERVAL),
                }
            }

            // If the PTY was closed but the child hasn't exited yet, give it
            // a grace period before force-killing.
            const KILL_TIMEOUT: Duration = Duration::from_secs(5);
            let deadline = Instant::now() + KILL_TIMEOUT;
            loop {
                match child.try_wait() {
                    Ok(Some(_)) | Err(_) => break,
                    Ok(None) if Instant::now() >= deadline => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    Ok(None) => std::thread::sleep(POLL_INTERVAL),
                }
            }

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
            output_thread: Mutex::new(Some(output_handle)),
            exit_thread: Mutex::new(Some(exit_handle)),
            pid,
        })
    }

    fn reader_loop(
        mut reader: Box<dyn Read + Send>,
        output_tx: mpsc::Sender<Vec<u8>>,
        alive: Arc<AtomicBool>,
    ) {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    if output_tx.send(buf[..n].to_vec()).is_err() {
                        break; // Output thread closed
                    }
                }
                Err(_) => break,
            }
        }
        alive.store(false, Ordering::Relaxed);
    }

    fn output_loop(output_rx: mpsc::Receiver<Vec<u8>>, channel: Channel<String>) {
        while let Ok(first_chunk) = output_rx.recv() {
            let mut batch = first_chunk;

            loop {
                if batch.len() >= IPC_BATCH_MAX_BYTES {
                    break;
                }
                match output_rx.recv_timeout(IPC_BATCH_WINDOW) {
                    Ok(chunk) => batch.extend_from_slice(&chunk),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }

            let encoded = base64::engine::general_purpose::STANDARD.encode(&batch);
            if channel.send(encoded).is_err() {
                break;
            }
        }
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut guard = self.master_write.lock();
        let writer = guard.as_mut().ok_or("Session closed")?;
        // PTY masters are unbuffered OS handles; explicit flush adds extra
        // syscalls without improving delivery guarantees.
        writer
            .write_all(data)
            .map_err(|e| format!("Write error: {}", e))?;
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

        // Wait for spawned threads to finish
        if let Some(handle) = self.reader_thread.lock().take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.output_thread.lock().take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.exit_thread.lock().take() {
            let _ = handle.join();
        }
    }
}
