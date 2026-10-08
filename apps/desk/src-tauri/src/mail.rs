//! Reads new messages from a mailbox over IMAP so forwarded mail and newsletters can become notes.
//! Messages are only read (BODY.PEEK): nothing is marked as seen, moved or deleted.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use base64::Engine;
use imap::Session;
use serde::{Deserialize, Serialize};

const MAX_MESSAGE_BYTES: u32 = 8 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 24 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
pub struct ImapConfig {
    host: String,
    port: u16,
    /// Encrypted connection. Turning it off is only meant for a mail server on this computer.
    tls: bool,
    username: String,
    password: String,
    folder: String,
}

#[derive(Serialize)]
pub struct MailMessage {
    uid: u32,
    raw_base64: String,
}

#[derive(Serialize)]
pub struct MailBatch {
    uid_validity: u32,
    /// Highest uid handled in this batch (or, on first contact, the newest uid in the mailbox).
    last_uid: u32,
    messages: Vec<MailMessage>,
    /// Uids skipped because they were too big.
    skipped: Vec<u32>,
    /// More new mail is waiting; call again.
    more: bool,
    /// Messages in the mailbox, for the connection test.
    exists: u32,
}

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

fn is_local(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

fn fetch_batch<T: Read + Write>(
    mut session: Session<T>,
    folder: &str,
    uid_validity: Option<u32>,
    after_uid: Option<u32>,
    limit: usize,
) -> Result<MailBatch, String> {
    let mailbox = session.select(folder).map_err(|err| format!("Could not open folder \"{folder}\": {err}"))?;
    let validity = mailbox.uid_validity.unwrap_or(0);
    let newest = mailbox.uid_next.map(|n| n.saturating_sub(1)).unwrap_or(0);
    let exists = mailbox.exists;

    // First contact, or the server renumbered the mailbox: start from now instead of importing everything.
    let after = match (uid_validity, after_uid) {
        (Some(v), Some(a)) if v == validity => a,
        (_, Some(a)) if uid_validity.is_none() => a,
        _ => {
            let _ = session.logout();
            return Ok(MailBatch { uid_validity: validity, last_uid: newest, messages: vec![], skipped: vec![], more: false, exists });
        }
    };

    let mut uids: Vec<u32> = session
        .uid_search(format!("UID {}:*", after.saturating_add(1)))
        .map_err(e)?
        .into_iter()
        .filter(|u| *u > after)
        .collect();
    uids.sort_unstable();
    let more = uids.len() > limit;
    uids.truncate(limit);

    let mut messages = Vec::new();
    let mut skipped = Vec::new();
    let mut total = 0usize;
    let mut last_uid = after;
    for uid in uids {
        let sizes = session.uid_fetch(uid.to_string(), "(UID RFC822.SIZE)").map_err(e)?;
        let size = sizes.iter().next().and_then(|m| m.size).unwrap_or(0);
        if size > MAX_MESSAGE_BYTES {
            skipped.push(uid);
            last_uid = uid;
            continue;
        }
        if total + size as usize > MAX_BATCH_BYTES && !messages.is_empty() {
            return Ok(MailBatch { uid_validity: validity, last_uid, messages, skipped, more: true, exists });
        }
        let fetched = session.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])").map_err(e)?;
        if let Some(body) = fetched.iter().next().and_then(|m| m.body()) {
            total += body.len();
            messages.push(MailMessage { uid, raw_base64: base64::engine::general_purpose::STANDARD.encode(body) });
        }
        last_uid = uid;
    }
    let _ = session.logout();
    Ok(MailBatch { uid_validity: validity, last_uid, messages, skipped, more, exists })
}

fn run(cfg: ImapConfig, uid_validity: Option<u32>, after_uid: Option<u32>, limit: usize) -> Result<MailBatch, String> {
    if !cfg.tls && !is_local(&cfg.host) {
        return Err("An unencrypted connection is only allowed for a mail server on this computer".into());
    }
    let stream = TcpStream::connect((cfg.host.as_str(), cfg.port)).map_err(|err| format!("Could not connect to {}:{}: {err}", cfg.host, cfg.port))?;
    let _ = stream.set_read_timeout(Some(TIMEOUT));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    if cfg.tls {
        let tls = native_tls::TlsConnector::new().map_err(e)?;
        let tls_stream = tls.connect(&cfg.host, stream).map_err(|err| format!("Secure connection failed: {err}"))?;
        let mut client = imap::Client::new(tls_stream);
        client.read_greeting().map_err(e)?;
        let session = client.login(&cfg.username, &cfg.password).map_err(|(err, _)| format!("Sign-in failed: {err}"))?;
        fetch_batch(session, &cfg.folder, uid_validity, after_uid, limit)
    } else {
        let mut client = imap::Client::new(stream);
        client.read_greeting().map_err(e)?;
        let session = client.login(&cfg.username, &cfg.password).map_err(|(err, _)| format!("Sign-in failed: {err}"))?;
        fetch_batch(session, &cfg.folder, uid_validity, after_uid, limit)
    }
}

