import type { FetchLike } from './obsidian';

export type Platform = 'reddit' | 'hackernews' | 'mastodon' | 'bluesky';

export interface ThreadPost {
  author: string;
  text: string;
  createdAt?: string;
  /** 0 for the original post, 1+ for replies. */
  depth: number;
  score?: number;
}

export interface Thread {
  platform: Platform;
  url: string;
  title: string;
  posts: ThreadPost[];
}

export type SocialRef =
  | { platform: 'reddit'; path: string }
  | { platform: 'hackernews'; id: string }
  | { platform: 'mastodon'; host: string; id: string }
  | { platform: 'bluesky'; actor: string; rkey: string }
  | { platform: 'x' };

/** Which service and post a link points at. `x` is recognised only so we can explain why it is not supported. */
export function detectSocial(input: string): SocialRef | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www|old|new|m|np)\./, '');
  if (host === 'reddit.com') {
    const m = /^\/r\/[\w]+\/comments\/[\w]+/.exec(u.pathname);
    return m ? { platform: 'reddit', path: m[0].replace(/\/+$/, '') } : null;
  }
  if (host === 'news.ycombinator.com') {
    const id = u.pathname === '/item' ? u.searchParams.get('id') : null;
    return id && /^\d+$/.test(id) ? { platform: 'hackernews', id } : null;
  }
  if (host === 'bsky.app') {
    const m = /^\/profile\/([^/]+)\/post\/([\w]+)/.exec(u.pathname);
    return m ? { platform: 'bluesky', actor: m[1] as string, rkey: m[2] as string } : null;
  }
  if (host === 'x.com' || host === 'twitter.com') return /\/status\/\d+/.test(u.pathname) ? { platform: 'x' } : null;
  const masto = /^\/@[\w.-]+\/(\d{6,})\/?$/.exec(u.pathname) ?? /^\/users\/[\w.-]+\/statuses\/(\d{6,})\/?$/.exec(u.pathname);
  return masto ? { platform: 'mastodon', host: u.hostname, id: masto[1] as string } : null;
}

const entities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));

/** HTML used by Hacker News and Mastodon, reduced to plain text with paragraphs and links kept. */
export function htmlToPlain(html: string): string {
  return entities(
    html
      .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, '');
        return text === href || text.startsWith('http') ? href : `[${text}](${href})`;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) => `\n\`\`\`\n${code.replace(/<[^>]+>/g, '')}\n\`\`\`\n`)
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

export function parseHackerNews(raw: unknown, url: string): Thread {
  const root = obj(raw);
  const posts: ThreadPost[] = [];
  const intro = [str(root['url']) ? `<${str(root['url'])}>` : '', htmlToPlain(str(root['text']))].filter(Boolean).join('\n\n');
  posts.push({ author: str(root['author']), text: intro, createdAt: str(root['created_at']) || undefined, depth: 0, score: num(root['points']) });
  const walk = (children: unknown, depth: number) => {
    for (const c of list(children)) {
      const n = obj(c);
      const text = htmlToPlain(str(n['text']));
      if (text) posts.push({ author: str(n['author']), text, createdAt: str(n['created_at']) || undefined, depth });
      walk(n['children'], depth + 1);
    }
  };
  walk(root['children'], 1);
  return { platform: 'hackernews', url, title: str(root['title']) || 'Hacker News thread', posts };
}

export function parseReddit(raw: unknown, url: string): Thread {
  const [postListing, commentListing] = list(raw);
  const post = obj(obj(list(obj(obj(postListing)['data'])['children'])[0])['data']);
  const posts: ThreadPost[] = [
    {
      author: str(post['author']),
      text: [str(post['selftext']), post['is_self'] !== true && str(post['url']) ? `<${str(post['url'])}>` : ''].filter(Boolean).join('\n\n'),
      createdAt: num(post['created_utc']) ? new Date((post['created_utc'] as number) * 1000).toISOString() : undefined,
      depth: 0,
      score: num(post['score']),
    },
  ];
  const walk = (children: unknown, depth: number) => {
    for (const c of list(children)) {
      const node = obj(c);
      if (node['kind'] !== 't1') continue;
      const d = obj(node['data']);
      const body = str(d['body']).trim();
      if (body && body !== '[deleted]' && body !== '[removed]') {
        posts.push({ author: str(d['author']), text: body, createdAt: num(d['created_utc']) ? new Date((d['created_utc'] as number) * 1000).toISOString() : undefined, depth, score: num(d['score']) });
      }
      const replies = obj(d['replies']);
      walk(obj(replies['data'])['children'], depth + 1);
    }
  };
  walk(obj(obj(commentListing)['data'])['children'], 1);
  return { platform: 'reddit', url, title: str(post['title']) || 'Reddit thread', posts };
}

export function parseMastodon(status: unknown, context: unknown, url: string): Thread {
  const toPost = (s: unknown, depth: number): ThreadPost => {
    const o = obj(s);
    return { author: `@${str(obj(o['account'])['acct'])}`, text: htmlToPlain(str(o['content'])), createdAt: str(o['created_at']) || undefined, depth };
  };
  const root = obj(status);
  const ctx = obj(context);
  const depthOf = new Map<string, number>([[str(root['id']), 0]]);
  const posts: ThreadPost[] = [...list(ctx['ancestors']).map((a) => toPost(a, 0)), toPost(root, 0)];
  for (const d of list(ctx['descendants'])) {
    const o = obj(d);
    const depth = (depthOf.get(str(o['in_reply_to_id'])) ?? 0) + 1;
    depthOf.set(str(o['id']), depth);
    posts.push(toPost(o, depth));
  }
  const first = posts.find((p) => p.text)?.text ?? '';
  return { platform: 'mastodon', url, title: `Thread by ${str(obj(root['account'])['acct']) ? '@' + str(obj(root['account'])['acct']) : 'unknown'}: ${first.replace(/\s+/g, ' ').slice(0, 50)}`.trim(), posts };
}

