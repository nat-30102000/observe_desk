import { SearchIndex, listBookmarks, listSubscriptions, parseFrontmatter, type SearchDoc } from '@observe/core';
import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '../platform';
import { loadSettings, makeClient } from '../service';
import { useFeeds } from './Feeds';

const MAX_CLIPPINGS = 300;

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

const KIND_LABEL: Record<SearchDoc['kind'], string> = { bookmark: 'Bookmark', feed: 'Feed item', subscription: 'Subscription', clipping: 'Clipping' };

export function Search() {
  const feeds = useFeeds();
  const index = useMemo(() => new SearchIndex(), []);
  const [ready, setReady] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Feed items arrive from Nib's window and are already local.
  useEffect(() => {
    index.replaceKind('feed', feeds.items.map((i) => ({ id: `${i.feedId}:${i.id}`, kind: 'feed', title: i.title, text: i.summary, url: i.url })));
    setReady((n) => n + 1);
  }, [feeds.items, index]);

  // Everything that lives in the vault is read once when the tab opens.
  useEffect(() => {
    let live = true;
    void (async () => {
      const settings = await loadSettings();
      const client = await makeClient(settings);
      if (!client) return setNote('Add your Obsidian API key in Settings to search your vault too.');
      try {
        const [marks, subs, files] = await Promise.all([listBookmarks(client, settings.folders), listSubscriptions(client, settings.folders), client.listDir(settings.folders.clippings)]);
        if (!live) return;
        index.replaceKind('bookmark', marks.map((b) => ({ id: b.path, kind: 'bookmark', title: b.title, text: `${b.description ?? ''} ${b.tags.join(' ')} ${b.url}`, url: b.url })));
        index.replaceKind('subscription', subs.map((s) => ({ id: s.service, kind: 'subscription', title: s.service, text: `${s.category ?? ''} ${s.notes ?? ''} ${s.cycle} ${s.status}`, url: s.url })));
        const clips: SearchDoc[] = [];
        for (const f of files.filter((x) => x.endsWith('.md')).slice(0, MAX_CLIPPINGS)) {
          const path = `${settings.folders.clippings.replace(/\/+$/, '')}/${f}`;
          const text = await client.getNote(path);
          if (text === null) continue;
          const { data, body } = parseFrontmatter(text);
          clips.push({ id: path, kind: 'clipping', title: typeof data['title'] === 'string' ? data['title'] : f.replace(/\.md$/, ''), text: body, url: typeof data['url'] === 'string' ? data['url'] : undefined });
        }
        if (!live) return;
        index.replaceKind('clipping', clips);
        if (files.length > MAX_CLIPPINGS) setNote(`Searching the first ${MAX_CLIPPINGS} clippings.`);
        setReady((n) => n + 1);
      } catch {
        setNote('Obsidian is not reachable, so only feed items are searchable right now.');
      }
    })();
    return () => {
      live = false;
    };
  }, [index]);

  const results = useMemo(() => index.search(query), [index, query, ready]);

  return (
    <section>
      <header className="bar">
        <h1>Search</h1>
        <input className="search wide" autoFocus aria-label="Search everything" placeholder="Search clippings, bookmarks, feeds and subscriptions" value={query} onChange={(e) => setQuery(e.target.value)} />
      </header>
      {note && <p className="muted">{note}</p>}
      {query.trim() !== '' && results.length === 0 && <p className="muted">Nothing found for "{query}".</p>}
      <ul className="cards">
        {results.map((r) => (
          <li key={`${r.kind}:${r.id}`} className="card">
            <div className="meta">{KIND_LABEL[r.kind]}</div>
            <div className="title">{r.title}</div>
            <div className="snippet">{r.text.slice(0, 160)}</div>
            {r.url && <button className="btn small" onClick={() => void openExternal(r.url!)}>Open link</button>}
            {r.kind === 'clipping' && <div className="mono">{r.id}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
