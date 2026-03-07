use crate::browser::manager::BrowserManager;
use crate::models::{BrowserNavEvent, BrowserTitleEvent};
use base64::Engine;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview};

/// Event name for browser navigation events (must match TypeScript `BROWSER_NAVIGATED_EVENT`).
const BROWSER_NAVIGATED_EVENT: &str = "browser-navigated";

/// Event name for page title updates (must match TypeScript `BROWSER_TITLE_CHANGED_EVENT`).
const BROWSER_TITLE_CHANGED_EVENT: &str = "browser-title-changed";

/// Validate a URL string: must be http or https.
fn validate_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported URL scheme: {scheme}")),
    }
}

/// Build a unique webview label from a tab ID.
fn webview_label(tab_id: &str) -> String {
    format!("browser-{tab_id}")
}

/// Resolve the live webview for a tab, or return an error.
fn resolve_webview(app: &AppHandle, manager: &BrowserManager, tab_id: &str) -> Result<Webview, String> {
    let label = manager
        .get_label(tab_id)
        .ok_or("No live webview for this tab")?;
    app.get_webview(&label).ok_or_else(|| "Webview not found".to_string())
}

#[tauri::command]
pub async fn create_browser_webview(
    app: AppHandle,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = validate_url(&url)?;
    let manager = app.state::<BrowserManager>();

    // If this tab already has a live webview, just show it (no re-navigate to preserve page state)
    if let Some(label) = manager.get_label(&tab_id) {
        if let Some(wv) = app.get_webview(&label) {
            wv.show().map_err(|e| e.to_string())?;
            let _ = wv.set_position(tauri::LogicalPosition::new(x, y));
            let _ = wv.set_size(tauri::LogicalSize::new(width, height));
            manager.touch(&tab_id);
            return Ok(());
        }
        // Webview handle gone (closed externally) — remove stale entry
        manager.remove(&tab_id);
    }

    // Evict LRU webview if pool is full
    if let Some(evicted_label) = manager.evict_if_needed(&tab_id) {
        if let Some(wv) = app.get_webview(&evicted_label) {
            let _ = wv.close();
        }
    }

    let label = webview_label(&tab_id);
    let window = app
        .get_window("main")
        .ok_or("Main window not found")?;

    let tab_id_load = tab_id.clone();
    let app_load = app.clone();

    let webview = tauri::webview::WebviewBuilder::new(
        &label,
        tauri::WebviewUrl::External(parsed),
    )
    // Match the app's dark background (#0f0f14) to prevent white flash during show/hide transitions
    .background_color(tauri::webview::Color(15, 15, 20, 255))
    .on_page_load(move |webview, payload| {
        let loading = matches!(payload.event(), PageLoadEvent::Started);
        let url = payload.url().to_string();
        let tab_id = tab_id_load.clone();

        let _ = app_load.emit_to(
            EventTarget::labeled("main"),
            BROWSER_NAVIGATED_EVENT,
            BrowserNavEvent {
                tab_id: tab_id.clone(),
                url,
                loading,
            },
        );

        // Extract page title from WebView2 after page load finishes
        if !loading {
            let app_title = app_load.clone();
            let tab_id_title = tab_id;
            let _ = webview.with_webview(move |platform_wv| {
                let title: Option<String> = (|| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
                    use windows::core::PWSTR;
                    use windows::Win32::System::Com::CoTaskMemFree;
                    let controller = platform_wv.controller();
                    let core: ICoreWebView2 = controller.CoreWebView2().ok()?;
                    let mut title_pwstr = PWSTR::null();
                    core.DocumentTitle(&mut title_pwstr).ok()?;
                    let s = title_pwstr.to_string().unwrap_or_default();
                    // Free the COM-allocated PWSTR buffer
                    if !title_pwstr.is_null() {
                        CoTaskMemFree(Some(title_pwstr.0 as *const _));
                    }
                    if s.is_empty() { return None; }
                    Some(s)
                })();
                if let Some(title) = title {
                    let _ = app_title.emit_to(
                        EventTarget::labeled("main"),
                        BROWSER_TITLE_CHANGED_EVENT,
                        BrowserTitleEvent { tab_id: tab_id_title, title },
                    );
                }
            });
        }
    });

    window
        .add_child(
            webview,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Failed to create browser webview: {e}"))?;

    manager.register(&tab_id, &label);

    Ok(())
}

