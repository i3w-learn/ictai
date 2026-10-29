//! The live connection to the school server (spec 8.3): one WebSocket at wss://<server>/relay.
//! Like HTTPS, it lives here because the web view can't pin the server's self-signed certificate.
//! Incoming text goes to the web view as `relay://message`; a closed socket as `relay://closed`.
//! Each socket gets a number, so the web view can ignore events from one it has replaced.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async_tls_with_config, Connector};

use crate::error::AppError;
use crate::http::{provider, tls_config};
use crate::pinning::{parse_fingerprint, FingerprintVerifier};

#[derive(Default)]
pub struct RelayState {
    next_conn: AtomicU64,
    // Dropping the sender ends the writer task, which closes the socket.
    outbox: Mutex<Option<mpsc::UnboundedSender<Message>>>,
}

#[derive(Clone, Serialize)]
struct Incoming {
    conn: u64,
    text: String,
}

#[derive(Clone, Serialize)]
struct Closed {
    conn: u64,
    code: Option<u16>,
    reason: String,
}

pub fn ws_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let rest = base.strip_prefix("https://").unwrap_or(base);
    format!("wss://{rest}/relay")
}

type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Connects with the pinned certificate and the session token in the Authorization header.
async fn connect(base_url: &str, cert_fp: &str, token: &str) -> Result<Socket, AppError> {
    let fp = parse_fingerprint(cert_fp).ok_or_else(|| AppError::BadInput("bad certificate fingerprint".into()))?;
    let tls = tls_config(Arc::new(FingerprintVerifier::new(Some(fp), provider())))?;

    let mut req = ws_url(base_url).into_client_request().map_err(|e| AppError::BadInput(e.to_string()))?;
    let auth = HeaderValue::from_str(&format!("Bearer {token}")).map_err(|e| AppError::BadInput(e.to_string()))?;
    req.headers_mut().insert("Authorization", auth);

    let connect = connect_async_tls_with_config(req, None, false, Some(Connector::Rustls(Arc::new(tls))));
    let (socket, _) = tokio::time::timeout(Duration::from_secs(5), connect)
        .await
        .map_err(|_| AppError::Network("The server did not answer in time.".into()))?
        .map_err(|e| {
            let chain = format!("{e:?}");
            if chain.contains("fingerprint mismatch") { AppError::PinMismatch } else { AppError::Network(e.to_string()) }
        })?;
    Ok(socket)
}

/// Opens a socket (closing any earlier one) and returns its number.
pub async fn open(app: AppHandle, state: &RelayState, base_url: &str, cert_fp: &str, token: &str) -> Result<u64, AppError> {
    close(state).await;
    let socket = connect(base_url, cert_fp, token).await?;

    let conn = state.next_conn.fetch_add(1, Ordering::Relaxed) + 1;
    let (mut write, mut read) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    *state.outbox.lock().await = Some(tx);

    tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
        let _ = write.close().await;
    });

    tauri::async_runtime::spawn(async move {
        let (code, reason) = loop {
            match read.next().await {
                Some(Ok(Message::Text(text))) => {
                    let _ = app.emit("relay://message", Incoming { conn, text: text.to_string() });
                }
                Some(Ok(Message::Close(frame))) => {
                    break frame.map_or((None, "closed".into()), |f| (Some(u16::from(f.code)), f.reason.to_string()));
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => break (None, e.to_string()),
                None => break (None, "closed".into()),
            }
        };
        let _ = app.emit("relay://closed", Closed { conn, code, reason });
    });

    Ok(conn)
}

pub async fn send(state: &RelayState, text: String) -> Result<(), AppError> {
    let outbox = state.outbox.lock().await;
    let tx = outbox.as_ref().ok_or_else(|| AppError::Network("Not connected.".into()))?;
    tx.send(Message::text(text)).map_err(|_| AppError::Network("Not connected.".into()))
}

pub async fn close(state: &RelayState) {
    state.outbox.lock().await.take();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_relay_url_from_the_server_address() {
        assert_eq!(ws_url("https://10.0.0.5:7700"), "wss://10.0.0.5:7700/relay");
        assert_eq!(ws_url("https://10.0.0.5:7700/"), "wss://10.0.0.5:7700/relay");
    }

    /// Live check against a running dev server (`just server`). Skipped unless ICT_E2E=1.
    #[tokio::test]
    async fn e2e_relay_says_hello_and_rejects_a_bad_pin() {
        if std::env::var("ICT_E2E").as_deref() != Ok("1") {
            return;
        }
        let base = "https://127.0.0.1:7700";
        let probe = crate::http::probe(base).await.unwrap();
        let clients = crate::http::HttpClients::default();
        let login = crate::http::send(&clients, crate::http::ApiRequest {
            base_url: base.into(), cert_fp: probe.cert_fp.clone(), method: "POST".into(), path: "/api/v1/auth/staff".into(),
            body: Some(serde_json::json!({ "username": "admin", "password": "admin123" })), token: None, timeout_ms: None,
        }).await.unwrap();
        let token = login.body.unwrap()["token"].as_str().unwrap().to_string();

        let mut socket = connect(base, &probe.cert_fp, &token).await.unwrap();
        let first = socket.next().await.unwrap().unwrap();
        let hello: serde_json::Value = serde_json::from_str(first.to_text().unwrap()).unwrap();
        assert_eq!(hello["t"], "hello");

        let wrong = "00:".repeat(31) + "00";
        assert!(matches!(connect(base, &wrong, &token).await, Err(AppError::PinMismatch)));
    }
}
