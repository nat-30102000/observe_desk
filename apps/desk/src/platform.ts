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

export const obsidianFetch: FetchLike = async (url, init) => {
  if (isTauri()) {
    const r = await invoke<{ status: number; body: string }>('obsidian_fetch', {
      req: { url, method: init.method, headers: init.headers, body: init.body ?? null },
    });
    return { status: r.status, text: async () => r.body };
  }
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });
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
      req: { url, method: init.method, headers: init.headers, body: init.body ?? null },
    });
    return { status: r.status, text: async () => r.body };
  }
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { status: r.status, text: () => r.text() };
};
