import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLDERS, ObsidianClient, SearchIndex, addCycle, discoverFeedUrl, dueReminders, listSubscriptions, mergeItems,
  parseFeed, parseSubscription, renderSubscription, saveSubscription, totals, upcomingRenewal, youtubeFeedUrl, type Subscription,
} from '../src';
import { FakeVault } from './fakeVault';

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title>Aeon</title><link>https://aeon.co</link>
<item><title>First &amp; best</title><link>https://aeon.co/a</link><guid isPermaLink="false">id-a</guid><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate><dc:creator>Mara</dc:creator><description>&lt;p&gt;Short &lt;b&gt;teaser&lt;/b&gt;&lt;/p&gt;</description><content:encoded><![CDATA[<p>Full <b>body</b></p>]]></content:encoded></item>
<item><title>Second</title><link>/b</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>Database Notes</title><link rel="alternate" href="https://youtube.com/channel/x"/>
<entry><id>yt:video:1</id><title>Indexes</title><link rel="alternate" href="https://youtube.com/watch?v=1"/><published>2026-10-05T08:00:00+00:00</published><author><name>DB</name></author><media:group><media:description>How B-trees work</media:description></media:group></entry>
<entry><id>two</id><title>Only one link</title><link href="https://example.com/two"/><updated>2026-10-04T08:00:00Z</updated><summary>Sum</summary></entry></feed>`;

describe('parseFeed', () => {
  it('reads RSS 2.0 with entities, content:encoded and relative links', () => {
    const f = parseFeed(RSS, 'https://aeon.co/feed');
    expect(f).toMatchObject({ title: 'Aeon', siteUrl: 'https://aeon.co' });
    expect(f.items[0]).toMatchObject({ id: 'id-a', title: 'First & best', author: 'Mara', summary: 'Short teaser', contentHtml: '<p>Full <b>body</b></p>' });
    expect(f.items[0]?.published).toBe('2026-10-06T10:00:00.000Z');
    expect(f.items[1]).toMatchObject({ url: 'https://aeon.co/b', id: 'https://aeon.co/b' });
  });
  it('reads Atom and YouTube style entries', () => {
    const f = parseFeed(ATOM);
    expect(f.items).toHaveLength(2);
    expect(f.items[0]).toMatchObject({ id: 'yt:video:1', url: 'https://youtube.com/watch?v=1', author: 'DB', summary: 'How B-trees work' });
    expect(f.items[1]).toMatchObject({ url: 'https://example.com/two', summary: 'Sum' });
  });
  it('handles a single item (not an array) and rejects non-feeds', () => {
    const one = '<rss><channel><title>T</title><item><title>X</title><link>https://a.com/x</link></item></channel></rss>';
    expect(parseFeed(one).items).toHaveLength(1);
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(/feed/);
    expect(() => parseFeed('')).toThrow();
  });
});

describe('feed discovery', () => {
  it('finds the alternate feed link and resolves it', () => {
    const html = '<head><link rel="alternate" type="application/rss+xml" href="/feed.xml?a=1&amp;b=2"></head>';
    expect(discoverFeedUrl(html, 'https://site.com/blog/')).toBe('https://site.com/feed.xml?a=1&b=2');
    expect(discoverFeedUrl('<head></head>', 'https://x.com')).toBeNull();
  });
  it('maps YouTube channels and playlists to feeds', () => {
    const id = 'UC' + 'a'.repeat(22);
    expect(youtubeFeedUrl(`https://www.youtube.com/channel/${id}`)).toContain(`channel_id=${id}`);
    expect(youtubeFeedUrl('https://www.youtube.com/playlist?list=PL123')).toContain('playlist_id=PL123');
    expect(youtubeFeedUrl('https://example.com')).toBeNull();
  });
});

describe('mergeItems', () => {
  it('keeps read state, counts new items, and caps the list', () => {
    const a = parseFeed(RSS, 'https://aeon.co').items;
    const first = mergeItems('f1', [], a, '2026-10-07T00:00:00Z');
    expect(first.added).toBe(2);
    first.items.find((i) => i.id === 'id-a')!.read = true;
    const again = mergeItems('f1', first.items, a, '2026-10-08T00:00:00Z');
    expect(again.added).toBe(0);
    expect(again.items.find((i) => i.id === 'id-a')?.read).toBe(true);
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, title: 't', url: 'https://x.com', summary: '', published: new Date(2026, 0, 1 + (i % 28), i).toISOString() }));
    expect(mergeItems('f', [], many, 'x').items).toHaveLength(200);
  });
});

