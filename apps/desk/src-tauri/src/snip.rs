//! Screenshot region capture: freeze the screen into a full-screen window and let the page crop it.

use std::sync::Mutex;

use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct SnipState {
    image: Mutex<Option<Vec<u8>>>,
    /// Windows that were visible before the capture, shown again afterwards.
    hidden: Mutex<Vec<String>>,
}

const OWN_WINDOWS: [&str; 3] = ["pet", "quickadd", "desk"];

#[cfg(windows)]
pub fn start(app: &AppHandle) -> Result<(), String> {
    use tauri::{PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

    if app.get_webview_window("snip").is_some() {
        return Ok(());
    }
    let state = app.state::<SnipState>();
    // Hide our own windows so Nib and the Desk are not in the picture.
    let mut hidden = Vec::new();
    for label in OWN_WINDOWS {
        if let Some(w) = app.get_webview_window(label) {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
                hidden.push(label.to_string());
            }
        }
    }
    *state.hidden.lock().unwrap() = hidden;
    std::thread::sleep(std::time::Duration::from_millis(180));

    let area = crate::winshot::virtual_area();
    let png = match crate::winshot::capture_png(&area) {
        Ok(p) => p,
        Err(e) => {
            restore(app);
            return Err(e);
        }
    };
    *state.image.lock().unwrap() = Some(png);

    let window = WebviewWindowBuilder::new(app, "snip", WebviewUrl::App("index.html?view=snip".into()))
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .shadow(false)
        .build()
        .map_err(|e| {
            restore(app);
            e.to_string()
        })?;
    let _ = window.set_position(PhysicalPosition::new(area.x, area.y));
    let _ = window.set_size(PhysicalSize::new(area.width as u32, area.height as u32));
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

#[cfg(not(windows))]
pub fn start(_app: &AppHandle) -> Result<(), String> {
    Err("Screenshots are only supported on Windows".into())
}

fn restore(app: &AppHandle) {
    let state = app.state::<SnipState>();
    for label in state.hidden.lock().unwrap().drain(..) {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.show();
        }
    }
    *state.image.lock().unwrap() = None;
}

#[tauri::command]
pub fn snip_start(app: AppHandle) -> Result<(), String> {
    start(&app)
}

/// The frozen screen, as PNG bytes, for the snip window to draw.
#[tauri::command]
pub fn snip_image(state: State<'_, SnipState>) -> Result<Response, String> {
    state.image.lock().unwrap().clone().map(Response::new).ok_or_else(|| "No screenshot in progress".into())
}

/// Close the snip window and bring our windows back. Called after a crop or on Escape.
#[tauri::command]
pub fn snip_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window("snip") {
        let _ = w.destroy();
    }
    restore(&app);
}
