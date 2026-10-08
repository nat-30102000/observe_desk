//! Local HTTP endpoint the browser extension talks to (127.0.0.1 only, token protected).

use std::io::Read;

use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::storage;

const ADDR: &str = "127.0.0.1:27125";
const TOKEN_FILE: &str = "extension-token.txt";
const MAX_BODY: u64 = 2_000_000;

fn token(app: &AppHandle) -> Result<String, String> {
    if let Some(t) = storage::read_text(app, TOKEN_FILE)? {
        let t = t.trim().to_string();
        if t.len() >= 32 {
            return Ok(t);
        }
    }
    let fresh = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    storage::write_text(app, TOKEN_FILE, &fresh)?;
    Ok(fresh)
}

#[tauri::command]
pub fn extension_token(app: AppHandle) -> Result<String, String> {
    token(&app)
}

fn header(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Only browser extensions get CORS access. Ordinary web pages are never allowed.
fn cors_origin(req: &Request) -> Option<String> {
    header(req, "Origin").filter(|o| o.starts_with("chrome-extension://") || o.starts_with("moz-extension://"))
}

fn reply(req: Request, status: u16, body: &str, origin: Option<String>) {
    let mut resp = Response::from_string(body).with_status_code(status);
    let add = |resp: Response<std::io::Cursor<Vec<u8>>>, k: &str, v: &str| match Header::from_bytes(k.as_bytes(), v.as_bytes()) {
        Ok(h) => resp.with_header(h),
        Err(_) => resp,
    };
    resp = add(resp, "Content-Type", "application/json");
    if let Some(o) = origin {
        resp = add(resp, "Access-Control-Allow-Origin", &o);
        resp = add(resp, "Access-Control-Allow-Headers", "Content-Type, X-Observe-Token");
        resp = add(resp, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        resp = add(resp, "Vary", "Origin");
    }
    let _ = req.respond(resp);
}

fn handle(app: &AppHandle, token: &str, mut req: Request) {
    let origin = cors_origin(&req);
    if *req.method() == Method::Options {
        return reply(req, 204, "", origin);
    }
    let authorised = header(&req, "X-Observe-Token").is_some_and(|t| constant_time_eq(&t, token));
    if !authorised {
        return reply(req, 401, r#"{"error":"bad token"}"#, origin);
    }
    let path = req.url().split('?').next().unwrap_or("").to_string();
    match (req.method().clone(), path.as_str()) {
        (Method::Get, "/ping") => reply(req, 200, r#"{"ok":true}"#, origin),
        (Method::Post, "/capture") => {
            let mut body = String::new();
            if req.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
                return reply(req, 400, r#"{"error":"unreadable body"}"#, origin);
            }
            match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(value) => {
                    // The pet window validates the payload and files it.
                    let _ = app.emit("ext-capture", value);
                    reply(req, 202, r#"{"ok":true}"#, origin)
                }
                Err(_) => reply(req, 400, r#"{"error":"invalid json"}"#, origin),
            }
        }
        _ => reply(req, 404, r#"{"error":"not found"}"#, origin),
    }
}

pub fn start(app: AppHandle) {
    let token = match token(&app) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("extension bridge disabled: {e}");
            return;
        }
    };
    std::thread::spawn(move || {
        let server = match Server::http(ADDR) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("extension bridge could not listen on {ADDR}: {e}");
                return;
            }
        };
        for req in server.incoming_requests() {
            handle(&app, &token, req);
        }
    });
}
