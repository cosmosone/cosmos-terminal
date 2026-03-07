use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::Instant;

/// Maximum number of live WebView2 instances.
const MAX_LIVE_WEBVIEWS: usize = 10;

struct WebviewHandle {
    label: String,
    last_accessed: Instant,
}

/// Manages the lifecycle of browser tab webviews.
///
/// Tracks which tab IDs have live native webview instances and enforces
/// a pool limit to keep memory usage bounded.
pub struct BrowserManager {
    tabs: Mutex<HashMap<String, WebviewHandle>>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self {
            tabs: Mutex::new(HashMap::new()),
        }
    }

    /// Register a live webview for the given tab.
    pub fn register(&self, tab_id: &str, label: &str) {
        let mut tabs = self.tabs.lock();
        tabs.insert(
            tab_id.to_string(),
            WebviewHandle {
                label: label.to_string(),
                last_accessed: Instant::now(),
            },
        );
    }

    /// Mark a tab as recently accessed (for LRU eviction).
    pub fn touch(&self, tab_id: &str) {
        let mut tabs = self.tabs.lock();
        if let Some(handle) = tabs.get_mut(tab_id) {
            handle.last_accessed = Instant::now();
        }
    }

    /// Get the webview label for a tab, if it has a live webview.
    pub fn get_label(&self, tab_id: &str) -> Option<String> {
        let tabs = self.tabs.lock();
        tabs.get(tab_id).map(|h| h.label.clone())
    }

    /// Check if a tab has a live webview.
    pub fn is_alive(&self, tab_id: &str) -> bool {
        self.tabs.lock().contains_key(tab_id)
    }

    /// Remove a tab's webview tracking entry. Returns the label if it existed.
    pub fn remove(&self, tab_id: &str) -> Option<String> {
        let mut tabs = self.tabs.lock();
        tabs.remove(tab_id).map(|h| h.label)
    }

    /// If the pool is at capacity, evict the least-recently-used tab
    /// (excluding `exclude_tab_id`). Returns the label of the evicted
    /// webview so the caller can close it.
    pub fn evict_if_needed(&self, exclude_tab_id: &str) -> Option<String> {
        let mut tabs = self.tabs.lock();
        if tabs.len() < MAX_LIVE_WEBVIEWS {
            return None;
        }

        let lru_id = tabs
            .iter()
            .filter(|(id, _)| id.as_str() != exclude_tab_id)
            .min_by_key(|(_, h)| h.last_accessed)
            .map(|(id, _)| id.clone());

        if let Some(id) = lru_id {
            return tabs.remove(&id).map(|h| h.label);
        }
        None
    }

    /// Remove all tracked webviews. Returns labels so they can be closed.
    pub fn remove_all(&self) -> Vec<String> {
        let mut tabs = self.tabs.lock();
        let labels: Vec<String> = tabs.values().map(|h| h.label.clone()).collect();
        tabs.clear();
        labels
    }
}
