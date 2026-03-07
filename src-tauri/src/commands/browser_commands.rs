use crate::browser::manager::BrowserManager;
use crate::models::BrowserNavEvent;
use tauri::{AppHandle, Emitter, Manager, Webview};

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

    let tab_id_nav = tab_id.clone();
    let app_nav = app.clone();

    let webview = tauri::webview::WebviewBuilder::new(
        &label,
        tauri::WebviewUrl::External(parsed),
    )
    .on_navigation(move |nav_url| {
        let _ = app_nav.emit(
            "browser-navigated",
            BrowserNavEvent {
                tab_id: tab_id_nav.clone(),
                url: nav_url.to_string(),
            },
        );
        true // allow all navigation
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