#[tauri::command]
pub async fn show_browser_webview(app: AppHandle, tab_id: String) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;
    wv.show().map_err(|e| e.to_string())?;
    manager.touch(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn hide_browser_webview(app: AppHandle, tab_id: String) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    if let Some(label) = manager.get_label(&tab_id) {
        if let Some(wv) = app.get_webview(&label) {
            wv.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn navigate_browser(app: AppHandle, tab_id: String, url: String) -> Result<(), String> {
    let parsed = validate_url(&url)?;
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;
    wv.navigate(parsed).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn resize_browser_webview(
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;
    wv.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    wv.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn close_browser_webview(app: AppHandle, tab_id: String) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    if let Some(label) = manager.remove(&tab_id) {
        if let Some(wv) = app.get_webview(&label) {
            wv.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;
    wv.eval("history.back()").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;
    wv.eval("history.forward()").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_webview_is_alive(app: AppHandle, tab_id: String) -> Result<bool, String> {
    let manager = app.state::<BrowserManager>();
    Ok(manager.is_alive(&tab_id))
}

#[tauri::command]
pub fn set_browser_pool_size(app: AppHandle, size: usize) {
    let manager = app.state::<BrowserManager>();
    manager.set_pool_size(size.max(1));
}

/// Capture the browser webview content as a base64-encoded JPEG screenshot.
/// Uses WebView2's CapturePreview API via `with_webview` (requires `unstable` feature).
#[tauri::command]
pub async fn capture_browser_screenshot(
    app: AppHandle,
    tab_id: String,
) -> Result<String, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2CapturePreviewCompletedHandler,
        ICoreWebView2CapturePreviewCompletedHandler_Impl,
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
    };
    use windows::core::implement;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::IStream;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;

    #[implement(ICoreWebView2CapturePreviewCompletedHandler)]
    struct CaptureHandler {
        tx: std::sync::mpsc::Sender<Result<String, String>>,
        stream: IStream,
    }

    impl ICoreWebView2CapturePreviewCompletedHandler_Impl for CaptureHandler_Impl {
        fn Invoke(&self, errorcode: windows::core::HRESULT) -> windows::core::Result<()> {
            let result = if errorcode.is_ok() {
                unsafe { read_stream_to_base64(&self.stream) }
            } else {
                Err(format!("CapturePreview error: {errorcode:?}"))
            };
            let _ = self.tx.send(result);
            Ok(())
        }
    }

    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();

    wv.with_webview(move |platform_webview| {
        let tx_err = tx.clone();
        let result: Result<(), String> = (|| unsafe {
            let controller = platform_webview.controller();
            let core_wv2: ICoreWebView2 = controller
                .CoreWebView2()
                .map_err(|e| format!("CoreWebView2: {e}"))?;

            let stream: IStream = CreateStreamOnHGlobal(HGLOBAL::default(), true)
                .map_err(|e| format!("CreateStream: {e}"))?;

            let handler: ICoreWebView2CapturePreviewCompletedHandler = CaptureHandler {
                tx,
                stream: stream.clone(),
            }
            .into();

            core_wv2
                .CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
                    &stream,
                    &handler,
                )
                .map_err(|e| format!("CapturePreview: {e}"))
        })();

        if let Err(e) = result {
            let _ = tx_err.send(Err(e));
        }
    })
    .map_err(|e| e.to_string())?;

    // Block on a dedicated thread so we don't stall the async runtime
    tokio::task::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| format!("Screenshot timeout: {e}"))
    })
        .await
        .map_err(|e| format!("Task error: {e}"))?
        .and_then(|r| r)
}

/// Read all bytes from an IStream (after CapturePreview has written to it) and base64-encode.
unsafe fn read_stream_to_base64(
    stream: &windows::Win32::System::Com::IStream,
) -> Result<String, String> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    let mut stat = STATSTG::default();
    stream
        .Stat(&mut stat, STATFLAG_NONAME)
        .map_err(|e| format!("Stat: {e}"))?;
    let size = stat.cbSize as usize;
    if size == 0 {
        return Err("Empty capture".into());
    }

    stream
        .Seek(0, STREAM_SEEK_SET, None)
        .map_err(|e| format!("Seek: {e}"))?;

    // IStream::Read may return fewer bytes than requested; read in a loop.
    let mut buf = vec![0u8; size];
    let mut total_read = 0usize;
    while total_read < size {
        let mut bytes_read = 0u32;
        let chunk = (size - total_read).min(u32::MAX as usize) as u32;
        let hr = stream.Read(
            buf[total_read..].as_mut_ptr().cast(),
            chunk,
            Some(&mut bytes_read),
        );
        if hr.is_err() {
            return Err(format!("Read: {hr:?}"));
        }
        if bytes_read == 0 {
            break; // EOF
        }
        total_read += bytes_read as usize;
    }
    buf.truncate(total_read);

    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}
