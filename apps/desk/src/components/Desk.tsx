import {
  AuthError,
  ObsidianClient,
  OfflineError,
  listBookmarks,
  type BookmarkEntry,
} from '@observe/core';
import { useCallback, useEffect, useState } from 'react';
import {
  emitBus,
  extensionToken,
  getSecret,
  isTauri,
  listenBus,
  obsidianFetch,
  saveJson,
  setSecret,
  showWindow,
} from '../platform';
import { KEY_SECRET, loadSettings, makeClient } from '../service';
import { INITIAL_STATE, type AppState, type Settings } from '../state';
import { Nib } from './Nib';

type Tab = 'inbox' | 'bookmarks' | 'settings';

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

function useAppState(): AppState {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  useEffect(() => {
    let off = () => undefined as void;
    void listenBus<AppState>('state', setState).then((u) => {
      off = u;
      void emitBus('state?');
    });
    return () => off();
  }, []);
  return state;
}

export function Desk() {
  const [tab, setTab] = useState<Tab>('inbox');
  const state = useAppState();

  useEffect(() => {
    let off = () => undefined as void;
    void listenBus<Tab>('desk:goto', setTab).then((u) => (off = u));
    return () => off();
  }, []);

  const status = !state.configured ? 'Add your Obsidian API key' : state.authError ? 'API key rejected' : state.offline ? 'Obsidian is closed' : state.connected ? 'Connected to Obsidian' : 'Checking...';
  const statusClass = state.connected && !state.offline && !state.authError ? 'ok' : 'warn';

  return (
    <div className="desk">
      <nav className="side" aria-label="Main">
        <div className="brand"><span className="logo"><Nib mood="idle" size={26} /></span>observe_desk</div>
        {(['inbox', 'bookmarks'] as const).map((t) => (
          <button key={t} className={tab === t ? 'nav on' : 'nav'} onClick={() => setTab(t)}>
            {t === 'inbox' ? 'Inbox' : 'Bookmarks'}
            {t === 'inbox' && state.pending > 0 && <span className="count">{state.pending}</span>}
          </button>
        ))}
        <button className="nav" disabled title="Coming in the next phase">Feeds <span className="soon">soon</span></button>
        <button className="nav" disabled title="Coming in the next phase">Subscriptions <span className="soon">soon</span></button>
        <button className={tab === 'settings' ? 'nav on' : 'nav'} onClick={() => setTab('settings')}>Settings</button>
        <div className="status">
          <span className={`dot ${statusClass}`} />
          {status}
        </div>
      </nav>
      <main className="main">
        {tab === 'inbox' && <Inbox state={state} />}
        {tab === 'bookmarks' && <Bookmarks />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function Inbox({ state }: { state: AppState }) {
  return (
    <section>
      <header className="bar">
        <h1>Inbox</h1>
        <button className="btn primary" onClick={() => void showWindow('quickadd')}>+ Quick add</button>
        <button className="btn" onClick={() => void emitBus('sync')}>Sync now</button>
        {state.failed > 0 && <button className="btn" onClick={() => void emitBus('retry-failed')}>Retry failed</button>}
      </header>

      <h2>Waiting for Obsidian ({state.queue.length})</h2>
      {state.queue.length === 0 ? (
        <p className="muted">Nothing waiting. Everything has been filed.</p>
      ) : (
        <ul className="cards">
          {state.queue.map((q) => (
            <li key={q.id} className="card">
              <div className="meta">{q.kind}{q.failed ? ' · gave up' : q.attempts > 0 ? ` · tried ${q.attempts}x` : ''}</div>
              <div className="title">{q.title}</div>
              {q.lastError && <div className="error">{q.lastError}</div>}
            </li>
          ))}
        </ul>
      )}

      <h2>Recently filed</h2>
      {state.recent.length === 0 ? (
        <p className="muted">Highlights, bookmarks and notes you send to Nib show up here.</p>
      ) : (
        <ul className="cards">
          {state.recent.map((r) => (
            <li key={`${r.id}-${r.at}`} className="card">
              <div className="meta">{r.action} · {new Date(r.at).toLocaleTimeString()}</div>
              <div className="title">{r.title}</div>
              <div className="mono">{r.path}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Bookmarks() {
  const [items, setItems] = useState<BookmarkEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const settings = await loadSettings();
      const client = await makeClient(settings);
      if (!client) return setError('Add your Obsidian API key in Settings first.');
      setItems(await listBookmarks(client, settings.folders));
    } catch (e) {
      setItems(null);
      setError(e instanceof OfflineError ? 'Obsidian is not reachable. Open it and try again.' : e instanceof AuthError ? 'Obsidian rejected the API key.' : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const shown = (items ?? [])
    .filter((b) => !onlyUnread || !b.read)
    .filter((b) => !q || `${b.title} ${b.url} ${b.tags.join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => (b.captured ?? '').localeCompare(a.captured ?? ''));

  return (
    <section>
      <header className="bar">
        <h1>Bookmarks</h1>
        <input className="search" aria-label="Search bookmarks" placeholder="Search bookmarks" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={onlyUnread ? 'btn on' : 'btn'} aria-pressed={onlyUnread} onClick={() => setOnlyUnread((v) => !v)}>Unread only</button>
        <button className="btn" onClick={() => void load()}>Refresh</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {items && shown.length === 0 && <p className="muted">No bookmarks yet. Drop a link on Nib or use the browser extension.</p>}
      <div className="grid">
        {shown.map((b) => (
          <article key={b.path} className="card">
            <div className="meta">{new URL(b.url).hostname.replace(/^www\./, '')}{b.read ? '' : ' · unread'}</div>
            <h3>{b.title}</h3>
            {b.description && <p>{b.description}</p>}
            <div className="tags">{b.tags.filter((t) => t !== 'bookmarks').map((t) => <span key={t} className="tag">#{t}</span>)}</div>
            <button className="btn small" onClick={() => void openExternal(b.url)}>Open link</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void getSecret(KEY_SECRET).then((k) => setHasKey(!!k));
    void extensionToken().then(setToken);
  }, []);

  if (!settings) return null;
  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const setFolder = (name: keyof Settings['folders'], value: string) => set({ folders: { ...settings.folders, [name]: value } });

  const test = async () => {
    const apiKey = key || (await getSecret(KEY_SECRET)) || '';
    if (!apiKey) return setMessage({ ok: false, text: 'Enter your API key first (Obsidian > Settings > Local REST API).' });
    try {
      const s = await new ObsidianClient({ baseUrl: settings.baseUrl, apiKey }, obsidianFetch).status();
      setMessage(s.authenticated ? { ok: true, text: `Connected${s.version ? ` (Local REST API ${s.version})` : ''}.` } : { ok: false, text: 'Obsidian answered, but it did not accept this API key.' });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof OfflineError ? 'Could not reach Obsidian. Is it open with the Local REST API plugin enabled?' : String(e) });
    }
  };

  const save = async () => {
    await saveJson('settings', settings);
    if (key) {
      await setSecret(KEY_SECRET, key);
      setHasKey(true);
      setKey('');
    }
    await emitBus('settings-changed');
    setMessage({ ok: true, text: 'Saved.' });
  };

  return (
    <section className="settings">
      <header className="bar"><h1>Settings</h1></header>
      <div className="panel">
        <h2>Obsidian connection</h2>
        <label>REST API address<input value={settings.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></label>
        <label>
          API key {hasKey && <span className="muted">(saved; type a new one to replace it)</span>}
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </label>
        <div className="three">
          <label>Highlights folder<input value={settings.folders.clippings} onChange={(e) => setFolder('clippings', e.target.value)} /></label>
          <label>Bookmarks folder<input value={settings.folders.bookmarks} onChange={(e) => setFolder('bookmarks', e.target.value)} /></label>
          <label>Notes folder<input value={settings.folders.notes} onChange={(e) => setFolder('notes', e.target.value)} /></label>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void test()}>Test connection</button>
          <button className="btn primary" onClick={() => void save()}>Save</button>
        </div>
        {message && <p className={message.ok ? 'okmsg' : 'error'} role="status">{message.text}</p>}
      </div>
      <div className="panel">
        <h2>Browser extension</h2>
        <p className="muted">Paste this token into the extension's options page. It lets the extension talk to Nib on this computer only.</p>
        <input readOnly value={token ?? 'Available in the desktop app'} onFocus={(e) => e.currentTarget.select()} aria-label="Extension token" />
      </div>
      <div className="panel">
        <h2>Shortcuts</h2>
        <p><span className="kbd">Ctrl</span> <span className="kbd">Alt</span> <span className="kbd">H</span> copy-and-capture: opens Quick add with your clipboard</p>
        <p><span className="kbd">Ctrl</span> <span className="kbd">Alt</span> <span className="kbd">N</span> show or hide Nib</p>
      </div>
    </section>
  );
}
