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
use crate::security::path_guard::canonicalize_existing_dir;

/// Shared state for output channel and buffer, allowing reconnection.
struct SharedOutput {
    channel: Mutex<Option<Channel<String>>>,
    exit_channel: Mutex<Option<Channel<bool>>>,
    /// Ring buffer of recent raw output for replay on reconnect.
    buffer: Mutex<Vec<u8>>,
    /// Whether the child process has exited while disconnected.
    exited_while_disconnected: AtomicBool,
}

impl SharedOutput {
    fn new(channel: Channel<String>, exit_channel: Channel<bool>) -> Self {
        Self {
            channel: Mutex::new(Some(channel)),
            exit_channel: Mutex::new(Some(exit_channel)),
            buffer: Mutex::new(Vec::new()),
            exited_while_disconnected: AtomicBool::new(false),
        }
    }
}

/// Maximum buffer size for replay (1 MB).
const REPLAY_BUFFER_MAX: usize = 1024 * 1024;

pub struct SessionHandle {
    master_write: Mutex<Option<Box<dyn Write + Send>>>,
    master_pty: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    alive: Arc<AtomicBool>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    output_thread: Mutex<Option<JoinHandle<()>>>,
    exit_thread: Mutex<Option<JoinHandle<()>>>,
    shared: Arc<SharedOutput>,
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
        // Canonicalize CWD at IPC boundary before spawning a shell process.
        let cwd_path = canonicalize_existing_dir(&cwd)?;

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
        cmd.cwd(&cwd_path);

        #[cfg(target_os = "windows")]
        let shell_lower = shell.to_lowercase();
        #[cfg(target_os = "windows")]
        let is_any_powershell =
            shell_lower.contains("powershell") || shell_lower.contains("pwsh");
        // pwsh (7+) does NOT emit OSC 133 natively — oh-my-posh or manual
        // profile config provides it. We only inject for powershell.exe (5.1)
        // because wrapping the prompt on pwsh conflicts with oh-my-posh / PSReadLine.
        #[cfg(target_os = "windows")]
        let is_legacy_powershell =
            shell_lower.contains("powershell") && !shell_lower.contains("pwsh");

        // PowerShell (5.1 or 7+): suppress logo
        #[cfg(target_os = "windows")]
        if is_any_powershell {
            cmd.arg("-NoLogo");
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

        let mut master_write = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take master writer: {}", e))?;

        // Inject OSC 133 shell integration for PowerShell 5.1 only.
        // pwsh users get OSC 133 from oh-my-posh or manual profile config;
        // injecting our wrapper there conflicts with PSReadLine.
        #[cfg(target_os = "windows")]
        if is_legacy_powershell {
            let script = concat!(
                "if(-not $__cosmos_osc){$__cosmos_osc=1;",
                "$__cosmos_p=$function:prompt;",
                "function prompt{$e=[char]27;",
                "\"$e]133;D`a$e]133;A`a\"+(& $__cosmos_p)+\"$e]133;B`a\"",
                "}}\r\ncls\r\n",
            );
            let _ = master_write.write_all(script.as_bytes());
        }

        let alive = Arc::new(AtomicBool::new(true));
        let shared = Arc::new(SharedOutput::new(output_channel, exit_channel));
        let (output_tx, output_rx) = mpsc::channel::<Vec<u8>>();
        let alive_for_reader = alive.clone();

        // Thread 1: Read PTY output
        let reader_handle = std::thread::spawn(move || {
            Self::reader_loop(master_read, output_tx, alive_for_reader);
        });

        // Thread 2: Batch output chunks before crossing the Tauri IPC boundary.
        let shared_for_output = shared.clone();
        let output_handle = std::thread::spawn(move || {
            Self::output_loop(output_rx, shared_for_output);
        });

        // Thread 3: Wait for child process to exit, then notify frontend
        let alive_for_exit = alive.clone();
        let shared_for_exit = shared.clone();
        let exit_handle = std::thread::spawn(move || {
            let mut child = child;
            const POLL_INTERVAL: Duration = Duration::from_millis(100);

            // Wait for the child to exit naturally or the PTY to close.
            while alive_for_exit.load(Ordering::Acquire) {
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

            alive_for_exit.store(false, Ordering::Release);
            let guard = shared_for_exit.exit_channel.lock();
            if let Some(ch) = guard.as_ref() {
                let _ = ch.send(true);
            } else {
                shared_for_exit
                    .exited_while_disconnected
                    .store(true, Ordering::Release);
            }
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
            shared,
            pid,
        })
    }

    /// Replace the IPC channels for this session (frontend reconnection).
    /// Replays buffered output through the new channel so the terminal can
    /// restore its display, then continues streaming live output.
    pub fn reconnect(
        &self,
        new_output: Channel<String>,
        new_exit: Channel<bool>,
    ) -> Result<(), String> {
        // Replay buffered output
        let buffer = self.shared.buffer.lock().clone();
        if !buffer.is_empty() {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
            new_output
                .send(encoded)
                .map_err(|e| format!("Failed to replay buffer: {e}"))?;
        }

        // Swap in new channels
        *self.shared.channel.lock() = Some(new_output);
        *self.shared.exit_channel.lock() = Some(new_exit);

        // If the process exited while disconnected, notify now
        if self
            .shared
            .exited_while_disconnected
            .swap(false, Ordering::AcqRel)
        {
            let guard = self.shared.exit_channel.lock();
            if let Some(ch) = guard.as_ref() {
                let _ = ch.send(true);
            }
        }

        Ok(())
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
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
        alive.store(false, Ordering::Release);
    }

    fn output_loop(output_rx: mpsc::Receiver<Vec<u8>>, shared: Arc<SharedOutput>) {
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

            // Append to ring buffer (capped at REPLAY_BUFFER_MAX)
            {
                let mut buf = shared.buffer.lock();
                buf.extend_from_slice(&batch);
                if buf.len() > REPLAY_BUFFER_MAX {
                    let excess = buf.len() - REPLAY_BUFFER_MAX;
                    buf.drain(..excess);
                }
            }

            // Try to send via IPC — if channel is gone, just continue buffering
            let guard = shared.channel.lock();
            if let Some(ch) = guard.as_ref() {
                let encoded = base64::engine::general_purpose::STANDARD.encode(&batch);
                if ch.send(encoded).is_err() {
                    drop(guard);
                    shared.channel.lock().take();
                }
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
        self.alive.store(false, Ordering::Release);

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
