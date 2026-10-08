mod bridge;
mod storage;

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Deserialize)]
struct ObsidianRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
struct ObsidianResponse {
    status: u16,
    body: String,
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

/// Talks to the Obsidian Local REST API. The plugin serves a self-signed certificate, so
/// certificate checks are skipped, but only for loopback addresses.
#[tauri::command]
async fn obsidian_fetch(req: ObsidianRequest) -> Result<ObsidianResponse, String> {
    let url = reqwest::Url::parse(&req.url).map_err(|e| e.to_string())?;
    if !is_loopback(url.host_str().unwrap_or("")) {
        return Err("Only loopback addresses are allowed".into());
    }
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url);
    for (k, v) in req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(ObsidianResponse { status, body })
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    body: String,
    final_url: String,
}

const MAX_PAGE_BYTES: usize = 5 * 1024 * 1024;

/// Fetches feeds and web pages for the reader. Plain http(s) only, size and time limited.
#[tauri::command]
async fn http_get(url: String) -> Result<HttpResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https links can be fetched".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("observe_desk/0.1 (+feed reader)")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(parsed)
        .header("Accept", "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    if resp.content_length().is_some_and(|n| n as usize > MAX_PAGE_BYTES) {
        return Err("That page is too large".into());
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PAGE_BYTES {
        return Err("That page is too large".into());
    }
    Ok(HttpResponse { status, body: String::from_utf8_lossy(&bytes).into_owned(), final_url })
}

#[derive(Deserialize)]
struct HttpRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

/// Calls hosted AI providers. https only, never loopback, size and time limited.
#[tauri::command]
async fn http_request(req: HttpRequest) -> Result<ObsidianResponse, String> {
    let url = reqwest::Url::parse(&req.url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" {
        return Err("Only https addresses are allowed".into());
    }
    if is_loopback(url.host_str().unwrap_or("")) {
        return Err("Local addresses are not allowed here".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url);
    for (k, v) in req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PAGE_BYTES {
        return Err("The answer was too large".into());
    }
    Ok(ObsidianResponse { status, body: String::from_utf8_lossy(&bytes).into_owned() })
}

const MAX_BOOK_BYTES: u64 = 200 * 1024 * 1024;

/// Reads a book chosen in the file dialog. Only .pdf and .epub files, up to 200 MB. Returns raw bytes.
#[tauri::command]
fn read_book(path: String) -> Result<tauri::ipc::Response, String> {
    let p = std::path::PathBuf::from(&path);
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("pdf") | Some("epub")) {
        return Err("Only .pdf and .epub files can be opened".into());
    }
    let len = std::fs::metadata(&p).map_err(|e| e.to_string())?.len();
    if len > MAX_BOOK_BYTES {
        return Err("That file is larger than 200 MB".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn reveal(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn show_window(app: AppHandle, label: String) {
    reveal(&app, &label);
}

#[tauri::command]
fn hide_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.hide();
    }
}

fn toggle_pet(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("pet") {
        if w.is_visible().unwrap_or(true) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

/// Park Nib near the bottom-right corner of the primary monitor.
fn place_pet(app: &AppHandle) {
    let Some(w) = app.get_webview_window("pet") else { return };
    let Ok(Some(monitor)) = w.primary_monitor() else { return };
    let Ok(size) = w.outer_size() else { return };
    let scale = monitor.scale_factor();
    let margin = (24.0 * scale) as i32;
    let taskbar = (56.0 * scale) as i32;
    let x = monitor.position().x + monitor.size().width as i32 - size.width as i32 - margin;
    let y = monitor.position().y + monitor.size().height as i32 - size.height as i32 - taskbar;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show or hide Nib", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quickadd", "Quick add", true, None::<&str>)?;
    let desk = MenuItem::with_id(app, "desk", "Open the Desk", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quick, &desk, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("observe_desk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_pet(app),
            "quickadd" => reveal(app, "quickadd"),
            "desk" => reveal(app, "desk"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_pet(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    let quick_add = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);
    let pet_toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &quick_add {
                        // The pet window reads the clipboard and opens the quick-add window.
                        let _ = app.emit("hotkey-capture", ());
                    } else if shortcut == &pet_toggle {
                        toggle_pet(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            obsidian_fetch,
            http_get,
            http_request,
            read_book,
            show_window,
            hide_window,
            storage::load_json,
            storage::save_json,
            storage::secret_get,
            storage::secret_set,
            bridge::extension_token,
        ])
        .on_window_event(|window, event| {
            // The Desk and quick-add windows hide instead of closing, so Nib keeps running.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "pet" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            place_pet(&handle);
            build_tray(&handle)?;
            if let Err(e) = handle.global_shortcut().register(quick_add) {
                eprintln!("could not register Ctrl+Alt+H: {e}");
            }
            if let Err(e) = handle.global_shortcut().register(pet_toggle) {
                eprintln!("could not register Ctrl+Alt+N: {e}");
            }
            bridge::start(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running observe_desk");
}