const sub = (over: Partial<Subscription> = {}): Subscription => ({ service: 'Notion', cost: 10, currency: 'USD', cycle: 'monthly', nextRenewal: '2026-10-12', status: 'active', ...over });

describe('subscriptions', () => {
  it('adds cycles and clamps month ends', () => {
    expect(addCycle('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(addCycle('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(addCycle('2026-10-12', 'yearly')).toBe('2027-10-12');
    expect(addCycle('2026-10-12', 'quarterly')).toBe('2027-01-12');
    expect(addCycle('2026-10-12', 'weekly')).toBe('2026-10-19');
  });
  it('rolls a stale renewal date forward', () => {
    expect(upcomingRenewal({ nextRenewal: '2026-07-12', cycle: 'monthly' }, '2026-10-07')).toBe('2026-10-12');
    expect(upcomingRenewal({ nextRenewal: '2026-10-07', cycle: 'monthly' }, '2026-10-07')).toBe('2026-10-07');
  });
  it('totals per currency and ignores cancelled', () => {
    const t = totals([sub(), sub({ service: 'Sync', cost: 96, cycle: 'yearly' }), sub({ service: 'Old', cost: 99, status: 'cancelled' }), sub({ service: 'Eur', cost: 5, currency: 'EUR' })]);
    expect(t).toEqual([{ currency: 'USD', monthly: 18, yearly: 216 }, { currency: 'EUR', monthly: 5, yearly: 60 }]);
  });
  it('reminds 7 and 1 days before, never for cancelled', () => {
    const subs = [sub({ nextRenewal: '2026-10-14' }), sub({ service: 'B', nextRenewal: '2026-10-08' }), sub({ service: 'C', nextRenewal: '2026-10-10' }), sub({ service: 'D', nextRenewal: '2026-10-14', status: 'cancelled' })];
    expect(dueReminders(subs, '2026-10-07').map((r) => [r.service, r.days])).toEqual([['B', 1], ['Notion', 7]]);
  });
  it('round-trips through a note and rejects other notes', () => {
    const s = sub({ category: 'Productivity', url: 'https://notion.so', notes: 'Team plan' });
    expect(parseSubscription(renderSubscription(s))).toEqual(s);
    expect(parseSubscription('---\ntype: bookmark\n---\nx')).toBeNull();
    expect(parseSubscription('---\ntype: subscription\ncost: abc\n---\n')).toBeNull();
  });
  it('saves and lists subscriptions in the vault', async () => {
    const vault = new FakeVault();
    const client = new ObsidianClient({ baseUrl: 'https://127.0.0.1:27124', apiKey: 'secret' }, vault.fetch);
    await saveSubscription(client, DEFAULT_FOLDERS, sub());
    await saveSubscription(client, DEFAULT_FOLDERS, sub({ service: 'Obsidian Sync', cost: 96, cycle: 'yearly', nextRenewal: '2027-01-03' }));
    await saveSubscription(client, DEFAULT_FOLDERS, sub({ cost: 12 })); // edit replaces
    const list = await listSubscriptions(client, DEFAULT_FOLDERS);
    expect(list.map((s) => [s.service, s.cost])).toEqual([['Notion', 12], ['Obsidian Sync', 96]]);
  });
});

describe('SearchIndex', () => {
  const idx = new SearchIndex();
  idx.replaceKind('bookmark', [{ id: '1', kind: 'bookmark', title: 'Tauri 2 plugin guide', text: 'global shortcut tray', url: 'https://tauri.app' }]);
  idx.replaceKind('feed', [{ id: '2', kind: 'feed', title: 'Local-first software', text: 'sync data on your device and plugin ideas' }]);
  it('requires every word, matches prefixes, ranks titles first', () => {
    expect(idx.search('plugin').map((d) => d.id)).toEqual(['1', '2']);
    expect(idx.search('tauri plug')).toHaveLength(1);
    expect(idx.search('tauri banana')).toHaveLength(0);
    expect(idx.search('   ')).toEqual([]);
  });
  it('replaces one kind without touching others', () => {
    idx.replaceKind('feed', []);
    expect(idx.size).toBe(1);
  });
});
