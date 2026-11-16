//! HTTPS to the school server with a pinned certificate.
//! The web view can't pin a self-signed certificate, so every API call goes through here.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::pinning::{parse_fingerprint, FingerprintVerifier};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    pub base_url: String,
    pub cert_fp: String,
    pub method: String,
    pub path: String,
    pub body: Option<Value>,
    pub token: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub cert_fp: String,
    pub health: Value,
}

pub(crate) fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// TLS that trusts exactly the certificate the verifier pins. Shared with the relay socket.
pub(crate) fn tls_config(verifier: Arc<FingerprintVerifier>) -> Result<rustls::ClientConfig, AppError> {
    Ok(rustls::ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth())
}

fn build_client(verifier: Arc<FingerprintVerifier>) -> Result<reqwest::Client, AppError> {
    let tls = tls_config(verifier)?;
    reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// One client per pinned fingerprint, so connections are reused.
#[derive(Default)]
pub struct HttpClients(Mutex<HashMap<String, reqwest::Client>>);

impl HttpClients {
    pub(crate) async fn for_fingerprint(&self, fp: &str) -> Result<reqwest::Client, AppError> {
        let mut map = self.0.lock().await;
        if let Some(c) = map.get(fp) {
            return Ok(c.clone());
        }
        let expected = parse_fingerprint(fp).ok_or_else(|| AppError::BadInput("bad certificate fingerprint".into()))?;
        let client = build_client(Arc::new(FingerprintVerifier::new(Some(expected), provider())))?;
        map.insert(fp.to_string(), client.clone());
        Ok(client)
    }
}

pub async fn send(clients: &HttpClients, req: ApiRequest) -> Result<ApiResponse, AppError> {
    let client = clients.for_fingerprint(&req.cert_fp).await?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|_| AppError::BadInput("bad method".into()))?;
    let mut rb = client
        .request(method, format!("{}{}", req.base_url, req.path))
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(10_000)));
    if let Some(token) = &req.token {
        rb = rb.bearer_auth(token);
    }
    if let Some(body) = &req.body {
        rb = rb.json(body);
    }
    let res = rb.send().await.map_err(AppError::from_reqwest)?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(AppError::from_reqwest)?;
    let body = if text.is_empty() { None } else { serde_json::from_str(&text).ok() };
    Ok(ApiResponse { status, body })
}

/// Used for a typed-in address, where we have no fingerprint yet:
/// accept the certificate once, report its fingerprint, and pin it from then on.
/// One request said again and again on the app's own clock, e.g. "this teacher is still showing her
/// video". The page cannot be trusted with this: a window that is hidden or covered has its timers
/// slowed down by the computer, sometimes to once a minute.
#[derive(Default)]
pub struct KeepAlive(pub std::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>);

/// Is there still a point in saying it again? Not once the server says the thing is gone or over, or
/// that this person is no longer signed in. A server that cannot be reached may well come back.
pub(crate) fn worth_repeating(result: &Result<ApiResponse, AppError>) -> bool {
    !matches!(result, Ok(r) if matches!(r.status, 401 | 403 | 404 | 410))
}

/// Says `request` every `every` until the server says there is no point. Runs as a task of its own,
/// which is simply dropped to stop it.
pub async fn repeat(clients: &HttpClients, request: ApiRequest, every: Duration) {
    loop {
        tokio::time::sleep(every).await;
        if !worth_repeating(&send(clients, request.clone()).await) {
            break;
        }
    }
}

pub async fn probe(base_url: &str) -> Result<ProbeResult, AppError> {
    let verifier = Arc::new(FingerprintVerifier::new(None, provider()));
    let seen = verifier.seen();
    let client = build_client(verifier)?;
    let res = client
        .get(format!("{base_url}/health"))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map_err(AppError::from_reqwest)?;
    let health: Value = res.json().await.map_err(AppError::from_reqwest)?;
    let cert_fp = seen.lock().unwrap().clone().ok_or_else(|| AppError::Internal("no certificate seen".into()))?;
    Ok(ProbeResult { cert_fp, health })
}

/// Live checks against a running school server. Skipped unless ICT_E2E=1.
/// Run: ICT_E2E=1 cargo test e2e -- --nocapture  (with the server on its default ports)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_repeating_only_when_the_server_says_there_is_no_point() {
        let said = |status| Ok(ApiResponse { status, body: None });
        assert!(worth_repeating(&said(204)));
        assert!(worth_repeating(&said(500)));
        assert!(worth_repeating(&Err(AppError::Network("cable out".into()))));
        for gone in [401, 403, 404, 410] {
            assert!(!worth_repeating(&said(gone)));
        }
    }
}

