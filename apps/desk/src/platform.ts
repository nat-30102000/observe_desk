import type { FetchLike } from '@observe/core';

/**
 * Everything that touches the OS goes through here. Inside Tauri it calls the Rust side; in a
 * plain browser (npm run dev) it falls back to web APIs so the UI can be developed without Tauri.
 */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd, args);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const obsidianFetch: FetchLike = async (url, init) => {
  if (isTauri()) {
    const r = await invoke<{ status: number; body: string }>('obsidian_fetch', {
      req: {
        url,
        method: init.method,
        headers: init.headers,
        body: init.bodyBytes ? null : (init.body ?? null),
        body_base64: init.bodyBytes ? toBase64(init.bodyBytes) : null,
      },
    });
    return { status: r.status, text: async () => r.body };
  }
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.bodyBytes ? (init.bodyBytes as unknown as BodyInit) : init.body, signal: init.signal });
  return { status: r.status, text: () => r.text() };
};

export async function loadJson<T>(name: string): Promise<T | null> {
  const text = isTauri() ? await invoke<string | null>('load_json', { name }) : localStorage.getItem(`observe.${name}`);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function saveJson(name: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  if (isTauri()) await invoke<void>('save_json', { name, text });
  else localStorage.setItem(`observe.${name}`, text);
}

export async function getSecret(name: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string | null>('secret_get', { name });
    } catch {
      // Not on Windows: fall through to the dev fallback below.
    }
  }
  return localStorage.getItem(`observe.secret.${name}`);
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (isTauri()) {
    try {
      return await invoke<void>('secret_set', { name, value });
    } catch {
      // Not on Windows: fall through to the dev fallback below.
    }
  }
  if (value) localStorage.setItem(`observe.secret.${name}`, value);
  else localStorage.removeItem(`observe.secret.${name}`);
}

export async function showWindow(label: string): Promise<void> {
  if (isTauri()) await invoke<void>('show_window', { label });
}

export async function hideWindow(label: string): Promise<void> {
  if (isTauri()) await invoke<void>('hide_window', { label });
}

export async function extensionToken(): Promise<string | null> {
  return isTauri() ? invoke<string>('extension_token') : null;
}

export async function readClipboardText(): Promise<string> {
  if (isTauri()) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    return (await readText()) ?? '';
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

/** Which window this webview is: pet, quickadd or desk. */
export function currentView(): string {
  return new URLSearchParams(window.location.search).get('view') ?? 'desk';
}

type Handler<T> = (payload: T) => void;

/** Messages between windows. Tauri events in the app, BroadcastChannel in a browser. */
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('observe-desk') : null;

export async function emitBus(name: string, payload?: unknown): Promise<void> {
  if (isTauri()) {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(`bus:${name}`, payload ?? null);
  } else channel?.postMessage({ name, payload });
}

export async function listenBus<T>(name: string, handler: Handler<T>): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(`bus:${name}`, (e) => handler(e.payload));
  }
  const fn = (e: MessageEvent<{ name: string; payload: T }>) => {
    if (e.data.name === name) handler(e.data.payload);
  };
  channel?.addEventListener('message', fn as EventListener);
  return () => channel?.removeEventListener('message', fn as EventListener);
}

/** Events raised by the Rust side (hotkey, extension). */
export async function listenNative<T>(name: string, handler: Handler<T>): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(name, (e) => handler(e.payload));
}

export interface HttpResult {
  status: number;
  body: string;
  finalUrl: string;
}

/** Fetch a feed or web page. Goes through Rust in the app (no CORS); plain fetch in a browser. */
export async function httpGet(url: string): Promise<HttpResult> {
  if (isTauri()) {
    const r = await invoke<{ status: number; body: string; final_url: string }>('http_get', { url });
    return { status: r.status, body: r.body, finalUrl: r.final_url };
  }
  const r = await fetch(url);
  return { status: r.status, body: await r.text(), finalUrl: r.url || url };
}

