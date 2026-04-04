mod browser;
mod commands;
mod frontend_watcher;
mod models;
mod pty;
mod security;
mod watcher;

use std::path::PathBuf;

use browser::manager::BrowserManager;
use commands::browser_commands;
use commands::fs_commands;
use commands::git_commands;
use commands::pty_commands;
use commands::system_commands::{self, SystemMonitor};
use commands::watcher_commands;
use frontend_watcher::FrontendWatcher;
use pty::manager::SessionManager;
use pty::process_monitor::ProcessMonitor;
use tauri::Manager;
use watcher::FsWatcher;

/// Returns the `frontend/` directory path next to the running executable.
fn frontend_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("frontend")))
}

/// Directory names excluded from file search and filesystem watching.
pub const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "target",
    ".vite",
    ".vite-temp",
    ".next",
    "build",
    "__pycache__",
    ".serena",
];

#[cfg(target_os = "windows")]
fn setup_window(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            dw_attribute: u32,
            pv_attribute: *const c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn LoadImageW(
            hinst: isize,
            name: *const u16,
            r#type: u32,
            cx: i32,
            cy: i32,
            fu_load: u32,
        ) -> isize;
        fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn GetModuleHandleW(module_name: *const u16) -> isize;
        fn GetSystemMetrics(index: i32) -> i32;
    }

    const DWMWA_CAPTION_COLOR: u32 = 35;
    const IMAGE_ICON: u32 = 1;
    const WM_SETICON: u32 = 0x0080;
    const ICON_SMALL: usize = 0;
    const ICON_BIG: usize = 1;
    const SM_CXSMICON: i32 = 49;
    const SM_CXICON: i32 = 11;

    if let Ok(hwnd) = window.hwnd() {
        let hwnd_val = hwnd.0 as isize;

        // ── Title-bar colour ──
        // Must match --bg-secondary in src/styles/theme.css
        // #272a3c in COLORREF (0x00BBGGRR) format
        let color: u32 = 0x003c2a27;
        unsafe {
            DwmSetWindowAttribute(
                hwnd_val,
                DWMWA_CAPTION_COLOR,
                &color as *const _ as *const c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }

        // ── High-resolution window icons ──
        // Tauri's codegen reads only the first (16×16) entry from the ICO
        // for the runtime window icon (WM_SETICON), causing a blurry taskbar
        // icon — especially visible when the app is pinned.
        // Fix: load the full multi-resolution icon from the EXE's embedded
        // resource at the DPI-correct sizes for both ICON_SMALL and ICON_BIG.
        unsafe {
            let hinstance = GetModuleHandleW(ptr::null());
            // tauri-build embeds the .ico at resource ID 32512 (IDI_APPLICATION)
            #[allow(clippy::manual_dangling_ptr)]
            let res_id = 32512_usize as *const u16;

            let sm = GetSystemMetrics(SM_CXSMICON); // 16 @ 100% DPI
            let lg = GetSystemMetrics(SM_CXICON); // 32 @ 100% DPI

            let icon_sm = LoadImageW(hinstance, res_id, IMAGE_ICON, sm, sm, 0);
            let icon_lg = LoadImageW(hinstance, res_id, IMAGE_ICON, lg, lg, 0);

            if icon_sm != 0 {
                SendMessageW(hwnd_val, WM_SETICON, ICON_SMALL, icon_sm);
            }
            if icon_lg != 0 {
                SendMessageW(hwnd_val, WM_SETICON, ICON_BIG, icon_lg);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Force Chromium/WebView2 to use LCD (subpixel / ClearType) text rendering
    // instead of grayscale antialiasing. This must be set before the WebView2
    // environment is created by Tauri.
    #[cfg(target_os = "windows")]
    {
        use std::env;
        let key = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
        let extra = env::var(key).unwrap_or_default();
        let flags = [
            "--enable-lcd-text",
            "--force-color-profile=srgb",
            "--use-angle=d3d11",
            "--disable-features=RendererCodeIntegrity",
        ]
        .join(" ");
        let combined = if extra.is_empty() {
            flags
        } else {
            format!("{extra} {flags}")
        };
        // SAFETY: called before any threads are spawned (Tauri builder hasn't
        // run yet), so mutating the environment is safe.  `set_var` is
        // deprecated-as-safe since Rust 1.83; wrapping in `unsafe` silences
        // the warning and documents the single-threaded precondition.
        unsafe { env::set_var(key, combined) };
    }

    // Clean up after a previous restart-with-update cycle.
    if let Ok(exe) = std::env::current_exe() {
        // Remove the renamed old exe
        let old = exe.with_extension("exe.old");
        let _ = std::fs::remove_file(&old);

        // Clear stale exePending from version.json so a manual restart
        // doesn't leave a phantom "Restart" badge on the next frontend update.
        if let Some(vj) = exe.parent().map(|p| p.join("frontend").join("version.json")) {
            if let Ok(bytes) = std::fs::read(&vj) {
                if let Ok(mut map) =
                    serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(&bytes)
                {
                    if map.remove("exePending").is_some() {
                        if let Ok(json) = serde_json::to_string(&map) {
                            let _ = std::fs::write(&vj, json);
                        }
                    }
                }
            }
        }
    }

    let session_manager = SessionManager::new();
    let system_monitor = SystemMonitor::new();
    let browser_manager = BrowserManager::new();
    let process_monitor = ProcessMonitor::new();

    // Resolve and canonicalise the external frontend asset directory once at
    // startup so the protocol handler avoids per-request syscalls.
    let fe_dir = frontend_dir();
    let fe_canonical_root = fe_dir
        .as_ref()
        .filter(|d| d.is_dir())
        .and_then(|d| dunce::canonicalize(d).ok());

    fn text_response(
        status: tauri::http::StatusCode,
        body: &str,
    ) -> tauri::http::Response<Vec<u8>> {
        tauri::http::Response::builder()
            .status(status)
            .header(tauri::http::header::CONTENT_TYPE, "text/plain")
            .body(body.as_bytes().to_vec())
            .unwrap()
    }

    tauri::Builder::default()
        .register_uri_scheme_protocol("cosmos", move |_ctx, request| {
            let fe_root = match &fe_canonical_root {
                Some(root) => root,
                None => return text_response(tauri::http::StatusCode::NOT_FOUND, "frontend directory not found"),
            };

            let uri_path = request.uri().path();
            let relative = uri_path.trim_start_matches('/');
            let relative = if relative.is_empty() {
                "index.html"
            } else {
                relative
            };

            if relative.contains("..") {
                return text_response(tauri::http::StatusCode::FORBIDDEN, "path traversal rejected");
            }

            let file_path = fe_root.join(relative);
            let canonical = match dunce::canonicalize(&file_path) {
                Ok(p) => p,
                Err(_) => return text_response(tauri::http::StatusCode::NOT_FOUND, "not found"),
            };

            if !canonical.starts_with(fe_root) {
                return text_response(tauri::http::StatusCode::FORBIDDEN, "path traversal rejected");
            }

            match std::fs::read(&canonical) {
                Ok(bytes) => {
                    let mime = mime_guess::from_path(&canonical)
                        .first_or_octet_stream()
                        .to_string();
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::OK)
                        .header(tauri::http::header::CONTENT_TYPE, &mime)
                        .header(tauri::http::header::CACHE_CONTROL, "no-cache")
                        .body(bytes)
                        .unwrap()
                }
                Err(_) => text_response(tauri::http::StatusCode::NOT_FOUND, "not found"),
            }
        })
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(session_manager)
        .manage(system_monitor)
        .manage(browser_manager)
        .manage(process_monitor)
        .invoke_handler(tauri::generate_handler![
            pty_commands::create_session,
            pty_commands::write_to_session,
            pty_commands::resize_session,
            pty_commands::kill_session,
            pty_commands::list_sessions,
            pty_commands::reconnect_session,
            system_commands::get_system_stats,
            system_commands::restart_with_update,
            git_commands::git_project_status,
            git_commands::git_status,
            git_commands::git_log,
            git_commands::git_diff,
            git_commands::git_stage_all,
            git_commands::git_commit,
            git_commands::git_push,
            git_commands::git_remove_lock_file,
            fs_commands::list_directory,
            fs_commands::read_text_file,
            fs_commands::write_text_file,
            fs_commands::write_text_file_if_unmodified,
            fs_commands::search_files,
            fs_commands::show_in_explorer,
            fs_commands::delete_path,
            fs_commands::get_file_mtime,
            watcher_commands::watch_directory,
            watcher_commands::unwatch_directory,
            browser_commands::create_browser_webview,
            browser_commands::show_browser_webview,
            browser_commands::hide_browser_webview,
            browser_commands::navigate_browser,
            browser_commands::resize_browser_webview,
            browser_commands::close_browser_webview,
            browser_commands::reload_browser,
            browser_commands::browser_go_back,
            browser_commands::browser_go_forward,
            browser_commands::browser_webview_is_alive,
            browser_commands::set_browser_zoom,
            browser_commands::capture_browser_screenshot,
            browser_commands::set_browser_pool_size,
        ])
        .setup(move |app| {
            let fs_watcher = FsWatcher::new(app.handle().clone());
            app.manage(fs_watcher);

            let pm = app.state::<ProcessMonitor>();
            pm.start(app.handle().clone());

            let fw = FrontendWatcher::new();
            if let Some(ref dir) = fe_dir {
                match fw.watch(app.handle(), dir) {
                    Ok(()) => eprintln!("[FrontendWatcher] Watching {}", dir.display()),
                    Err(e) => eprintln!("[FrontendWatcher] Failed to start: {e}"),
                }
            }
            app.manage(fw);

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                setup_window(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // kill() blocks on thread::join per session — drain first
                // (cheap lock + remove), then join on a background thread to
                // avoid stalling the window-destroyed handler.
                let sm = window.state::<SessionManager>();
                let handles = sm.drain_all();
                std::thread::spawn(move || {
                    for handle in handles {
                        handle.kill();
                    }
                });

                let pm = window.state::<ProcessMonitor>();
                pm.stop();
                let watcher = window.state::<FsWatcher>();
                watcher.unwatch();
                let fw = window.state::<FrontendWatcher>();
                fw.stop();
                let bm = window.state::<BrowserManager>();
                let app = window.app_handle().clone();
                for label in bm.remove_all() {
                    if let Some(wv) = app.get_webview(&label) {
                        let _ = wv.close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Cosmos Terminal");
}
