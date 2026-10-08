import { useEffect, useMemo, useState } from 'react';
import { INITIAL_FEEDS, type FeedsState } from '../feedService';
import { emitBus, listenBus } from '../platform';
import { Reader } from './Reader';

export function useFeeds(): FeedsState {
  const [state, setState] = useState<FeedsState>(INITIAL_FEEDS);
  useEffect(() => {
    let off = () => undefined as void;
    void listenBus<FeedsState>('feeds:state', setState).then((u) => {
      off = u;
      void emitBus('feeds:state?');
    });
    return () => off();
  }, []);
  return state;
}

const keyOf = (i: { feedId: string; id: string }) => `${i.feedId}:${i.id}`;

export function Feeds() {
  const feeds = useFeeds();
  const [feedId, setFeedId] = useState<string | 'all'>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const unread = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of feeds.items) if (!i.read) m.set(i.feedId, (m.get(i.feedId) ?? 0) + 1);
    return m;
  }, [feeds.items]);

  const shown = feeds.items
    .filter((i) => feedId === 'all' || i.feedId === feedId)
    .filter((i) => !unreadOnly || !i.read)
    .sort((a, b) => (b.published ?? b.firstSeen).localeCompare(a.published ?? a.firstSeen))
    .slice(0, 150);
  const open = feeds.items.find((i) => keyOf(i) === openKey) ?? null;
  const feedName = (id: string) => feeds.feeds.find((f) => f.id === id)?.title ?? '';

  const openItem = (i: (typeof feeds.items)[number]) => {
    setOpenKey(keyOf(i));
    if (!i.read) void emitBus('feeds:read', { ids: [keyOf(i)], read: true });
  };

  return (
    <section>
      <header className="bar">
        <h1>Feeds</h1>
        <form
          className="addfeed"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void emitBus('feeds:add', url.trim());
            setUrl('');
          }}
        >
          <input aria-label="Feed or website address" placeholder="Paste a site, feed or YouTube channel link" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn primary" disabled={feeds.busy}>Follow</button>
        </form>
        <button className="btn" onClick={() => void emitBus('feeds:refresh')} disabled={feeds.busy}>{feeds.busy ? 'Working...' : 'Refresh'}</button>
      </header>
      {feeds.error && <p className="error" role="alert">{feeds.error}</p>}

      <div className="chips" role="tablist" aria-label="Sources">
        <button className={feedId === 'all' ? 'chip on' : 'chip'} onClick={() => setFeedId('all')}>All <span>{[...unread.values()].reduce((a, b) => a + b, 0)}</span></button>
        {feeds.feeds.map((f) => (
          <button key={f.id} className={feedId === f.id ? 'chip on' : 'chip'} onClick={() => setFeedId(f.id)} title={f.lastError ? `Last refresh failed: ${f.lastError}` : f.url}>
            {f.lastError ? '! ' : ''}{f.title} <span>{unread.get(f.id) ?? 0}</span>
          </button>
        ))}
        <button className={unreadOnly ? 'chip on' : 'chip'} aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>Unread only</button>
        {feedId !== 'all' && <button className="chip" onClick={() => { void emitBus('feeds:remove', feedId); setFeedId('all'); }}>Unfollow</button>}
      </div>

      {feeds.feeds.length === 0 ? (
        <p className="muted">You are not following anything yet. Paste a blog, newsletter feed or YouTube channel link above.</p>
      ) : (
        <div className="split">
          <ul className="cards items">
            {shown.length === 0 && <li className="muted">Nothing here.</li>}
            {shown.map((i) => (
              <li key={keyOf(i)}>
                <button className={`card item${keyOf(i) === openKey ? ' sel' : ''}${i.read ? ' read' : ''}`} onClick={() => openItem(i)}>
                  <span className="meta">{feedName(i.feedId)}{i.published ? ` · ${new Date(i.published).toLocaleDateString()}` : ''}</span>
                  <span className="title">{!i.read && <span className="dot ok" />} {i.title}</span>
                  <span className="snippet">{i.summary}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="reader-pane">
            {open ? <Reader key={keyOf(open)} url={open.url} title={open.title} fallbackHtml={open.contentHtml ?? (open.summary ? `<p>${open.summary.replace(/</g, '&lt;')}</p>` : undefined)} /> : <p className="muted">Pick an item to read it here.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
