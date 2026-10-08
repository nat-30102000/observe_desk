use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const SERVICE: &str = "observe_desk";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Names become file names, so only a safe alphabet is accepted.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn read_text(app: &AppHandle, file: &str) -> Result<Option<String>, String> {
    let path = data_dir(app)?.join(file);
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Write via a temp file and rename, so a crash never leaves half a queue on disk.
pub fn write_text(app: &AppHandle, file: &str, text: &str) -> Result<(), String> {
    let dir = data_dir(app)?;
    let tmp = dir.join(format!("{file}.tmp"));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(file)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_json(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if !valid_name(&name) {
        return Err("invalid name".into());
    }
    read_text(&app, &format!("{name}.json"))
}

#[tauri::command]
pub fn save_json(app: AppHandle, name: String, text: String) -> Result<(), String> {
    if !valid_name(&name) {
        return Err("invalid name".into());
    }
    write_text(&app, &format!("{name}.json"), &text)
}

/// Secrets live in Windows Credential Manager. On other platforms (dev builds) they are not stored.
#[cfg(windows)]
#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &name).map_err(|e| e.to_string())?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn secret_get(_name: String) -> Result<Option<String>, String> {
    let _ = SERVICE;
    Err("secret storage is only available on Windows; the web UI falls back to local storage".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn secret_set(_name: String, _value: String) -> Result<(), String> {
    Err("secret storage is only available on Windows; the web UI falls back to local storage".into())
}
