//! Saves this device's settings (role, server ID, pinned fingerprint, device token)
//! as one JSON file in the app's config folder. The UI owns the shape.
//! TODO(M4): encrypt the device token with Windows DPAPI (spec 7.3).

use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use crate::error::AppError;

const FILE: &str = "device.json";

pub fn load(dir: PathBuf) -> Result<Option<Value>, AppError> {
    let path = dir.join(FILE);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Storage(e.to_string()))?;
    serde_json::from_str(&text).map(Some).map_err(|e| AppError::Storage(e.to_string()))
}

pub fn save(dir: PathBuf, value: &Value) -> Result<(), AppError> {
    fs::create_dir_all(&dir).map_err(|e| AppError::Storage(e.to_string()))?;
    // Write to a temp file and rename, so a power cut never leaves a half-written file.
    let tmp = dir.join(format!("{FILE}.tmp"));
    let text = serde_json::to_string_pretty(value).map_err(|e| AppError::Storage(e.to_string()))?;
    fs::write(&tmp, text).map_err(|e| AppError::Storage(e.to_string()))?;
    fs::rename(&tmp, dir.join(FILE)).map_err(|e| AppError::Storage(e.to_string()))
}

pub fn clear(dir: PathBuf) -> Result<(), AppError> {
    match fs::remove_file(dir.join(FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(AppError::Storage(e.to_string())),
        _ => Ok(()),
    }
}
