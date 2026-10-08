# observe_desk

A Windows desktop pet (**Nib**) that files highlights, markdown, bookmarks and more into your Obsidian vault.
See `PLAN.md` for the full plan and phases.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | Platform-free TypeScript: Obsidian REST client, note formats, writer, offline queue, mood logic. Unit tested. |
| `apps/desk` | Tauri 2 + React app: Nib (pet window), Quick add window, the Desk window. Rust side: HTTP to Obsidian, storage, tray, global hotkeys, local endpoint for the browser extension. |
| `apps/extension` | Chrome and Firefox (Manifest V3) clipper. No build step. |

## Run it

Prerequisites: Node 20+, Rust stable, and on Windows the WebView2 runtime and MSVC build tools.

```sh
npm install
npm test                              # core + desk unit tests
npm run typecheck
npm run dev -w @observe/desk          # UI only, in a browser: http://localhost:1420/?view=pet | quickadd | desk
npm run tauri -w @observe/desk dev    # the real app
npm run tauri -w @observe/desk build  # Windows installer (NSIS)
```

### Connect Obsidian
1. In Obsidian, install and enable the **Local REST API** plugin and copy its API key.
2. Open the Desk > Settings, enter the key, press **Test connection**, then **Save**.

### Browser extension
1. Chrome: `chrome://extensions` > Developer mode > Load unpacked > `apps/extension`. Firefox: `about:debugging` > Load Temporary Add-on > `apps/extension/manifest.json`.
2. Copy the token from Desk > Settings > Browser extension into the extension's options page.

## Using Nib
- Click Nib for the menu. Drag the grey handle under Nib to move it.
- Drop a link on Nib to bookmark it, or drop text to make a note.
- `Ctrl+Alt+H`: copy something, press it, and Quick add opens with your clipboard.
- `Ctrl+Alt+N`: show or hide Nib. The tray icon does the same.
- If Obsidian is closed, captures wait in a local queue (Nib gets sleepy and shows a count) and are filed when it is back.

## Phase 2 features
- **Feeds**: follow a blog, RSS/Atom feed, newsletter feed or YouTube channel/playlist link (the app finds the feed for you). Unread tracking, refresh every 30 minutes, Nib announces new items.
- **Reader**: opens any feed item or bookmark as a clean article (Readability, sanitised). Select text and send it as a highlight, or clip the whole article as markdown into Notes.
- **Subscriptions**: paid subscriptions as notes in `Subscriptions/` (cost, cycle, next renewal, status). Totals per currency, "Renewed" rolls the date forward, Nib reminds you 7 days and 1 day before a renewal.
- **Search**: one box over clippings, bookmarks, feed items and subscriptions (in-memory index built when the tab opens).

## AI helpers (optional, off until you add a key)
Settings > AI helpers supports Claude, GPT, Grok, Gemini, NVIDIA NIM, OpenCode and Ollama Cloud (hosted). Add a key for any of them, press **Load models** to pick a model (model names change often, so they are never hard-coded), and **Test**. Then:
- In the reader: **Summarize** and **Suggest tags**. Both are added to the note when you press Clip article.
- In Quick add: **Suggest tags with AI**.
- You choose which provider handles summaries and which handles tags. Text is sent only when you press a button. Keys live in Windows Credential Manager. Nib looks thoughtful while a request runs.
- Endpoints: Claude (Messages API), Ollama Cloud (`/api/chat`), all others via the OpenAI chat-completions format. You can override any address.

## Library: PDF and EPUB
Desk > Library > **Open a PDF or EPUB** (up to 200 MB). Books reopen where you left off.
- **PDF:** one page at a time with selectable text, page jump, zoom, arrow keys to turn pages. Scanned PDFs have no text to select (OCR comes later).
- **EPUB:** read by chapter with a contents list, text size and internal links. Content is sanitised; scripts never run.
- **Highlights:** select text (add an optional note first or after), press **Highlight selection**. The quote goes to Obsidian as `Clippings/<book>.md` with the page (`p. 12`) or chapter, and your note. The Highlights panel lists them and jumps back to the spot. Password-protected PDFs and DRM-protected EPUBs are not supported.

## Phase 3: files, screenshots, videos, threads
- **Drop files and pictures** on Nib (or choose or paste them in Quick add > File). The file is saved in `Attachments/` and a note in `Notes/` shows it. Files wait on your disk while Obsidian is closed. Up to 50 MB.
- **Screenshots:** `Ctrl+Alt+S` or Nib's menu > Snip a screenshot. Nib hides, the screen freezes, drag a box. The picture opens in Quick add with its text already read by Windows' built-in OCR (offline). Press **Read text with AI** to use your AI provider instead (this sends the picture to it). Windows needs an OCR language installed for the built-in engine.
- **YouTube:** paste or drop a video link. Quick add > Video or thread fetches the captions as a note with timestamps that link back to the moment. YouTube items in Feeds open the same way.
- **Threads:** Reddit, Hacker News, Mastodon and Bluesky links become a note with the post and replies. X (Twitter) cannot be read without logging in, so use the browser extension there.
- Pasting or dropping a YouTube or thread link on Nib opens Quick add ready to fetch it.

## Phase 4: voice notes, email, imports
- **Voice notes:** `Ctrl+Alt+V` or Nib's menu > Voice note. It records from your microphone (up to 10 minutes), lets you listen back, and turns it into text with OpenAI (Whisper) or Gemini. Edit the text, then save it as a note, with or without the recording itself. Other AI providers have no audio input here.
- **Email and newsletters:** Settings > Email. Give Nib an IMAP mailbox that is only for this (a new address with an app password), then forward emails or subscribe newsletters to it. New mail becomes a note in Notes with the sender, date and subject. Nib only reads: nothing is deleted, moved or marked read. Pictures are never downloaded. Optional sender allow-list. The first connection starts from now unless you tick "also import existing mail".
- **Import:** Desk > Import takes a Readwise CSV, Kindle `My Clippings.txt`, or a Pocket export (HTML or CSV). Highlights go into one note per book (with notes and locations), Pocket links become bookmarks with their tags and read state. Re-importing the same file adds nothing twice.

## How data is stored
The vault is the source of truth. One note per source in `Clippings/` (highlights appended with block ids, so retries never duplicate), bookmarks in `Bookmarks/`, notes in `Notes/`. The app only keeps the pending queue and settings in its app-data folder; the API key is kept in Windows Credential Manager.
