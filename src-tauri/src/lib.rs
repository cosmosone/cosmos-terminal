mod commands;
mod models;
mod pty;
mod watcher;

use commands::fs_commands;
use commands::git_commands;
use commands::pty_commands;
use commands::system_commands::{self, SystemMonitor};
use commands::watcher_commands;
use pty::manager::SessionManager;
use tauri::Manager;
use watcher::FsWatcher;

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

    let session_manager = SessionManager::new();
    let system_monitor = SystemMonitor::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(session_manager)
        .manage(system_monitor)
        .invoke_handler(tauri::generate_handler![
            pty_commands::create_session,
            pty_commands::write_to_session,
            pty_commands::resize_session,
            pty_commands::kill_session,
            system_commands::get_system_stats,
            git_commands::git_is_repo,
            git_commands::git_status,
            git_commands::git_log,
            git_commands::git_diff,
            git_commands::git_stage_all,
            git_commands::git_commit,
            git_commands::git_push,
            fs_commands::list_directory,
            fs_commands::read_text_file,
            fs_commands::write_text_file,
            fs_commands::search_files,
            fs_commands::show_in_explorer,
            fs_commands::delete_path,
            watcher_commands::watch_directory,
            watcher_commands::unwatch_directory,
        ])
        .setup(|app| {
            let fs_watcher = FsWatcher::new(app.handle().clone());
            app.manage(fs_watcher);

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                setup_window(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let sm = window.state::<SessionManager>();
                sm.kill_all();
                let watcher = window.state::<FsWatcher>();
                watcher.unwatch();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Cosmos Terminal");
}