/** Calls to hosted AI providers. Through Rust in the app, because providers block browser origins. */
export const aiFetch: FetchLike = async (url, init) => {
  if (isTauri()) {
    const r = await invoke<{ status: number; body: string }>('http_request', {
      req: {
        url,
        method: init.method,
        headers: init.headers,
        body: init.bodyBytes ? null : (init.body ?? null),
        body_base64: init.bodyBytes ? toBase64(init.bodyBytes) : null,
      },
    });
    return { status: r.status, text: async () => r.body };
  }
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.bodyBytes ? (init.bodyBytes as unknown as BodyInit) : init.body });
  return { status: r.status, text: () => r.text() };
};

export interface PickedBook {
  /** Only available through the desktop file dialog. */
  path?: string;
  name: string;
  bytes: Uint8Array;
}

/** Read a book by path (desktop app only). */
export async function readBook(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>('read_book', { path });
  return new Uint8Array(buf);
}

/** Let the user choose a .pdf or .epub. Null if they cancel. */
export async function pickBook(): Promise<PickedBook | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Books', extensions: ['pdf', 'epub'] }] });
    if (typeof path !== 'string') return null;
    return { path, name: path.split(/[\\/]/).pop() ?? path, bytes: await readBook(path) };
  }
  // Browser (dev) fallback.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.epub';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** For public web APIs (YouTube, Reddit, Hacker News...). Same Rust path as AI calls: https only. */
export const webFetch: FetchLike = (url, init) => aiFetch(url, init);

// ---------- staged files (dropped files wait here until Obsidian can take them) ----------

export async function stageFile(id: string, bytes: Uint8Array): Promise<void> {
  if (isTauri()) {
    const { invoke: inv } = await import('@tauri-apps/api/core');
    await inv('stage_file', bytes, { headers: { 'x-file-id': id } });
  } else localStorage.setItem(`observe.staged.${id}`, toBase64(bytes)); // dev only, small files
}

export async function readStaged(id: string): Promise<Uint8Array> {
  if (isTauri()) return new Uint8Array(await invoke<ArrayBuffer>('read_staged', { id }));
  const b64 = localStorage.getItem(`observe.staged.${id}`);
  if (b64 === null) throw new Error('The staged file is missing.');
  return fromBase64(b64);
}

export async function removeStaged(id: string): Promise<void> {
  if (isTauri()) await invoke<void>('remove_staged', { id });
  else localStorage.removeItem(`observe.staged.${id}`);
}

/** Windows' built-in offline OCR on a staged PNG. */
export async function ocrStaged(id: string): Promise<string> {
  if (!isTauri()) throw new Error('Built-in text recognition is only available in the Windows app.');
  return invoke<string>('ocr_staged', { id });
}

export const fileStore = { read: readStaged, remove: removeStaged };

// ---------- screenshots ----------

export async function snipStart(): Promise<void> {
  await invoke<void>('snip_start');
}

export async function snipImage(): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('snip_image'));
}

export async function snipClose(): Promise<void> {
  if (isTauri()) await invoke<void>('snip_close');
}

export interface MailConfig {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  folder: string;
}

export interface MailBatch {
  uid_validity: number;
  last_uid: number;
  messages: Array<{ uid: number; raw_base64: string }>;
  skipped: number[];
  more: boolean;
  exists: number;
}

/** New mail since `afterUid` (desktop app only). With no saved position it just reports the mailbox. */
export async function imapFetch(cfg: MailConfig, uidValidity: number | null, afterUid: number | null, limit: number): Promise<MailBatch> {
  if (!isTauri()) throw new Error('Reading email is only available in the desktop app.');
  return invoke<MailBatch>('imap_fetch', { cfg, uidValidity, afterUid, limit });
}

// ---------- start with Windows ----------

export async function autostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}

export async function setAutostart(on: boolean): Promise<void> {
  const { enable, disable } = await import('@tauri-apps/plugin-autostart');
  await (on ? enable() : disable());
}
