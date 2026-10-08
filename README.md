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

## How data is stored
The vault is the source of truth. One note per source in `Clippings/` (highlights appended with block ids, so retries never duplicate), bookmarks in `Bookmarks/`, notes in `Notes/`. The app only keeps the pending queue and settings in its app-data folder; the API key is kept in Windows Credential Manager.
