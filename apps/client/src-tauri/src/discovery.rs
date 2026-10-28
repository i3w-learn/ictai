//! Finding the school server with a UDP broadcast (spec 8.1).
//! Browser code can't send UDP, which is why this lives in Rust.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;
use tokio::time::{timeout_at, Instant};

use crate::error::AppError;

pub const BEACON_PORT: u16 = 7701;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub server_id: String,
    pub school_id: Option<String>,
    pub name: String,
    pub addrs: Vec<String>,
    pub port: u16,
    pub cert_fp: Option<String>,
    /// The address the reply actually came from; tried first.
    pub from: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Here {
    t: String,
    v: u8,
    server_id: String,
    school_id: Option<String>,
    name: String,
    addrs: Vec<String>,
    port: u16,
    cert_fp: Option<String>,
}

/// Broadcasts one "discover" message and collects every answer until `wait` runs out.
/// Loopback is asked too, so the console on the server PC always finds its own server.
pub async fn discover(app: &str, version: &str, wait: Duration) -> Result<Vec<Found>, AppError> {
    let sock = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).await.map_err(|e| AppError::Network(e.to_string()))?;
    sock.set_broadcast(true).map_err(|e| AppError::Network(e.to_string()))?;

    let msg = serde_json::json!({ "t": "discover", "v": 1, "app": app, "ver": version }).to_string();
    for target in [Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST] {
        // A failed send on one target (e.g. no network) must not stop the other.
        let _ = sock.send_to(msg.as_bytes(), (target, BEACON_PORT)).await;
    }

    let deadline = Instant::now() + wait;
    let mut found: HashMap<String, Found> = HashMap::new();
    let mut buf = [0u8; 2048];
    while let Ok(Ok((n, from))) = timeout_at(deadline, sock.recv_from(&mut buf)).await {
        if let Some(f) = parse_reply(&buf[..n], from) {
            found.entry(f.server_id.clone()).or_insert(f);
        }
    }
    Ok(found.into_values().collect())
}

fn parse_reply(bytes: &[u8], from: SocketAddr) -> Option<Found> {
    let here: Here = serde_json::from_slice(bytes).ok()?;
    if here.t != "here" || here.v != 1 {
        return None;
    }
    Some(Found {
        server_id: here.server_id,
        school_id: here.school_id,
        name: here.name,
        addrs: here.addrs,
        port: here.port,
        cert_fp: here.cert_fp,
        from: from.ip().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_here_reply() {
        let json = br#"{"t":"here","v":1,"serverId":"s1","schoolId":null,"name":"Lab","addrs":["192.168.1.20"],"port":7700,"certFp":"AA"}"#;
        let f = parse_reply(json, "192.168.1.20:7701".parse().unwrap()).unwrap();
        assert_eq!(f.server_id, "s1");
        assert_eq!(f.from, "192.168.1.20");
    }

    #[test]
    fn ignores_other_messages() {
        let from = "1.2.3.4:7701".parse().unwrap();
        assert!(parse_reply(b"junk", from).is_none());
        assert!(parse_reply(br#"{"t":"discover","v":1}"#, from).is_none());
    }
}
