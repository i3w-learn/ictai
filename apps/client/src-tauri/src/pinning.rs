//! Certificate pinning (spec 8.2).
//!
//! The school server makes its own self-signed certificate, so normal CA checks can't work.
//! Instead we trust exactly one certificate: the one whose SHA-256 fingerprint we were given
//! by discovery and confirmed at enrolment. Signatures are still verified normally.

use std::sync::{Arc, Mutex};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as TlsError, SignatureScheme};
use sha2::{Digest, Sha256};

/// "AA:BB:..." (as the server prints it) or plain hex, to raw bytes.
pub fn parse_fingerprint(fp: &str) -> Option<[u8; 32]> {
    let clean: String = fp.chars().filter(|c| *c != ':').collect();
    hex::decode(clean).ok()?.try_into().ok()
}

/// Raw bytes to the server's "AA:BB:..." format.
pub fn format_fingerprint(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

#[derive(Debug)]
pub struct FingerprintVerifier {
    /// `None` means "probe": accept any certificate but record what we saw.
    expected: Option<[u8; 32]>,
    seen: Arc<Mutex<Option<String>>>,
    provider: Arc<CryptoProvider>,
}

impl FingerprintVerifier {
    pub fn new(expected: Option<[u8; 32]>, provider: Arc<CryptoProvider>) -> Self {
        Self { expected, seen: Arc::default(), provider }
    }

    pub fn seen(&self) -> Arc<Mutex<Option<String>>> {
        self.seen.clone()
    }
}

impl ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        let actual: [u8; 32] = Sha256::digest(end_entity.as_ref()).into();
        *self.seen.lock().unwrap() = Some(format_fingerprint(&actual));
        match self.expected {
            Some(expected) if expected != actual => Err(TlsError::General("certificate fingerprint mismatch".into())),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_round_trips() {
        let fp = "A3:89:03:17:70:1E:39:6D:B3:8C:0F:7A:BF:57:12:03:3D:34:A1:F5:7E:33:46:9C:9D:FD:38:A0:B3:6C:01:91";
        let bytes = parse_fingerprint(fp).expect("valid");
        assert_eq!(format_fingerprint(&bytes), fp);
    }

    #[test]
    fn rejects_bad_fingerprints() {
        assert!(parse_fingerprint("not hex").is_none());
        assert!(parse_fingerprint("AA:BB").is_none());
    }
}
