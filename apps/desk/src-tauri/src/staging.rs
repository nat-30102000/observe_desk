//! Dropped files wait here (not in the queue file) until Obsidian can take them.

use std::fs;
use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn path_for(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid id".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("staging");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(id))
}

pub fn read(app: &AppHandle, id: &str) -> Result<Vec<u8>, String> {
    fs::read(path_for(app, id)?).map_err(|e| e.to_string())
}

/// Raw bytes in the body, the file id in the `x-file-id` header.
#[tauri::command]
pub fn stage_file(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    if bytes.len() > MAX_FILE_BYTES {
        return Err("That file is larger than 50 MB".into());
    }
    let id = request
        .headers()
        .get("x-file-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing file id")?;
    fs::write(path_for(&app, id)?, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_staged(app: AppHandle, id: String) -> Result<Response, String> {
    Ok(Response::new(read(&app, &id)?))
}

#[tauri::command]
pub fn remove_staged(app: AppHandle, id: String) -> Result<(), String> {
    match fs::remove_file(path_for(&app, &id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Offline text recognition of a staged PNG (Windows only).
#[tauri::command]
pub async fn ocr_staged(app: AppHandle, id: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let bytes = read(&app, &id)?;
        tauri::async_runtime::spawn_blocking(move || crate::winocr::recognize_png(&bytes))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, id);
        Err("Built-in text recognition is only available on Windows".into())
    }
}
