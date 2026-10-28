use serde::Serialize;

/// Errors sent to the web view as `{ kind, message }`, so the UI can tell
/// "server unreachable" (try discovery again) from "wrong server" (pin mismatch).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Network(String),
    #[error("The server's certificate does not match the one this device trusts.")]
    PinMismatch,
    #[error("{0}")]
    BadInput(String),
    #[error("{0}")]
    Storage(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn from_reqwest(e: reqwest::Error) -> Self {
        let chain = format!("{e:?}");
        if chain.contains("fingerprint mismatch") {
            AppError::PinMismatch
        } else {
            AppError::Network(e.to_string())
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            AppError::Network(_) => "network",
            AppError::PinMismatch => "pin-mismatch",
            AppError::BadInput(_) => "bad-input",
            AppError::Storage(_) => "storage",
            AppError::Internal(_) => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
