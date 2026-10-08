# Windows build and test checklist

Nothing in this repo has been run on Windows yet. This list is the first real test. Work top to bottom: if a step fails, stop, note it (see "What to send back" at the end), and carry on with the parts that do not depend on it.

## 0. What you need

- Windows 10 (build 1809 or later) or Windows 11, 64-bit
- **Node.js 20 or newer** (`node -v`)
- **Rust stable** via rustup, with the MSVC toolchain (`rustc -V`, `rustup show` should say `stable-x86_64-pc-windows-msvc`)
- **Visual Studio Build Tools** with the "Desktop development with C++" workload
- **WebView2 Runtime** (already on Windows 11 and most up-to-date Windows 10; if the app opens to a blank window, install it from Microsoft)
- **Obsidian** with the **Local REST API** plugin installed and enabled (Settings > Community plugins). Copy its API key.
- Optional, for later sections: a Chrome or Firefox browser, an OpenAI or Gemini key (voice notes), any AI provider key, a spare mailbox with IMAP and an app password, a PDF and an EPUB, a Kindle `My Clippings.txt` / Readwise CSV / Pocket export, a microphone, a second monitor

Use a **throwaway vault** for the first run, so nothing precious is touched.

## 1. Build

```powershell
git clone https://github.com/nat-30102000/observe_desk
cd observe_desk
git checkout claude/obsidian-desktop-app-plan-q79ggg
npm install
npm test
npm run typecheck
```

- [ ] `npm install` finishes without errors
- [ ] `npm test`: all tests pass (about 122: 103 in `@observe/core`, 19 in `@observe/desk`)
- [ ] `npm run typecheck`: no errors

```powershell
npm run tauri -w @observe/desk dev
```

First Rust build takes several minutes.

- [ ] It compiles. **The Windows-only code has only been type-checked from Linux, so a compile error here is plausible**: `winshot.rs` (screen capture), `winocr.rs` (OCR), the `keyring` code in `storage.rs`, `snip.rs`
- [ ] A window with **Nib** (purple blob) appears near the bottom-right of the screen, with no frame, no background box and no taskbar button
- [ ] A tray icon appears (check the hidden-icons arrow)
- [ ] Press **F12** or **Ctrl+Shift+I** in a window to open DevTools. The Console shows **no red errors** (a blocked font or "Refused to ..." message points at the Content Security Policy)

Then the release build:

```powershell
npm run tauri -w @observe/desk build
```

- [ ] An installer appears under `apps\desk\src-tauri\target\release\bundle\nsis\`
- [ ] It installs and the installed app starts (Windows SmartScreen will warn: the installer is unsigned)

> From here on, test the installed app at least once. Some problems (paths, permissions, CSP) only show up in the release build.

## 2. Nib: window behaviour

- [ ] Nib bobs gently and stays on top of other windows
- [ ] Drag the grey handle under Nib: the window moves. Release: it stays
- [ ] Click Nib: a menu appears (Quick add, Voice note, Snip a screenshot, Open the Desk, Bookmarks, Hide Nib)
- [ ] The transparent area around Nib shows what is behind it, no white or black box
- [ ] **Ctrl+Alt+N** hides and shows Nib. Left-clicking the tray icon does the same
- [ ] Tray right-click menu: Show or hide Nib, Quick add, Open the Desk, Quit. **Quit** really exits (check Task Manager)
- [ ] Close the Desk window with its X: Nib keeps running
- [ ] Sleep/lock the PC and wake it: Nib is still there
- [ ] If you use a high-DPI display or display scaling over 100%: Nib is not blurry or cut off, and the menu is fully visible

**Single copy**
- [ ] With the app running, start it again (Start menu or the installed shortcut): no second Nib appears, and the Desk window comes to the front. Task Manager shows one `observe_desk.exe`
- [ ] Hide Nib (`Ctrl+Alt+N`), start the app again: Nib comes back and the Desk opens
- [ ] After **Quit** from the tray, starting the app works normally again

**Start with Windows**
- [ ] Desk > Settings > Startup: tick "Start Nib when I sign in to Windows". Task Manager > Startup apps (or `shell:startup` / the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` registry key) lists observe_desk
- [ ] Sign out and in (or restart): Nib appears by itself, the Desk stays closed, and the tray icon is there
- [ ] Untick it: the entry disappears from Startup apps
- [ ] Move or reinstall the app, then tick it again: it points at the new location

**Updates** (after the first signed release exists, see `RELEASING.md`)
- [ ] In a build made with `tauri build` **without** the release config (what you get from section 1), Desk > Settings > Updates says updates are only available in released builds
- [ ] In an installed release build: Settings > Updates shows the version, **Check for updates** says "You have the latest version"
- [ ] Publish a newer release: the old install shows it within a minute of **Check for updates**, Nib announces it once, and the Nib menu shows "Update to ..."
- [ ] **Update and restart**: progress shows, the app restarts on the new version, queued captures are still there
- [ ] Tamper test: a release whose `.sig` belongs to a different file must be rejected with a signature error

