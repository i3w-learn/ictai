//! Native side of the ICT App client. Kept thin: discovery, pinned HTTPS, the relay socket and a settings file.
//! All screens and app logic live in the React code.

mod discovery;
mod error;
mod files;
mod http;
mod pinning;
mod relay;
mod storage;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;
use tauri::webview::{DownloadEvent, NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, State};

use crate::discovery::Found;
use crate::error::AppError;
use crate::files::{FileSource, Source};
use crate::http::{ApiRequest, ApiResponse, HttpClients, KeepAlive, ProbeResult};
use crate::relay::RelayState;

/// `ICT_PROFILE=student` gives a second copy of the app its own saved settings, so one Mac
/// can run a Server PC window and a Student PC window side by side (dev only; see `just student`).
fn config_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let dir = app.path().app_config_dir().map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(match std::env::var("ICT_PROFILE") {
        Ok(p) if !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => dir.join(format!("profile-{p}")),
        _ => dir,
    })
}

#[tauri::command]
async fn discover_servers(app: String, version: String, wait_ms: Option<u64>) -> Result<Vec<Found>, AppError> {
    discovery::discover(&app, &version, Duration::from_millis(wait_ms.unwrap_or(1500))).await
}

#[tauri::command]
async fn api_request(clients: State<'_, HttpClients>, request: ApiRequest) -> Result<ApiResponse, AppError> {
    http::send(&clients, request).await
}

/// Says `request` again every `every_ms`, on the app's own clock, until it is replaced, stopped
/// (called with no request) or the server says there is no point. See `KeepAlive`.
#[tauri::command]
fn keep_alive(app: AppHandle, state: State<'_, KeepAlive>, request: Option<ApiRequest>, every_ms: Option<u64>) {
    let mut running = state.0.lock().unwrap();
    if let Some(old) = running.take() {
        old.abort();
    }
    let Some(request) = request else { return };
    let every = Duration::from_millis(every_ms.unwrap_or(5000).max(1000));
    *running = Some(tauri::async_runtime::spawn(async move { http::repeat(&app.state::<HttpClients>(), request, every).await }));
}

#[tauri::command]
async fn probe_server(base_url: String) -> Result<ProbeResult, AppError> {
    http::probe(&base_url).await
}

#[tauri::command]
async fn relay_open(app: AppHandle, state: State<'_, RelayState>, base_url: String, cert_fp: String, token: String) -> Result<u64, AppError> {
    relay::open(app, &state, &base_url, &cert_fp, &token).await
}

#[tauri::command]
async fn relay_send(state: State<'_, RelayState>, text: String) -> Result<(), AppError> {
    relay::send(&state, text).await
}

#[tauri::command]
async fn relay_close(state: State<'_, RelayState>) -> Result<(), AppError> {
    relay::close(&state).await;
    Ok(())
}

/// The page says which server and which signed-in person library files are fetched for.
/// Called with nothing when that person signs out, so the next person cannot open files as them.
#[tauri::command]
fn set_file_source(state: State<'_, FileSource>, base_url: Option<String>, cert_fp: Option<String>, token: Option<String>) {
    *state.0.lock().unwrap() = match (base_url, cert_fp, token) {
        (Some(base_url), Some(cert_fp), Some(token)) => Some(Source { base_url, cert_fp, token }),
        _ => None,
    };
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

/// On while this is a student PC. The window then refuses every download; see `run`.
#[derive(Default)]
struct Lockdown(AtomicBool);

/// The page says whether this is a student PC. A student's page has no way to call this: it has no
/// developer tools and loads no code but the app's own.
#[tauri::command]
fn lock_down(state: State<'_, Lockdown>, on: bool) {
    state.0.store(on, Ordering::Relaxed);
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
        .manage(KeepAlive::default())
        .manage(RelayState::default())
        .manage(FileSource::default())
        .manage(Lockdown::default())
        // Library files for the page's players: see files.rs.
        .register_asynchronous_uri_scheme_protocol("ictfile", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let source = app.state::<FileSource>().0.lock().unwrap().clone();
                responder.respond(files::serve(&app.state::<HttpClients>(), source, request).await);
            });
        })
        // The window is made here, not by the config file, so that it can be given these two rules:
        // the app never opens a second window (a link that tries is refused), and on a student PC
        // nothing can be downloaded. The Server PC still saves its Excel files.
        .setup(|app| {
            let config = app.config().app.windows.first().expect("tauri.conf.json has the main window").clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_new_window(|_url, _features| NewWindowResponse::Deny)
                .on_download(|webview, event| match event {
                    DownloadEvent::Requested { .. } => !webview.state::<Lockdown>().0.load(Ordering::Relaxed),
                    _ => true,
                })
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discover_servers,
            api_request,
            keep_alive,
            probe_server,
            relay_open,
            relay_send,
            relay_close,
            load_settings,
            save_settings,
            clear_settings,
            set_file_source,
            lock_down,
            install_role
        ])
        .run(tauri::generate_context!())
        .expect("error while running the ICT App");
}
