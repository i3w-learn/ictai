//! Native side of the ICT App client. Kept thin: discovery, pinned HTTPS and a settings file.
//! All screens and app logic live in the React code.

mod discovery;
mod error;
mod http;
mod pinning;
mod storage;

use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::discovery::Found;
use crate::error::AppError;
use crate::http::{ApiRequest, ApiResponse, HttpClients, ProbeResult};

fn config_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_config_dir().map_err(|e| AppError::Storage(e.to_string()))
}

#[tauri::command]
async fn discover_servers(app: String, version: String, wait_ms: Option<u64>) -> Result<Vec<Found>, AppError> {
    discovery::discover(&app, &version, Duration::from_millis(wait_ms.unwrap_or(1500))).await
}

#[tauri::command]
async fn api_request(clients: State<'_, HttpClients>, request: ApiRequest) -> Result<ApiResponse, AppError> {
    http::send(&clients, request).await
}

#[tauri::command]
async fn probe_server(base_url: String) -> Result<ProbeResult, AppError> {
    http::probe(&base_url).await
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<Value>, AppError> {
    storage::load(config_dir(&app)?)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), AppError> {
    storage::save(config_dir(&app)?, &settings)
}

#[tauri::command]
fn clear_settings(app: AppHandle) -> Result<(), AppError> {
    storage::clear(config_dir(&app)?)
}

/// The Windows installer writes the role picked during setup next to the app.
/// Returns `None` when there is no such file (dev builds, Android).
#[tauri::command]
fn install_role() -> Option<String> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let role = std::fs::read_to_string(dir.join("install-role.txt")).ok()?;
    let role = role.trim();
    matches!(role, "console" | "student" | "board").then(|| role.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HttpClients::default())
        .invoke_handler(tauri::generate_handler![
            discover_servers,
            api_request,
            probe_server,
            load_settings,
            save_settings,
            clear_settings,
            install_role
        ])
        .run(tauri::generate_context!())
        .expect("error while running the ICT App");
}