#[cfg(test)]
mod e2e {
    use super::*;
    use crate::discovery;

    fn enabled() -> bool {
        std::env::var("ICT_E2E").as_deref() == Ok("1")
    }

    #[tokio::test]
    async fn e2e_discover_probe_and_pin() {
        if !enabled() {
            return;
        }
        let found = discovery::discover("student", "test", Duration::from_millis(1500)).await.unwrap();
        let server = found.first().expect("a server answered the broadcast");
        let fp = server.cert_fp.clone().expect("server sends its fingerprint");
        let base = format!("https://127.0.0.1:{}", server.port);

        // Probe sees the same certificate the beacon announced.
        let probe = probe(&base).await.unwrap();
        assert_eq!(probe.cert_fp, fp);

        // Pinned request succeeds with the right fingerprint...
        let clients = HttpClients::default();
        let req = |fp: &str| ApiRequest {
            base_url: base.clone(), cert_fp: fp.to_string(), method: "GET".into(),
            path: "/health".into(), body: None, token: None, timeout_ms: None,
        };
        let ok = send(&clients, req(&fp)).await.unwrap();
        assert_eq!(ok.status, 200);
        assert_eq!(ok.body.unwrap()["serverId"], server.server_id);

        // ...and is refused with any other.
        let wrong = "00:".repeat(31) + "00";
        let err = send(&clients, req(&wrong)).await.unwrap_err();
        assert!(matches!(err, AppError::PinMismatch), "got {err:?}");
    }

    /// A teacher shows a video and then her page says nothing at all, as when its window is hidden.
    /// The app's own "still here" keeps the show on well past the 20 seconds after which a silent
    /// show ends; once that stops too, the show ends, and the repeating gives up by itself.
    /// Needs a server at ICT_E2E_BASE with a staff sign-in (ICT_E2E_USER / ICT_E2E_PASSWORD) and a
    /// video in its library (skipped without them).
    #[tokio::test]
    async fn e2e_keep_alive_holds_a_show_while_the_page_is_silent() {
        let (Ok(base), Ok(user), Ok(password)) = (std::env::var("ICT_E2E_BASE"), std::env::var("ICT_E2E_USER"), std::env::var("ICT_E2E_PASSWORD")) else { return };
        if !enabled() {
            return;
        }
        let fp = probe(&base).await.unwrap().cert_fp;
        let clients = Arc::new(HttpClients::default());
        let req = |method: &str, path: &str, body: Option<Value>, token: Option<&str>| ApiRequest {
            base_url: base.clone(), cert_fp: fp.clone(), method: method.into(), path: path.into(), body, token: token.map(String::from), timeout_ms: None,
        };
        let signed_in = send(&clients, req("POST", "/api/v1/auth/staff", Some(serde_json::json!({ "username": user, "password": password })), None)).await.unwrap();
        let token = signed_in.body.unwrap()["token"].as_str().unwrap().to_string();
        let library = send(&clients, req("GET", "/api/v1/content", None, Some(&token))).await.unwrap().body.unwrap();
        let video = library.as_array().unwrap().iter().find(|c| c["kind"] == "video").expect("a video in the library")["id"].clone();
        let show = send(&clients, req("POST", "/api/v1/shows", Some(serde_json::json!({ "contentId": video })), Some(&token))).await.unwrap();
        assert_eq!(show.status, 201);
        let beat_path = format!("/api/v1/shows/{}/beat", show.body.unwrap()["id"].as_str().unwrap());
        let beat = req("POST", &beat_path, None, Some(&token));

        let task = tokio::spawn({ let (clients, beat) = (clients.clone(), beat.clone()); async move { repeat(&clients, beat, Duration::from_secs(2)).await } });
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert!(!task.is_finished(), "the show should still be on, so the repeating should still be going");
        task.abort();
        assert_eq!(send(&clients, beat.clone()).await.unwrap().status, 204, "the show outlived 30 silent seconds");

        // With nobody saying "still here", it ends; and a repeat started now stops at the first answer.
        tokio::time::sleep(Duration::from_secs(27)).await;
        assert_eq!(send(&clients, beat.clone()).await.unwrap().status, 404);
        tokio::time::timeout(Duration::from_secs(5), repeat(&clients, beat, Duration::from_secs(1))).await.expect("gives up once the show is gone");
    }
}
