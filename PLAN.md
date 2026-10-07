# observe_desk — Plan

A Windows desktop app that captures highlights, markdown, bookmarks, feeds and more, and writes them into an Obsidian vault.

## 1. Your requirements (as stated)

| # | You asked for | Decision |
|---|---|---|
| 1 | Desktop app for adding highlighted text, markdown and other things to Obsidian | Yes: capture app plus Obsidian writer |
| 2 | Bookmark websites | Yes: stored as vault notes |
| 3 | Manage subscriptions | **Both**: content feeds (RSS/Atom/YouTube/newsletters) **and** a paid-subscription tracker (cost, renewal date, reminders) |
| 4 | Stack: "Tauri or Electron, whichever is best" | **Tauri 2 + React + TypeScript** (see §3) |
| 5 | Obsidian link | **Obsidian Local REST API plugin** (not direct file writes) |
| 6 | Capture sources | Browser extension, global hotkey + clipboard, in-app reader, manual quick-add window |
| 7 | "Also more, too few for MVP" | PDF/EPUB highlights, YouTube/video, screenshot + OCR, social threads, email/newsletter forwarding, drag-and-drop files/images, voice notes, Readwise/Kindle/Pocket import |
| 8 | Note format | **One note per source, highlights appended**, with frontmatter (url, title, author, date, tags) |
| 9 | Data home | **Everything as vault notes**; the app reads them back via the REST API |
| 10 | OS | **Windows only** |
| 11 | When Obsidian is closed | **Queue locally, sync when Obsidian is back**, with a pending count shown |
| 12 | Phasing | **Core first, then waves** (§5) |
| 13 | Extras | AI summaries and auto-tagging with **multiple providers, not only Claude**; full-text search; browser extension for **Chrome and Firefox** |

### AI providers (from your note)
GPT (OpenAI), Claude, Grok (xAI), Gemini, NVIDIA NIM, OpenCode, Ollama **Cloud** (not local). Your own API key per provider, behind one provider interface. The user picks the default provider and can set a different one per task (summary, tags).

## 1b. Product shape update: the desktop pet "Nib"
The primary surface is a small always-on-top animated pet (working name **Nib**, an ink-drop creature), not a big window.
- Drag text, links, images or files onto Nib to capture; select text + Ctrl Alt H to highlight; click Nib for a menu (Quick add, Bookmarks, Feeds, Subscriptions, Settings).
- Moods: Idle, Curious (text selected), Nom nom (drop), Sleepy (Obsidian closed, queue pending), Reminder (renewal soon), Happy (synced). Speech bubbles fade after a few seconds.
- Draggable, snaps to screen edges, hides to tray (Ctrl Alt N), hides during full-screen apps, honours Windows reduced motion.
- The big "Desk" window (Inbox, Bookmarks, Feeds, Subscriptions, Settings) opens from Nib.
- Theme: light, playful (cream, pink, lilac, mint, sun yellow; Fredoka headings, Nunito body).
- Tauri implementation: transparent frameless always-on-top window for Nib, a second normal window for the Desk. Design: Claude design canvas (see session link).

## 2. Open points to confirm
- "OpenCode" is assumed to mean OpenCode's hosted/Zen API (OpenAI-compatible). Please confirm.
- Where API keys are stored: Windows Credential Manager (assumed).
- App name and icon: working name `observe_desk`.

## 3. Architecture

```
Browser extension (Chrome/Firefox, MV3)
        │  native messaging / localhost HTTP (token-auth)
        ▼
┌───────────────── Tauri 2 app (Windows) ─────────────────┐
│ React + TS UI: Inbox · Reader · Bookmarks · Feeds ·      │
│                Subscriptions · Search · Settings         │
│ Rust core: hotkeys, tray, clipboard, screenshot, queue,  │
│            feed fetcher, scheduler, local search index   │
└───────────────┬──────────────────────────────────────────┘
                │ HTTPS (127.0.0.1:27124) + API key
                ▼
        Obsidian Local REST API plugin ──► Vault (markdown notes)
```

