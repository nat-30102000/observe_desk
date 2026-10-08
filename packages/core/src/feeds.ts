import { XMLParser } from 'fast-xml-parser';

export interface ParsedItem {
  /** Stable id: guid / atom id / link. */
  id: string;
  title: string;
  url: string;
  published?: string;
  author?: string;
  /** Plain text teaser (max 400 chars). */
  summary: string;
  /** Full html when the feed carries it. Untrusted: sanitise before display. */
  contentHtml?: string;
}

export interface ParsedFeed {
  title: string;
  siteUrl?: string;
  items: ParsedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  trimValues: true,
});

type Node = unknown;
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Text of a node that may be a string, a number, or { '#text', ...attrs }. */
function text(n: Node): string {
  if (n === undefined || n === null) return '';
  if (typeof n === 'string') return n.trim();
  if (typeof n === 'number' || typeof n === 'boolean') return String(n);
  if (Array.isArray(n)) return text(n[0]);
  if (typeof n === 'object') return text((n as Record<string, Node>)['#text']);
  return '';
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isoDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function resolve(url: string, base?: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function atomLink(links: Node, base?: string): string {
  const list = arr(links as Record<string, Node> | Record<string, Node>[]);
  const alt = list.find((l) => (l['@_rel'] ?? 'alternate') === 'alternate') ?? list[0];
  return alt ? resolve(text(alt['@_href']), base) : '';
}

const teaser = (html: string): string => htmlToText(html).slice(0, 400);

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom (including YouTube channel feeds). */
export function parseFeed(xml: string, feedUrl?: string): ParsedFeed {
  let doc: Record<string, Node>;
  try {
    doc = parser.parse(xml) as Record<string, Node>;
  } catch {
    throw new Error('This is not a valid feed.');
  }

  const rss = doc['rss'] as Record<string, Node> | undefined;
  const rdf = doc['rdf:RDF'] as Record<string, Node> | undefined;
  const atom = doc['feed'] as Record<string, Node> | undefined;

  if (rss || rdf) {
    const channel = (rss?.['channel'] ?? rdf?.['channel']) as Record<string, Node> | undefined;
    if (!channel) throw new Error('This is not a valid feed.');
    const siteUrl = text(channel['link']) || undefined;
    const rawItems = arr((rss ? channel['item'] : rdf?.['item']) as Record<string, Node> | Record<string, Node>[] | undefined);
    return {
      title: text(channel['title']) || siteUrl || 'Untitled feed',
      siteUrl,
      items: rawItems.map((it) => {
        const url = resolve(text(it['link']) || text(it['guid']), siteUrl ?? feedUrl);
        const html = text(it['content:encoded']);
        const desc = text(it['description']);
        return {
          id: text(it['guid']) || url,
          title: htmlToText(text(it['title'])) || url,
          url,
          published: isoDate(text(it['pubDate']) || text(it['dc:date'])),
          author: text(it['dc:creator']) || text(it['author']) || undefined,
          summary: teaser(desc || html),
          contentHtml: html || (desc.includes('<') ? desc : undefined),
        };
      }),
    };
  }

  if (atom) {
    const siteUrl = atomLink(atom['link'], feedUrl) || undefined;
    return {
      title: text(atom['title']) || siteUrl || 'Untitled feed',
      siteUrl,
      items: arr(atom['entry'] as Record<string, Node> | Record<string, Node>[] | undefined).map((e) => {
        const url = atomLink(e['link'], siteUrl ?? feedUrl);
        const html = text(e['content']);
        const group = e['media:group'] as Record<string, Node> | undefined;
        const summary = text(e['summary']) || text(group?.['media:description']);
        const author = e['author'] as Record<string, Node> | undefined;
        return {
          id: text(e['id']) || url,
          title: htmlToText(text(e['title'])) || url,
          url,
          published: isoDate(text(e['published']) || text(e['updated'])),
          author: text(author?.['name']) || undefined,
          summary: teaser(summary || html),
          contentHtml: html || undefined,
        };
      }),
    };
  }
  throw new Error('This is not an RSS or Atom feed.');
}

/** Find a feed link in an HTML page (<link rel="alternate" type="application/rss+xml">). */
export function discoverFeedUrl(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) return resolve(href.replace(/&amp;/g, '&'), pageUrl);
  }
  return null;
}

/** YouTube channel/playlist page or channel id -> its Atom feed URL. */
export function youtubeFeedUrl(input: string): string | null {
  const s = input.trim();
  if (/^UC[\w-]{22}$/.test(s)) return `https://www.youtube.com/feeds/videos.xml?channel_id=${s}`;
  try {
    const u = new URL(s);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const m = /^\/channel\/(UC[\w-]{22})/.exec(u.pathname);
    if (m) return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
    const list = u.searchParams.get('list');
    if (u.pathname === '/playlist' && list) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`;
  } catch {
    /* not a url */
  }
  return null;
}

// ---------- stored state ----------

export interface StoredFeed {
  id: string;
  url: string;
  title: string;
  siteUrl?: string;
  addedAt: string;
  lastFetched?: string;
  lastError?: string;
}

export interface FeedItem extends ParsedItem {
  feedId: string;
  read: boolean;
  firstSeen: string;
}

export const MAX_ITEMS_PER_FEED = 200;

/** Merge freshly fetched items into the stored ones: keeps read state, drops the oldest beyond the cap. */
export function mergeItems(
  feedId: string,
  existing: FeedItem[],
  fetched: ParsedItem[],
  now: string,
): { items: FeedItem[]; added: number } {
  const known = new Map(existing.map((i) => [i.id, i]));
  let added = 0;
  const merged = new Map(known);
  for (const f of fetched) {
    const prev = known.get(f.id);
    if (prev) merged.set(f.id, { ...prev, ...f, feedId, read: prev.read, firstSeen: prev.firstSeen });
    else {
      merged.set(f.id, { ...f, feedId, read: false, firstSeen: now });
      added++;
    }
  }
  const items = [...merged.values()]
    .sort((a, b) => (b.published ?? b.firstSeen).localeCompare(a.published ?? a.firstSeen))
    .slice(0, MAX_ITEMS_PER_FEED);
  return { items, added };
}
