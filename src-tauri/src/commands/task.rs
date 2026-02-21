/// Run blocking work on Tokio's dedicated blocking pool and normalize
/// join/cancellation errors to `String` for Tauri command results.
pub async fn spawn_blocking_result<F, T>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}