- **Why Tauri:** Windows-only plus WebView2 gives a small installer and low RAM use, with Rust for global hotkeys, tray, clipboard and a background scheduler. Electron would also work but is heavier with no benefit here.
- **Obsidian writer:** one module wraps the REST API (create, append under a heading, patch frontmatter, list, search). Appends are idempotent, keyed by a highlight id, so retries never duplicate.
- **Offline queue:** SQLite holds a write-ahead queue (not the source of truth). Each capture is stored first, then flushed when the API answers. If a note changed in the meantime, we append instead of overwriting.
- **Source of truth:** the vault. A local SQLite file holds only the queue, the search index (rebuildable) and feed fetch state such as ETags. Deleting it loses nothing.
- **Search:** SQLite FTS5 over clips, bookmarks and feed items.
- **Extension auth:** random token created in the app and pasted into the extension; the app listens on localhost only.

## 4. Vault layout and note format

```
Clippings/<Source title>.md      one note per source
Bookmarks/<Title>.md
Feeds/<Feed name>/<Item>.md      only for items you clip or save
Subscriptions/<Service>.md       paid subscriptions
Attachments/                     images, PDFs, audio
```

Source note:
```markdown
---
type: clipping
url: https://example.com/post
title: Post title
author: Jane Doe
captured: 2026-10-07
tags: [clippings]
---
## Highlights
> highlighted text  ^h-3f9a
My note on it.
```

Bookmark: `type: bookmark`, url, title, description, tags, `read: false`.
Paid subscription: `type: subscription`, cost, currency, cycle, `next_renewal`, `status`, `category`. Fields are Bases/Dataview-friendly, so the vault can show renewal tables with no app involved.

## 5. Phases

**Phase 1 — Core (first usable build)**
1. Tauri + React scaffold, Windows installer, tray, settings.
2. Obsidian REST connection: URL and key setup, connection test, vault folder mapping.
3. Offline queue and sync with a pending indicator.
4. Quick-add window (paste text, markdown, files, images).
5. Global hotkey capture: selected text or clipboard, with source window and URL where available.
6. Browser extension (Chrome and Firefox): highlight on page, add note, save bookmark.
7. Bookmarks view (read back from vault, tags, open, edit).

**Phase 2 — Reader, feeds, subscriptions**
8. In-app reader for articles (readability extraction) with highlighting.
9. PDF and EPUB reader with highlights and page numbers.
10. RSS/Atom/YouTube channel feeds: fetch, unread state, clip to vault.
11. Paid-subscription tracker: CRUD, renewal reminders (Windows notifications), monthly/yearly totals.
12. Full-text search.

**Phase 3 — Rich capture**
13. YouTube/video: transcript, timestamped notes.
14. Screenshot/region capture plus OCR.
15. Social threads (X, Reddit, HN, Mastodon) to markdown.
16. Drag-and-drop files and images into Attachments.

**Phase 4 — Imports and ingest**
17. Voice notes: record and transcribe (via a provider's transcription API).
18. Email/newsletter forwarding (IMAP mailbox or inbound address; decided when we reach it).
19. Import from Readwise, Kindle and Pocket.

**Cross-cutting (starts in Phase 2):** AI provider layer (OpenAI, Claude, Grok, Gemini, NVIDIA NIM, OpenCode, Ollama Cloud): summaries, auto-tags and link suggestions on any note, off by default.

## 6. Risks
- Obsidian must be running with the REST plugin: mitigated by the queue and a clear connection status.
- Local HTTPS cert of the REST plugin is self-signed: the app must pin or trust it explicitly.
- Reader, social and email extraction break as sites change: keep extractors small and replaceable.
- Phases 3 and 4 are large; each item ships separately.
- Provider APIs differ: one interface, per-provider adapters, with NIM/OpenCode/Ollama Cloud treated as OpenAI-compatible where possible.

## 7. Next step
On your go-ahead I start Phase 1, step 1: scaffold the Tauri app and the Obsidian REST client, with tests for the writer and the queue.