/// Fetch new messages after `after_uid`. With no saved position it only reports where the mailbox is now.
#[tauri::command]
pub async fn imap_fetch(cfg: ImapConfig, uid_validity: Option<u32>, after_uid: Option<u32>, limit: u32) -> Result<MailBatch, String> {
    tauri::async_runtime::spawn_blocking(move || run(cfg, uid_validity, after_uid, limit.clamp(0, 50) as usize))
        .await
        .map_err(e)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(password: &str) -> ImapConfig {
        ImapConfig {
            host: "127.0.0.1".into(),
            port: std::env::var("IMAP_TEST_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(1143),
            tls: false,
            username: "tester".into(),
            password: password.into(),
            folder: "INBOX".into(),
        }
    }

    fn deliver(subject: &str) {
        let c = cfg("secret");
        let stream = TcpStream::connect((c.host.as_str(), c.port)).unwrap();
        let mut client = imap::Client::new(stream);
        client.read_greeting().unwrap();
        let mut s = client.login(&c.username, &c.password).map_err(|(e, _)| e).unwrap();
        let msg = format!("From: Alice <alice@example.com>\r\nSubject: {subject}\r\nMessage-ID: <{subject}@example.com>\r\n\r\nBody of {subject}\r\n");
        s.append("INBOX", msg.as_bytes()).unwrap();
        s.logout().unwrap();
    }

    /// Needs a local IMAP server (see the test setup in the PR notes): cargo test -- --ignored
    #[test]
    #[ignore]
    fn reads_only_new_messages_and_never_the_old_ones() {
        deliver("old-one");
        // First contact: nothing is imported, we just learn where the mailbox is.
        let first = run(cfg("secret"), None, None, 10).unwrap();
        assert!(first.messages.is_empty());
        assert!(first.last_uid >= 1);

        deliver("new-a");
        deliver("new-b");
        let batch = run(cfg("secret"), Some(first.uid_validity), Some(first.last_uid), 10).unwrap();
        assert_eq!(batch.messages.len(), 2);
        let text = |m: &MailMessage| String::from_utf8(base64::engine::general_purpose::STANDARD.decode(&m.raw_base64).unwrap()).unwrap();
        assert!(text(&batch.messages[0]).contains("Body of new-a"));
        assert!(text(&batch.messages[1]).contains("Subject: new-b"));
        assert!(batch.last_uid > first.last_uid);
        assert!(!batch.more);

        // Nothing new: nothing returned (UID n:* always returns the last message, which must be filtered).
        let again = run(cfg("secret"), Some(batch.uid_validity), Some(batch.last_uid), 10).unwrap();
        assert!(again.messages.is_empty());
        assert_eq!(again.last_uid, batch.last_uid);

        // The limit pages through new mail.
        deliver("p1");
        deliver("p2");
        deliver("p3");
        let page1 = run(cfg("secret"), Some(again.uid_validity), Some(again.last_uid), 2).unwrap();
        assert_eq!((page1.messages.len(), page1.more), (2, true));
        let page2 = run(cfg("secret"), Some(page1.uid_validity), Some(page1.last_uid), 2).unwrap();
        assert_eq!((page2.messages.len(), page2.more), (1, false));

        // A renumbered mailbox (different uid validity) restarts from now instead of re-importing.
        let renumbered = run(cfg("secret"), Some(page2.uid_validity + 1), Some(1), 10).unwrap();
        assert!(renumbered.messages.is_empty());
        assert_eq!(renumbered.last_uid, page2.last_uid);
    }

    #[test]
    #[ignore]
    fn bad_password_and_plaintext_to_remote_hosts_are_rejected() {
        let err = run(cfg("wrong"), None, None, 1).err().unwrap();
        assert!(err.contains("Sign-in failed"), "{err}");
        let mut remote = cfg("secret");
        remote.host = "mail.example.com".into();
        remote.tls = false;
        assert!(run(remote, None, None, 1).err().unwrap().contains("only allowed for a mail server on this computer"));
    }
}
