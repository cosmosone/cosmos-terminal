mod commands;
mod models;
mod pty;

use tauri::Manager;

use commands::git_commands;
use commands::pty_commands;
use commands::system_commands::{self, SystemMonitor};
use pty::manager::SessionManager;

#[cfg(target_os = "windows")]
fn set_title_bar_color(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            dw_attribute: u32,
            pv_attribute: *const c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    const DWMWA_CAPTION_COLOR: u32 = 35;

    if let Ok(hwnd) = window.hwnd() {
        // Must match --bg-secondary in src/styles/theme.css
        // #1e1f2e in COLORREF (0x00BBGGRR) format
        let color: u32 = 0x002e1f1e;
        unsafe {
            DwmSetWindowAttribute(
                hwnd.0 as isize,
                DWMWA_CAPTION_COLOR,
                &color as *const _ as *const c_void,
                std::mem::size_of::<u32>() as u32,
            );
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
        let flags = "\
            --enable-lcd-text \
            --force-color-profile=srgb \
            --use-angle=d3d11 \
            --disable-features=RendererCodeIntegrity";
        let combined = if extra.is_empty() {
            flags.to_string()
        } else {
            format!("{extra} {flags}")
        };
        env::set_var(key, combined);
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
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                set_title_bar_color(&window);

                // Set high-quality PNG icon for crisp taskbar display
                if let Ok(icon) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/taskbar.png"))
                {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let sm = window.state::<SessionManager>();
                sm.kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Cosmos Terminal");
}
