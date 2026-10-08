import {
  discoverFeedUrl,
  mergeItems,
  newId,
  parseFeed,
  youtubeFeedUrl,
  type FeedItem,
  type StoredFeed,
} from '@observe/core';
import { emitBus, httpGet, listenBus, loadJson, saveJson } from './platform';

export interface FeedsState {
  feeds: StoredFeed[];
  items: FeedItem[];
  busy: boolean;
  error: string | null;
}

export const INITIAL_FEEDS: FeedsState = { feeds: [], items: [], busy: false, error: null };
const REFRESH_EVERY_MS = 30 * 60_000;

/** Fetch a URL and return the feed it is, or the feed it advertises. */
export async function resolveFeed(input: string): Promise<{ url: string; xml: string }> {
  const direct = youtubeFeedUrl(input) ?? input.trim();
  const first = await httpGet(direct);
  if (first.status >= 400) throw new Error(`The site answered ${first.status}.`);
  if (/<(rss|feed|rdf:RDF)\b/i.test(first.body.slice(0, 2000))) return { url: first.finalUrl, xml: first.body };
  const found = discoverFeedUrl(first.body, first.finalUrl);
  if (!found) throw new Error('No feed found at that address.');
  const second = await httpGet(found);
  if (second.status >= 400) throw new Error(`The feed answered ${second.status}.`);
  return { url: second.finalUrl, xml: second.body };
}

/**
 * Owns feeds.json. Lives in the pet window (the only always-running window), so there is a single
 * writer. The Desk sends commands over the bus and receives the whole state back.
 */
export class FeedService {
  state: FeedsState = INITIAL_FEEDS;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unlisten: Array<() => void> = [];

  constructor(private readonly say: (text: string) => void) {}

  private publish(patch: Partial<FeedsState>): void {
    this.state = { ...this.state, ...patch };
    void emitBus('feeds:state', this.state);
  }

  private async persist(): Promise<void> {
    await saveJson('feeds', { feeds: this.state.feeds, items: this.state.items });
  }

  async start(): Promise<void> {
    const saved = await loadJson<{ feeds: StoredFeed[]; items: FeedItem[] }>('feeds');
    if (saved) this.state = { ...this.state, feeds: saved.feeds ?? [], items: saved.items ?? [] };
    this.unlisten.push(
      await listenBus<string>('feeds:add', (url) => void this.add(url)),
      await listenBus<string>('feeds:remove', (id) => void this.remove(id)),
      await listenBus<void>('feeds:refresh', () => void this.refreshAll(false)),
      await listenBus<void>('feeds:state-request', () => void emitBus('feeds:state', this.state)),
      await listenBus<{ ids: string[]; read: boolean }>('feeds:read', (m) => void this.markRead(m.ids, m.read)),
    );
    this.timer = setInterval(() => void this.refreshAll(true), REFRESH_EVERY_MS);
    this.publish({});
    void this.refreshAll(true);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.unlisten.forEach((u) => u());
  }

  async add(input: string): Promise<void> {
    this.publish({ busy: true, error: null });
    try {
      const { url, xml } = await resolveFeed(input);
      if (this.state.feeds.some((f) => f.url === url)) throw new Error('You already follow that feed.');
      const parsed = parseFeed(xml, url);
      const feed: StoredFeed = { id: newId(), url, title: parsed.title, siteUrl: parsed.siteUrl, addedAt: new Date().toISOString(), lastFetched: new Date().toISOString() };
      // Items that exist when you subscribe are not news: start them as read except the newest few.
      const now = new Date().toISOString();
      const merged = mergeItems(feed.id, [], parsed.items, now);
      const items = merged.items.map((i, idx) => ({ ...i, read: idx >= 5 }));
      this.publish({ feeds: [...this.state.feeds, feed], items: [...this.state.items, ...items] });
      await this.persist();
    } catch (e) {
      this.publish({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.publish({ busy: false });
    }
  }

  async remove(id: string): Promise<void> {
    this.publish({ feeds: this.state.feeds.filter((f) => f.id !== id), items: this.state.items.filter((i) => i.feedId !== id) });
    await this.persist();
  }

  async markRead(ids: string[], read: boolean): Promise<void> {
    const set = new Set(ids);
    this.publish({ items: this.state.items.map((i) => (set.has(`${i.feedId}:${i.id}`) ? { ...i, read } : i)) });
    await this.persist();
  }

  /** `quiet` = background refresh: Nib announces new items. */
  async refreshAll(quiet: boolean): Promise<void> {
    if (this.state.busy || this.state.feeds.length === 0) return;
    this.publish({ busy: true, error: null });
    let addedTotal = 0;
    let feeds = this.state.feeds;
    let items = this.state.items;
    for (const feed of this.state.feeds) {
      try {
        const res = await httpGet(feed.url);
        if (res.status >= 400) throw new Error(`answered ${res.status}`);
        const parsed = parseFeed(res.body, feed.url);
        const mine = items.filter((i) => i.feedId === feed.id);
        const merged = mergeItems(feed.id, mine, parsed.items, new Date().toISOString());
        addedTotal += merged.added;
        items = [...items.filter((i) => i.feedId !== feed.id), ...merged.items];
        feeds = feeds.map((f) => (f.id === feed.id ? { ...f, title: parsed.title, lastFetched: new Date().toISOString(), lastError: undefined } : f));
      } catch (e) {
        feeds = feeds.map((f) => (f.id === feed.id ? { ...f, lastError: e instanceof Error ? e.message : String(e) } : f));
      }
    }
    this.publish({ feeds, items, busy: false });
    await this.persist();
    if (quiet && addedTotal > 0) this.say(`Extra, extra! ${addedTotal} new ${addedTotal === 1 ? 'item' : 'items'} in your feeds.`);
  }
}