export function parseBluesky(raw: unknown, url: string): Thread {
  const toPost = (node: Json, depth: number): ThreadPost => {
    const post = obj(node['post']);
    const author = obj(post['author']);
    const record = obj(post['record']);
    return { author: `@${str(author['handle'])}`, text: str(record['text']), createdAt: str(record['createdAt']) || undefined, depth };
  };
  const root = obj(obj(raw)['thread']);
  const parents: ThreadPost[] = [];
  for (let p = obj(root['parent']); p['post']; p = obj(p['parent'])) parents.unshift(toPost(p, 0));
  const posts: ThreadPost[] = [...parents, toPost(root, 0)];
  const walk = (replies: unknown, depth: number) => {
    for (const r of list(replies)) {
      const n = obj(r);
      if (!n['post']) continue;
      posts.push(toPost(n, depth));
      walk(n['replies'], depth + 1);
    }
  };
  walk(root['replies'], 1);
  const first = posts.find((p) => p.text)?.text ?? '';
  return { platform: 'bluesky', url, title: `Thread by ${posts.find((p) => p.depth === 0)?.author ?? '@unknown'}: ${first.replace(/\s+/g, ' ').slice(0, 50)}`, posts };
}

const PLATFORM_NAME: Record<Platform, string> = { reddit: 'Reddit', hackernews: 'Hacker News', mastodon: 'Mastodon', bluesky: 'Bluesky' };

/** Markdown for a note: the original post, then replies as a nested list. */
export function threadToMarkdown(t: Thread, maxPosts = 80): string {
  const [first, ...rest] = t.posts;
  const shown = rest.slice(0, Math.max(0, maxPosts - 1));
  const lines: string[] = [`Source: <${t.url}>  `, `Platform: ${PLATFORM_NAME[t.platform]}`, ''];
  if (first) {
    lines.push(`## ${first.author || 'Original post'}${first.createdAt ? ` (${first.createdAt.slice(0, 10)})` : ''}`, '');
    lines.push(...first.text.split('\n').map((l) => (l ? `> ${l}` : '>')), '');
  }
  if (shown.length > 0) {
    lines.push('## Replies', '');
    for (const p of shown) {
      const pad = '  '.repeat(Math.max(0, p.depth - 1));
      const [head = '', ...more] = p.text.split('\n');
      lines.push(`${pad}- **${p.author || 'unknown'}**${p.score !== undefined ? ` (${p.score})` : ''}: ${head}`);
      for (const l of more) lines.push(l ? `${pad}  ${l}` : '');
    }
  }
  if (rest.length > shown.length) lines.push('', `_${rest.length - shown.length} more replies not included._`);
  return lines.join('\n').trimEnd() + '\n';
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) observe_desk/0.1';

async function getJson(f: FetchLike, url: string, what: string): Promise<unknown> {
  const res = await f(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 404) throw new Error(`${what} was not found. It may be deleted or private.`);
  if (res.status === 403 || res.status === 401) throw new Error(`${what} refused the request (${res.status}). It may be private or blocking apps.`);
  if (res.status === 429) throw new Error(`${what} is rate limiting you. Try again in a minute.`);
  if (res.status >= 400) throw new Error(`${what} answered ${res.status}.`);
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new Error(`${what} did not answer with JSON.`);
  }
}

export async function fetchThread(f: FetchLike, input: string): Promise<Thread> {
  const ref = detectSocial(input);
  if (!ref) throw new Error('That link is not a Reddit, Hacker News, Mastodon or Bluesky post.');
  const url = input.trim();
  switch (ref.platform) {
    case 'x':
      throw new Error('X (Twitter) does not allow reading posts without logging in. Use the browser extension on the post page instead.');
    case 'hackernews':
      return parseHackerNews(await getJson(f, `https://hn.algolia.com/api/v1/items/${ref.id}`, 'Hacker News'), url);
    case 'reddit':
      return parseReddit(await getJson(f, `https://www.reddit.com${ref.path}.json?limit=100&raw_json=1`, 'Reddit'), url);
    case 'mastodon': {
      const base = `https://${ref.host}/api/v1/statuses/${ref.id}`;
      const [status, context] = [await getJson(f, base, ref.host), await getJson(f, `${base}/context`, ref.host)];
      return parseMastodon(status, context, url);
    }
    case 'bluesky': {
      let did = ref.actor;
      if (!did.startsWith('did:')) {
        const r = obj(await getJson(f, `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(ref.actor)}`, 'Bluesky'));
        did = str(r['did']);
        if (!did) throw new Error('Bluesky could not find that account.');
      }
      const uri = encodeURIComponent(`at://${did}/app.bsky.feed.post/${ref.rkey}`);
      return parseBluesky(await getJson(f, `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${uri}&depth=8&parentHeight=10`, 'Bluesky'), url);
    }
  }
}