**Installer signing**
- [ ] Installer properties > Digital Signatures lists your name (only if you set up signing); `Get-AuthenticodeSignature` says Valid

Known gaps (not bugs to report, just things that do not exist yet): none of the above has been exercised end to end yet.

## 3. Connect Obsidian

1. In Obsidian, make sure the Local REST API plugin is enabled and note its API key. Its default address is `https://127.0.0.1:27124` (a self-signed certificate).
2. Nib menu > Open the Desk > Settings.

- [ ] Paste the key, press **Test connection**: "Connected (Local REST API x.y.z)"
- [ ] A wrong key says Obsidian did not accept it
- [ ] Press **Save**. The sidebar status turns green ("Connected to Obsidian")
- [ ] Close and reopen the app: the key is still there ("saved"). Open Windows **Credential Manager > Windows Credentials**: an entry with `observe_desk` in its name exists, and the key is **not** in `%APPDATA%\dev.observe-desk.app\settings.json`
- [ ] Close Obsidian completely: within about 30 seconds the sidebar says "Obsidian is closed" and Nib goes sleepy (Zzz)

## 4. Phase 1: capture

**Quick add (Nib menu > Quick add)**
- [ ] Highlight tab: paste a sentence and a link, Save. A note appears in `Clippings/` with the quote, a block id like `^h-1a2b3c4d`, and frontmatter
- [ ] Save a second highlight with the same link: it is **appended** to the same note
- [ ] Bookmark tab: a note appears in `Bookmarks/`. Saving the same link again does nothing
- [ ] Markdown tab: a note appears in `Notes/`

**Offline queue**
- [ ] Close Obsidian. Make two captures. Nib shows a small number badge (2) and looks sleepy. The Desk Inbox lists "Waiting for Obsidian (2)"
- [ ] Open Obsidian again. Within about 30 seconds both notes appear and Nib looks happy
- [ ] Press **Sync now** in the Inbox to force it

**Hotkey and clipboard**
- [ ] Copy some text in any app, press **Ctrl+Alt+H**: Quick add opens with that text. Copy a plain web link first: it opens on the Bookmark tab
- [ ] If nothing happens, another program may own the shortcut. Check the app's console output for "could not register Ctrl+Alt+H"

**Drop on Nib**
- [ ] Drag a link from a browser onto Nib: a bookmark is created. Drag selected text: a note is created. Nib looks like it is eating (open mouth)

## 5. Browser extension

- [ ] Chrome: `chrome://extensions`, Developer mode, **Load unpacked**, choose `apps\extension`. Firefox: `about:debugging`, This Firefox, **Load Temporary Add-on**, choose `apps\extension\manifest.json`
- [ ] In the app: Desk > Settings > Browser extension: copy the token. Paste it in the extension's options page, Save
- [ ] On any web page, select text, click the extension icon, **Save highlight**: the popup says "Nib has it!", the toolbar badge shows OK, and the note appears in Obsidian
- [ ] Right-click selected text > **Send selection to Nib**; right-click page > **Bookmark this page with Nib**; **Ctrl+Shift+H** on a page with text selected
- [ ] With the desktop app **closed**, the popup says it could not reach Nib
- [ ] A wrong token says Nib rejected it
- [ ] Browser DevTools on a normal website: `fetch('http://127.0.0.1:27125/capture', {method:'POST', body:'{}'})` must **fail** (CORS blocked, and no token). It should never create a note

## 6. Phase 2: feeds, reader, subscriptions, search

**Feeds**
- [ ] Desk > Feeds: paste a blog address (not the feed address), press Follow. The app finds the feed and lists items
- [ ] Paste a YouTube channel link (`https://www.youtube.com/@name` may not resolve; `https://www.youtube.com/channel/UC...` should): the channel's videos appear
- [ ] Click an item: the reader opens the article cleanly (no menus or ads). **Clip article** creates a note in `Notes/`. Select text, **Highlight selection** creates a highlight
- [ ] Links inside an article open in your normal browser, not inside the app

**Subscriptions**
- [ ] Add a subscription (for example 10 USD monthly, renewing in 7 days): a note appears in `Subscriptions/`, totals update
- [ ] Within an hour (or after restarting the app) Nib rings a bell: "Psst! ... renews in 7 days"
- [ ] **Renewed** moves the date forward one cycle

**Search**
- [ ] Desk > Search finds words from a clipping, a bookmark, a feed item and a subscription

## 7. AI helpers (needs at least one provider key)

- [ ] Settings > AI helpers: paste a key, **Save key**, **Load models**, pick a model, **Test**: shows a short working message
- [ ] Reader: **Summarize** gives bullet points; **Suggest tags** gives tag buttons. **Clip article** includes the summary and chosen tags in the note
- [ ] Quick add: **Suggest tags with AI** fills the tags field
- [ ] Nib looks thoughtful while it works
- [ ] A bad key shows "The provider rejected the API key"
- [ ] Try each provider you have a key for. **Please note which work.** Model names and the OpenCode and Ollama Cloud addresses are the least certain

## 8. Library: PDF and EPUB

