use crate::browser::manager::BrowserManager;
use crate::models::{BrowserNavEvent, BrowserTitleEvent, BrowserZoomKeyEvent};
use base64::Engine;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview};

/// Event name for browser navigation events (must match TypeScript `BROWSER_NAVIGATED_EVENT`).
const BROWSER_NAVIGATED_EVENT: &str = "browser-navigated";

/// Event name for page title updates (must match TypeScript `BROWSER_TITLE_CHANGED_EVENT`).
const BROWSER_TITLE_CHANGED_EVENT: &str = "browser-title-changed";

/// Event name for zoom key interception (must match TypeScript `BROWSER_ZOOM_KEY_EVENT`).
const BROWSER_ZOOM_KEY_EVENT: &str = "browser-zoom-key";

/// Validate a URL string: must be http or https.
fn validate_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported URL scheme: {scheme}")),
    }
}

/// Validate that a tab ID is a well-formed UUID (same format as session IDs).
fn validate_tab_id(tab_id: &str) -> Result<(), String> {
    const UUID_LEN: usize = 36;
    const HYPHEN_POSITIONS: [usize; 4] = [8, 13, 18, 23];
    let bytes = tab_id.as_bytes();
    if bytes.len() != UUID_LEN {
        return Err("Invalid tab id".to_string());
    }
    for (index, b) in bytes.iter().enumerate() {
        if HYPHEN_POSITIONS.contains(&index) {
            if *b != b'-' {
                return Err("Invalid tab id".to_string());
            }
            continue;
        }
        if !b.is_ascii_hexdigit() {
            return Err("Invalid tab id".to_string());
        }
    }
    Ok(())
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
    validate_tab_id(&tab_id)?;
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

    let webview = tauri::webview::WebviewBuilder::new(
        &label,
        tauri::WebviewUrl::External(parsed),
    )
    // Match the app's dark background (#0f0f14) to prevent white flash during show/hide transitions
    .background_color(tauri::webview::Color(15, 15, 20, 255));

    window
        .add_child(
            webview,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Failed to create browser webview: {e}"))?;

    manager.register(&tab_id, &label);

    // Register WebView2 event handlers: zoom key interception and navigation events.
    // Navigation events (NavigationStarting/Completed) are registered directly via
    // the COM API because Tauri's on_page_load callback does not reliably fire for
    // link-initiated navigations in child webviews created with add_child.
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2,
            ICoreWebView2AcceleratorKeyPressedEventArgs,
            ICoreWebView2AcceleratorKeyPressedEventHandler,
            ICoreWebView2AcceleratorKeyPressedEventHandler_Impl,
            ICoreWebView2Controller,
            ICoreWebView2NavigationCompletedEventArgs,
            ICoreWebView2NavigationCompletedEventHandler,
            ICoreWebView2NavigationCompletedEventHandler_Impl,
            ICoreWebView2NavigationStartingEventArgs,
            ICoreWebView2NavigationStartingEventHandler,
            ICoreWebView2NavigationStartingEventHandler_Impl,
            COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        };
        use windows::core::{implement, PWSTR};
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL};

        /// Read a COM-allocated `PWSTR` into an owned `String` and free the buffer.
        unsafe fn pwstr_to_owned(ptr: PWSTR) -> String {
            let s = ptr.to_string().unwrap_or_default();
            if !ptr.is_null() {
                CoTaskMemFree(Some(ptr.0 as *const _));
            }
            s
        }

        #[implement(ICoreWebView2AcceleratorKeyPressedEventHandler)]
        struct ZoomKeyHandler {
            app: AppHandle,
            tab_id: String,
        }

        impl ICoreWebView2AcceleratorKeyPressedEventHandler_Impl for ZoomKeyHandler_Impl {
            fn Invoke(
                &self,
                _sender: windows_core::Ref<'_, ICoreWebView2Controller>,
                args: windows_core::Ref<'_, ICoreWebView2AcceleratorKeyPressedEventArgs>,
            ) -> windows::core::Result<()> {
                let Some(args) = args.clone() else { return Ok(()); };
                unsafe {
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                    args.KeyEventKind(&mut kind)?;
                    if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                        return Ok(());
                    }

                    let mut vk = 0u32;
                    args.VirtualKey(&mut vk)?;
                    let ctrl = GetKeyState(VK_CONTROL.0 as i32) < 0;
                    if !ctrl {
                        return Ok(());
                    }

                    const VK_OEM_PLUS: u32 = 0xBB;
                    const VK_ADD: u32 = 0x6B;
                    const VK_OEM_MINUS: u32 = 0xBD;
                    const VK_SUBTRACT: u32 = 0x6D;
                    const VK_0: u32 = 0x30;

                    let action = match vk {
                        VK_OEM_PLUS | VK_ADD => Some("zoom-in"),
                        VK_OEM_MINUS | VK_SUBTRACT => Some("zoom-out"),
                        VK_0 => Some("zoom-reset"),
                        _ => None,
                    };

                    if let Some(action) = action {
                        let _ = args.SetHandled(true);
                        let _ = self.app.emit_to(
                            EventTarget::labeled("main"),
                            BROWSER_ZOOM_KEY_EVENT,
                            BrowserZoomKeyEvent {
                                tab_id: self.tab_id.clone(),
                                action: action.to_string(),
                            },
                        );
                    }
                }
                Ok(())
            }
        }

        #[implement(ICoreWebView2NavigationStartingEventHandler)]
        struct NavStartHandler {
            app: AppHandle,
            tab_id: String,
        }

        impl ICoreWebView2NavigationStartingEventHandler_Impl for NavStartHandler_Impl {
            fn Invoke(
                &self,
                _sender: windows_core::Ref<'_, ICoreWebView2>,
                args: windows_core::Ref<'_, ICoreWebView2NavigationStartingEventArgs>,
            ) -> windows::core::Result<()> {
                let Some(args) = args.clone() else { return Ok(()); };
                unsafe {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    let url = pwstr_to_owned(uri);
                    let _ = self.app.emit_to(
                        EventTarget::labeled("main"),
                        BROWSER_NAVIGATED_EVENT,
                        BrowserNavEvent {
                            tab_id: self.tab_id.clone(),
                            url,
                            loading: true,
                        },
                    );
                }
                Ok(())
            }
        }

        #[implement(ICoreWebView2NavigationCompletedEventHandler)]
        struct NavCompleteHandler {
            app: AppHandle,
            tab_id: String,
        }

        impl ICoreWebView2NavigationCompletedEventHandler_Impl for NavCompleteHandler_Impl {
            fn Invoke(
                &self,
                sender: windows_core::Ref<'_, ICoreWebView2>,
                _args: windows_core::Ref<'_, ICoreWebView2NavigationCompletedEventArgs>,
            ) -> windows::core::Result<()> {
                let Some(core) = sender.clone() else { return Ok(()); };
                unsafe {
                    // Read the final URL after navigation (accounts for redirects)
                    let mut source = PWSTR::null();
                    core.Source(&mut source)?;
                    let url = pwstr_to_owned(source);
                    let _ = self.app.emit_to(
                        EventTarget::labeled("main"),
                        BROWSER_NAVIGATED_EVENT,
                        BrowserNavEvent {
                            tab_id: self.tab_id.clone(),
                            url,
                            loading: false,
                        },
                    );

                    // Extract page title
                    let mut title_pwstr = PWSTR::null();
                    if core.DocumentTitle(&mut title_pwstr).is_ok() {
                        let title = pwstr_to_owned(title_pwstr);
                        if !title.is_empty() {
                            let _ = self.app.emit_to(
                                EventTarget::labeled("main"),
                                BROWSER_TITLE_CHANGED_EVENT,
                                BrowserTitleEvent {
                                    tab_id: self.tab_id.clone(),
                                    title,
                                },
                            );
                        }
                    }
                }
                Ok(())
            }
        }

        if let Some(wv) = app.get_webview(&label) {
            let app_wv = app.clone();
            let tab_id_wv = tab_id;
            let _ = wv.with_webview(move |platform_wv| {
                unsafe {
                    let controller = platform_wv.controller();

                    // Zoom key interception
                    let handler: ICoreWebView2AcceleratorKeyPressedEventHandler = ZoomKeyHandler {
                        app: app_wv.clone(),
                        tab_id: tab_id_wv.clone(),
                    }
                    .into();
                    let mut token = std::mem::zeroed();
                    let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);

                    // Navigation event handlers for URL bar and loading state
                    let Ok(core) = controller.CoreWebView2() else { return; };

                    let nav_start: ICoreWebView2NavigationStartingEventHandler = NavStartHandler {
                        app: app_wv.clone(),
                        tab_id: tab_id_wv.clone(),
                    }
                    .into();
                    let mut token = std::mem::zeroed();
                    let _ = core.add_NavigationStarting(&nav_start, &mut token);

                    let nav_complete: ICoreWebView2NavigationCompletedEventHandler =
                        NavCompleteHandler {
                            app: app_wv,
                            tab_id: tab_id_wv,
                        }
                        .into();
                    let mut token = std::mem::zeroed();
                    let _ = core.add_NavigationCompleted(&nav_complete, &mut token);
                }
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn show_browser_webview(app: AppHandle, tab_id: String) -> Result<(), String> {
    validate_tab_id(&tab_id)?;
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;
    wv.show().map_err(|e| e.to_string())?;
    manager.touch(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn hide_browser_webview(app: AppHandle, tab_id: String) -> Result<(), String> {
    validate_tab_id(&tab_id)?;
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
    validate_tab_id(&tab_id)?;
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
    validate_tab_id(&tab_id)?;
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
    validate_tab_id(&tab_id)?;
    let manager = app.state::<BrowserManager>();
    if let Some(label) = manager.remove(&tab_id) {
        if let Some(wv) = app.get_webview(&label) {
            wv.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Validate a tab, resolve its webview, and evaluate a JS snippet.
fn eval_in_webview(app: &AppHandle, tab_id: &str, script: &str) -> Result<(), String> {
    validate_tab_id(tab_id)?;
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(app, &manager, tab_id)?;
    wv.eval(script).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reload_browser(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval_in_webview(&app, &tab_id, "location.reload()")
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval_in_webview(&app, &tab_id, "history.back()")
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval_in_webview(&app, &tab_id, "history.forward()")
}

#[tauri::command]
pub async fn browser_webview_is_alive(app: AppHandle, tab_id: String) -> Result<bool, String> {
    validate_tab_id(&tab_id)?;
    let manager = app.state::<BrowserManager>();
    Ok(manager.is_alive(&tab_id))
}

#[tauri::command]
pub fn set_browser_pool_size(app: AppHandle, size: usize) {
    const MAX_POOL_SIZE: usize = 50;
    let manager = app.state::<BrowserManager>();
    manager.set_pool_size(size.clamp(1, MAX_POOL_SIZE));
}

/// Set the zoom factor for a browser webview (1.0 = 100%).
/// Clamps to the WebView2-supported range of 0.25–5.0.
/// Range must match ZOOM_MIN/ZOOM_MAX in browser-tab-content.ts.
#[tauri::command]
pub async fn set_browser_zoom(
    app: AppHandle,
    tab_id: String,
    zoom_factor: f64,
) -> Result<(), String> {
    validate_tab_id(&tab_id)?;
    let clamped = zoom_factor.clamp(0.25, 5.0);
    let manager = app.state::<BrowserManager>();
    let wv = resolve_webview(&app, &manager, &tab_id)?;

    wv.with_webview(move |platform_wv| {
        unsafe {
            let controller = platform_wv.controller();
            let _ = controller.SetZoomFactor(clamped);
        }
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Capture the browser webview content as a base64-encoded JPEG screenshot.
/// Uses WebView2's CapturePreview API via `with_webview` (requires `unstable` feature).
#[tauri::command]
pub async fn capture_browser_screenshot(
    app: AppHandle,
    tab_id: String,
) -> Result<String, String> {
    validate_tab_id(&tab_id)?;
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
    const MAX_SCREENSHOT_BYTES: usize = 50 * 1024 * 1024; // 50 MB
    if size > MAX_SCREENSHOT_BYTES {
        return Err(format!("Screenshot too large: {size} bytes"));
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
