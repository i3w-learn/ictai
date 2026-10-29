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

#[derive(Debug, Deserialize)]
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
    async fn for_fingerprint(&self, fp: &str) -> Result<reqwest::Client, AppError> {
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
}
