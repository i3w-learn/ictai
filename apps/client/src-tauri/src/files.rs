//! Library files for the web view's own players (picture, PDF, video, sound).
//! The web view cannot talk to the school server itself (it can't pin the certificate), and a big
//! video must not be held whole in memory. So the page points a player at `ictfile://…/<fingerprint>`
//! and each request the player makes (usually "give me bytes N onwards") is passed on from here to
//! the server's streaming route over pinned HTTPS. The server answers with one part at a time.

use std::sync::Mutex;
use std::time::Duration;

use tauri::http::{header, Request, Response, StatusCode};

use crate::http::HttpClients;

/// Where files come from and who is asking: set by the page each time a file is opened.
#[derive(Clone)]
pub struct Source {
    pub base_url: String,
    pub cert_fp: String,
    pub token: String,
}

#[derive(Default)]
pub struct FileSource(pub Mutex<Option<Source>>);

/// The file's fingerprint is the last part of the address; anything else is refused.
pub fn hash_of(path: &str) -> Option<&str> {
    let hash = path.trim_matches('/');
    (hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))).then_some(hash)
}

fn plain(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).unwrap()
}

pub async fn serve(clients: &HttpClients, source: Option<Source>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(hash) = hash_of(request.uri().path()) else { return plain(StatusCode::BAD_REQUEST) };
    let Some(src) = source else { return plain(StatusCode::UNAUTHORIZED) };
    let Ok(client) = clients.for_fingerprint(&src.cert_fp).await else { return plain(StatusCode::BAD_GATEWAY) };

    let mut rb = client
        .get(format!("{}/api/v1/files/{hash}/raw", src.base_url))
        .bearer_auth(&src.token)
        .timeout(Duration::from_secs(60));
    if let Some(range) = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) {
        rb = rb.header("range", range);
    }
    let Ok(res) = rb.send().await else { return plain(StatusCode::BAD_GATEWAY) };

    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out = Response::builder().status(status);
    // Only what a player needs is passed back; everything else the server sent stays here.
    for name in ["content-type", "content-range", "accept-ranges", "cache-control", "x-content-type-options"] {
        if let Some(value) = res.headers().get(name).and_then(|v| v.to_str().ok()) {
            out = out.header(name, value);
        }
    }
    match res.bytes().await {
        Ok(body) => out.header("content-length", body.len()).body(body.to_vec()).unwrap_or_else(|_| plain(StatusCode::BAD_GATEWAY)),
        Err(_) => plain(StatusCode::BAD_GATEWAY),
    }
}

#[cfg(test)]
mod tests {
    use super::hash_of;

    #[test]
    fn takes_a_fingerprint_and_nothing_else() {
        let hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(hash_of(&format!("/{hash}")), Some(hash));
        assert_eq!(hash_of("/"), None);
        assert_eq!(hash_of("/../../etc/passwd"), None);
        assert_eq!(hash_of(&format!("/{}", hash.to_uppercase())), None);
        assert_eq!(hash_of(&format!("/{hash}/more")), None);
    }

    /// Live check against a running dev server (`just server`): a file put in the library comes back
    /// through here whole, and in part when a player asks for a range. Skipped unless ICT_E2E=1.
    #[tokio::test]
    async fn e2e_streams_a_library_file_whole_and_in_part() {
        use crate::http::{send, ApiRequest, HttpClients};
        use serde_json::json;
        if std::env::var("ICT_E2E").as_deref() != Ok("1") {
            return;
        }
        let base = std::env::var("ICT_E2E_BASE").unwrap_or_else(|_| "https://127.0.0.1:7700".into());
        let probe = crate::http::probe(&base).await.unwrap();
        let clients = HttpClients::default();
        let call = |method: &str, path: String, body: serde_json::Value, token: Option<String>| {
            send(&clients, ApiRequest { base_url: base.clone(), cert_fp: probe.cert_fp.clone(), method: method.into(), path, body: Some(body), token, timeout_ms: None })
        };
        let login = call("POST", "/api/v1/auth/staff".into(), json!({ "username": "admin", "password": "admin123" }), None).await.unwrap();
        let token = login.body.unwrap()["token"].as_str().unwrap().to_string();
        let t = || Some(token.clone());

        // A tiny PNG: the 8 bytes every PNG starts with, then some filling "0123456789".
        let class = call("POST", "/api/v1/classes".into(), json!({ "name": format!("E2E {}", std::process::id()) }), t()).await.unwrap().body.unwrap();
        let up = call("POST", "/api/v1/content/uploads".into(), json!({ "fileName": "dot.png", "size": 18 }), t()).await.unwrap().body.unwrap();
        let id = up["uploadId"].as_str().unwrap();
        call("PUT", format!("/api/v1/content/uploads/{id}/chunks"), json!({ "index": 0, "data": "iVBORw0KGgowMTIzNDU2Nzg5" }), t()).await.unwrap();
        let item = call("POST", format!("/api/v1/content/uploads/{id}/finish"), json!({ "title": "Dot", "classId": class["id"] }), t()).await.unwrap().body.unwrap();
        let hash = item["fileHash"].as_str().expect("the file was filed");

        let source = || Some(super::Source { base_url: base.clone(), cert_fp: probe.cert_fp.clone(), token: token.clone() });
        let ask = |range: Option<&str>| {
            let mut rb = tauri::http::Request::builder().uri(format!("ictfile://localhost/{hash}"));
            if let Some(r) = range {
                rb = rb.header("range", r);
            }
            rb.body(Vec::new()).unwrap()
        };
        let whole = super::serve(&clients, source(), ask(None)).await;
        assert_eq!(whole.status(), 200);
        assert_eq!(whole.headers()["content-type"], "image/png");
        assert_eq!(whole.body().len(), 18);

        let part = super::serve(&clients, source(), ask(Some("bytes=8-"))).await;
        assert_eq!(part.status(), 206);
        assert_eq!(part.headers()["content-range"], "bytes 8-17/18");
        assert_eq!(part.body().as_slice(), b"0123456789");

        // Nobody signed in, or a token the server does not know: no file.
        assert_eq!(super::serve(&clients, None, ask(None)).await.status(), 401);
        let stranger = Some(super::Source { base_url: base.clone(), cert_fp: probe.cert_fp.clone(), token: "nope".into() });
        assert_eq!(super::serve(&clients, stranger, ask(None)).await.status(), 401);
    }
}