- [ ] Desk > Library > **Open a PDF or EPUB** (the Windows file dialog opens). A PDF renders crisply, page buttons and zoom work, arrow keys turn pages
- [ ] Select text, add a note, **Highlight selection**: the note in `Clippings/` has `*p. N*` and your note
- [ ] An EPUB opens, the contents list works, the text size buttons work, internal links work
- [ ] Close and reopen the app, Library > **Continue reading**: it reopens at the same page or chapter
- [ ] If a PDF stays blank or the console mentions a worker or "Refused to create a worker": that is the Content Security Policy

## 9. Phase 3: files, screenshots, video, threads

**Files**
- [ ] Drag a file from Explorer onto Nib (try a picture, a PDF, a `.zip`): it goes into `Attachments/`, and a note in `Notes/` shows or links it
- [ ] Quick add > File: choose a file; also copy a picture and press Ctrl+V in Quick add
- [ ] With Obsidian closed, drop a file: it waits, then files itself when Obsidian returns
- [ ] Open the vault attachment in Obsidian and check it is **not corrupted** (open the picture or PDF)

**Screenshots** (the least tested part)
- [ ] **Ctrl+Alt+S** (or Nib menu > Snip a screenshot): Nib and other app windows disappear, the screen freezes with a dimmer overlay and a hint
- [ ] Drag a box: Quick add opens on the File tab with the cropped picture and text already read. Press **Esc** instead: everything comes back
- [ ] The crop matches exactly what you boxed (check on a second monitor and at 125% or 150% scaling, and with the box near screen edges)
- [ ] If the text is empty or an error mentions a language: install an OCR language in Windows (Settings > Time & language > Language & region > add a language with "Optical character recognition")
- [ ] **Read text with AI** (needs a key) works as an alternative
- [ ] After saving, Nib and your windows are back where they were

**YouTube and threads**
- [ ] Quick add > Video or thread: a normal YouTube link, **Fetch transcript**. Expect timestamps linking back to the video. **This may fail** because YouTube changes often. Please note the exact error
- [ ] A Hacker News link, a Reddit thread link, a Mastodon post link, a Bluesky post link: **Fetch thread** gives a note with replies. Note which work. Reddit sometimes refuses apps
- [ ] An X (Twitter) link: the app explains it cannot read it
- [ ] Drop a YouTube link on Nib: Quick add opens ready to fetch

## 10. Phase 4: voice, email, import

**Voice note**
- [ ] **Ctrl+Alt+V**: Quick add opens on Voice and recording starts. Windows may ask for microphone permission the first time
- [ ] The level meter moves while you talk; Nib shows the listening pose. Stop, play it back
- [ ] **Turn into text** (OpenAI or Gemini key): the text is right. Save: the vault gets the recording in `Attachments/` and a note with the transcript
- [ ] A blocked microphone gives a clear message (Windows Settings > Privacy > Microphone)
- [ ] Closing Quick add mid-recording turns the microphone light off

**Email** (use a spare mailbox)
- [ ] Settings > Email: server, port 993, your address, an **app password**, Test connection: "Connected. INBOX holds N messages." (This is the first time the **encrypted** connection is used. Please note if it fails and the exact message)
- [ ] Tick "Check this mailbox", Save. Send or forward a message to that mailbox. Within the interval (default 5 minutes) a note appears in `Notes/` with From, Date, Subject, and Nib says "You've got mail!"
- [ ] A newsletter has no images or tracking pixels in the note. An attachment is listed as "not saved"
- [ ] Nothing in the mailbox was deleted, moved or marked as read
- [ ] With "Only keep mail from" set, mail from other senders is ignored
- [ ] Restart the app: the same messages are **not** imported again

**Import**
- [ ] Desk > Import: choose your Kindle `My Clippings.txt`: the preview counts look plausible. Import. One note per book appears in `Clippings/`
- [ ] Readwise CSV and Pocket export the same way
- [ ] Import the same file again: no duplicates
- [ ] A large file (hundreds of items) keeps the app responsive; the Inbox counter goes down over time

## 11. Robustness spot checks

- [ ] Kill the app (Task Manager) in the middle of an import or while offline with queued items, restart: the queued items are still there and get filed
- [ ] Disconnect the network: feeds and AI fail with a clear message, nothing crashes
- [ ] Change the Obsidian API key in the plugin: Nib turns worried and says the key was rejected; captures are kept
- [ ] Use the app for an hour: memory in Task Manager stays reasonable (the pet window and the app together should stay well under a few hundred MB)

## What to send back

For each failure, please send:

1. The step number and what you expected versus what happened
2. A screenshot, if it is visual
3. The **Console** output from DevTools (F12 or Ctrl+Shift+I) in the affected window
4. For build errors: the full error text from the terminal
5. Windows version, display scaling, number of monitors
6. The log lines from running `npm run tauri -w @observe/desk dev` in a terminal (lines starting with "could not register", "extension bridge", "screenshot failed")

If everything in sections 1 to 4 works, the foundation is sound. Sections 8 to 10 contain the features that have had the least real-world checking (screenshots and OCR, encrypted IMAP, YouTube captions, the provider endpoints), so those are where I expect any surprises.
