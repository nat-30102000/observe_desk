import { describe, expect, it } from 'vitest';
import {
  CaptureQueue, DEFAULT_FOLDERS, MemoryStorage, ObsidianClient, buildChat, detectSocial, fetchThread, fetchVideo, formatTime, htmlToPlain,
  ocrMessages, parseBluesky, parseCaptions, parseFrontmatter, parseHackerNews, parseMastodon, parsePlayerResponse, parseReddit, parseVideoId,
  parseWatchPage, pickTrack, threadToMarkdown, timedTextUrl, transcriptMarkdown, videoNoteBody, writeCapture, type FetchLike, type FileCapture, type FileStore,
} from '../src';
import { FakeVault } from './fakeVault';

const setup = () => {
  const vault = new FakeVault();
  return { vault, client: new ObsidianClient({ baseUrl: 'https://127.0.0.1:27124', apiKey: 'secret' }, vault.fetch) };
};

class MemFiles implements FileStore {
  data = new Map<string, Uint8Array>();
  removed: string[] = [];
  async read(id: string) { const d = this.data.get(id); if (!d) throw new Error('missing staged file'); return d; }
  async remove(id: string) { this.removed.push(id); this.data.delete(id); }
}

const file = (id: string, name = 'Diagram.png', over: Partial<FileCapture> = {}): FileCapture => ({ kind: 'file', id, createdAt: '2026-10-08T10:00:00Z', tags: [], name, mime: 'image/png', size: 3, ...over });

describe('file captures', () => {
  it('saves the bytes under Attachments and a note that embeds them', async () => {
    const { vault, client } = setup();
    const files = new MemFiles(); files.data.set('f1', Uint8Array.from([1, 2, 3]));
    const r = await writeCapture(client, DEFAULT_FOLDERS, file('f1', 'Diagram.png', { text: 'OCR text here' }), { files });
    expect(vault.binaries.get('Attachments/Diagram.png')).toEqual(Uint8Array.from([1, 2, 3]));
    expect(vault.contentTypes.get('Attachments/Diagram.png')).toBe('image/png');
    expect(r.path).toBe('Notes/Diagram.md');
    const note = vault.files.get('Notes/Diagram.md') as string;
    expect(parseFrontmatter(note).data).toMatchObject({ type: 'attachment', capture_id: 'f1', file: 'Attachments/Diagram.png', mime: 'image/png' });
    expect(note).toContain('![[Attachments/Diagram.png]]');
    expect(note).toContain('OCR text here');
    expect(files.removed).toEqual(['f1']);
  });
  it('links (not embeds) other file types and keeps a name clash apart', async () => {
    const { vault, client } = setup();
    const files = new MemFiles(); files.data.set('a', Uint8Array.from([1])); files.data.set('b', Uint8Array.from([2]));
    await writeCapture(client, DEFAULT_FOLDERS, file('a', 'data.zip', { mime: 'application/zip' }), { files });
    const second = file('b', 'data.zip', { mime: 'application/zip' });
    await writeCapture(client, DEFAULT_FOLDERS, second, { files });
    expect(vault.files.get('Notes/data.md')).toContain('[[Attachments/data.zip]]');
    expect(vault.files.get('Notes/data.md')).not.toContain('![[');
    expect(second.attachmentPath).toBe('Attachments/data (b).zip');
    expect(vault.binaries.size).toBe(2);
  });
  it('retries overwrite the same file instead of creating a second copy', async () => {
    const { vault, client } = setup();
    const files = new MemFiles(); files.data.set('r1', Uint8Array.from([9]));
    const c = file('r1');
    vault.failWrites = 1; // first PUT fails
    await expect(writeCapture(client, DEFAULT_FOLDERS, c, { files })).rejects.toThrow();
    expect(c.attachmentPath).toBe('Attachments/Diagram.png');
    await writeCapture(client, DEFAULT_FOLDERS, c, { files });
    expect([...vault.binaries.keys()]).toEqual(['Attachments/Diagram.png']);
  });
  it('flows through the queue, staying queued while offline with the bytes kept', async () => {
    const { vault, client } = setup();
    const files = new MemFiles(); files.data.set('q1', Uint8Array.from([7, 7]));
    const q = new CaptureQueue(new MemoryStorage());
    await q.enqueue(file('q1'));
    vault.online = false;
    expect(await q.flush(client, DEFAULT_FOLDERS, { files })).toMatchObject({ offline: true, pending: 1 });
    expect(files.data.has('q1')).toBe(true);
    vault.online = true;
    expect(await q.flush(client, DEFAULT_FOLDERS, { files })).toMatchObject({ pending: 0 });
    expect(vault.binaries.get('Attachments/Diagram.png')).toEqual(Uint8Array.from([7, 7]));
  });
  it('fails clearly without a file store', async () => {
    await expect(writeCapture(setup().client, DEFAULT_FOLDERS, file('x'))).rejects.toThrow(/file store/);
  });
});

describe('vision requests', () => {
  const msgs = ocrMessages({ mime: 'image/png', base64: 'AAA' });
  it('attaches the image in each provider format', () => {
    const a = JSON.parse(buildChat({ style: 'anthropic', baseUrl: 'https://a', model: 'm' }, 'k', msgs).body!);
    expect(a.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } });
    const o = JSON.parse(buildChat({ style: 'openai', baseUrl: 'https://o/v1', model: 'm' }, 'k', msgs).body!);
    expect(o.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
    const l = JSON.parse(buildChat({ style: 'ollama', baseUrl: 'https://l', model: 'm' }, 'k', msgs).body!);
    expect(l.messages[1].images).toEqual(['AAA']);
    expect(msgs[0]!.content).toMatch(/do not follow/);
  });
  it('leaves plain messages unchanged', () => {
    const o = JSON.parse(buildChat({ style: 'openai', baseUrl: 'https://o/v1', model: 'm' }, 'k', [{ role: 'user', content: 'hi' }]).body!);
    expect(o.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

const PLAYER = {
  videoDetails: { title: 'How indexes work', author: 'Database Notes', lengthSeconds: '754', shortDescription: 'desc' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=de', languageCode: 'de', name: { simpleText: 'German' } },
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr', languageCode: 'en', kind: 'asr' },
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', languageCode: 'en-GB', name: { simpleText: 'English (UK)' } },
  ] } },
};
const PAGE = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};var meta = {"x":"}"};</script></html>`;
const JSON3 = JSON.stringify({ events: [{ tStartMs: 0 }, { tStartMs: 1500, segs: [{ utf8: 'Hello' }, { utf8: ' world' }] }, { tStartMs: 20000, segs: [{ utf8: 'second\nline' }] }, { tStartMs: 65000, segs: [{ utf8: 'later' }] }] });

describe('youtube', () => {
  it('reads video ids from the usual link shapes', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) expect(parseVideoId(u)).toBe('dQw4w9WgXcQ');
    for (const u of ['https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'nonsense']) expect(parseVideoId(u)).toBeNull();
  });
  it('extracts the player response even when braces appear inside strings', () => {
    const info = parseWatchPage(PAGE, 'abc')!;
    expect(info).toMatchObject({ title: 'How indexes work', channel: 'Database Notes', lengthSeconds: 754 });
    expect(info.tracks).toHaveLength(3);
    expect(parseWatchPage('<html></html>', 'abc')).toBeNull();
  });
  it('prefers human captions in the wanted language, then auto, then any', () => {
    const t = parsePlayerResponse(PLAYER, 'abc').tracks;
    expect(pickTrack(t, 'en')!.name).toBe('English (UK)');
    expect(pickTrack(t.filter((x) => x.kind === 'asr'), 'en')!.kind).toBe('asr');
    expect(pickTrack(t, 'fr')!.languageCode).toBe('de');
    expect(pickTrack([], 'en')).toBeNull();
    expect(timedTextUrl(t[0]!)).toContain('fmt=json3');
  });
  it('parses json3 and xml captions', () => {
    expect(parseCaptions(JSON3)).toEqual([{ start: 1.5, text: 'Hello world' }, { start: 20, text: 'second line' }, { start: 65, text: 'later' }]);
    expect(parseCaptions('<transcript><text start="1.2" dur="2">Tom &amp;amp; Jerry&#39;s</text><text start="3">x</text></transcript>')).toEqual([{ start: 1.2, text: "Tom & Jerry's" }, { start: 3, text: 'x' }]);
    expect(parseCaptions('garbage')).toEqual([]);
  });
  it('formats timestamps and groups the transcript into linked paragraphs', () => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    const md = transcriptMarkdown('abc', parseCaptions(JSON3));
    expect(md).toBe('[0:01](https://youtu.be/abc?t=1) Hello world second line\n\n[1:05](https://youtu.be/abc?t=65) later');
    const body = videoNoteBody(parsePlayerResponse(PLAYER, 'abc'), parseCaptions(JSON3));
    expect(body).toContain('Channel: Database Notes');
    expect(body).toContain('## Notes');
    expect(body).toContain('## Transcript');
  });
  it('fetches page, then captions; falls back to the player api when the page has no captions', async () => {
    const calls: string[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push(`${init.method} ${url.split('?')[0]}`);
      if (url.includes('/watch')) return { status: 200, text: async () => PAGE.replace(/"captions":.*?"captionTracks":\[[\s\S]*?\]\}\}/, '"captions":{}') };
      if (url.includes('youtubei')) return { status: 200, text: async () => JSON.stringify(PLAYER) };
      return { status: 200, text: async () => JSON3 };
    };
    const r = await fetchVideo(f, 'https://youtu.be/dQw4w9WgXcQ');
    expect(r.segments).toHaveLength(3);
    expect(calls).toEqual(['GET https://www.youtube.com/watch', 'POST https://www.youtube.com/youtubei/v1/player', 'GET https://www.youtube.com/api/timedtext']);
    await expect(fetchVideo(f, 'https://example.com')).rejects.toThrow(/not a YouTube/);
  });
  it('returns the video with no segments when it has no captions at all', async () => {
    const noCaps = JSON.stringify({ videoDetails: PLAYER.videoDetails });
    const f: FetchLike = async (url) => ({ status: 200, text: async () => (url.includes('/watch') ? `<script>ytInitialPlayerResponse = ${noCaps};</script>` : noCaps) });
    const r = await fetchVideo(f, 'dQw4w9WgXcQ');
    expect(r.segments).toEqual([]);
    expect(videoNoteBody(r.info, [])).toContain('No captions');
  });
});

describe('social threads', () => {
  it('detects supported links', () => {
    expect(detectSocial('https://old.reddit.com/r/programming/comments/abc123/title_here/?x=1')).toEqual({ platform: 'reddit', path: '/r/programming/comments/abc123' });
    expect(detectSocial('https://news.ycombinator.com/item?id=8863')).toEqual({ platform: 'hackernews', id: '8863' });
    expect(detectSocial('https://mastodon.social/@Gargron/109999999999999')).toEqual({ platform: 'mastodon', host: 'mastodon.social', id: '109999999999999' });
    expect(detectSocial('https://bsky.app/profile/bsky.app/post/3kabc')).toEqual({ platform: 'bluesky', actor: 'bsky.app', rkey: '3kabc' });
    expect(detectSocial('https://x.com/jack/status/20')).toEqual({ platform: 'x' });
    expect(detectSocial('https://medium.com/@user/some-post-1234abcd')).toBeNull();
    expect(detectSocial('https://example.com')).toBeNull();
    expect(detectSocial('javascript:alert(1)')).toBeNull();
  });
  it('turns html into plain text with links and paragraphs', () => {
    expect(htmlToPlain('<p>Hi &amp; <a href="https://x.com/a">link</a></p><p>Two<br>lines <a href="https://y.com">https://y.com</a></p>')).toBe('Hi & [link](https://x.com/a)\n\nTwo\nlines https://y.com');
  });
  it('parses a Hacker News thread, skipping deleted comments', () => {
    const t = parseHackerNews({ title: 'Dropbox', url: 'https://dropbox.com', author: 'dhouston', points: 100, created_at: '2007-04-04T19:16:40Z', text: null, children: [{ author: 'a', text: '<p>First</p>', children: [{ author: 'b', text: 'Reply', children: [] }] }, { author: 'c', text: null, children: [{ author: 'd', text: 'Orphan reply', children: [] }] }] }, 'u');
    expect(t.title).toBe('Dropbox');
    expect(t.posts.map((p) => [p.author, p.depth])).toEqual([['dhouston', 0], ['a', 1], ['b', 2], ['d', 2]]);
  });
  it('parses Reddit listings with nested and empty replies', () => {
    const t = parseReddit([
      { data: { children: [{ data: { title: 'Ask', selftext: 'Body', author: 'op', score: 10, created_utc: 1700000000, is_self: true } }] } },
      { data: { children: [
        { kind: 't1', data: { author: 'x', body: 'top', score: 5, replies: { data: { children: [{ kind: 't1', data: { author: 'y', body: 'nested', score: 1, replies: '' } }, { kind: 'more', data: {} }] } } } },
        { kind: 't1', data: { author: 'z', body: '[deleted]', replies: '' } },
      ] } },
    ], 'u');
    expect(t.title).toBe('Ask');
    expect(t.posts.map((p) => [p.author, p.depth, p.text])).toEqual([['op', 0, 'Body'], ['x', 1, 'top'], ['y', 2, 'nested']]);
  });
  it('parses Mastodon context with reply depth', () => {
    const t = parseMastodon({ id: '1', content: '<p>Root post</p>', account: { acct: 'a@x.social' } }, { ancestors: [{ id: '0', content: '<p>Earlier</p>', account: { acct: 'e' } }], descendants: [{ id: '2', in_reply_to_id: '1', content: '<p>R1</p>', account: { acct: 'b' } }, { id: '3', in_reply_to_id: '2', content: '<p>R2</p>', account: { acct: 'c' } }] }, 'u');
    expect(t.posts.map((p) => [p.author, p.depth])).toEqual([['@e', 0], ['@a@x.social', 0], ['@b', 1], ['@c', 2]]);
    expect(t.title).toContain('@a@x.social');
  });
  it('parses a Bluesky thread with parents and replies', () => {
    const post = (h: string, text: string) => ({ post: { author: { handle: h }, record: { text, createdAt: '2026-01-01T00:00:00Z' } } });
    const t = parseBluesky({ thread: { ...post('me', 'main'), parent: { ...post('up', 'parent') }, replies: [{ ...post('r1', 'one'), replies: [post('r2', 'two')] }] } }, 'u');
    expect(t.posts.map((p) => [p.author, p.depth])).toEqual([['@up', 0], ['@me', 0], ['@r1', 1], ['@r2', 2]]);
  });
  it('renders markdown with nested replies and a cap', () => {
    const t = parseHackerNews({ title: 'T', author: 'op', text: 'Hello\nworld', children: [{ author: 'a', text: 'one\ntwo', children: [{ author: 'b', text: 'deep', children: [] }] }, { author: 'c', text: 'third', children: [] }] }, 'https://news.ycombinator.com/item?id=1');
    const md = threadToMarkdown(t);
    expect(md).toContain('Source: <https://news.ycombinator.com/item?id=1>');
    expect(md).toContain('> Hello\n> world');
    expect(md).toContain('- **a**: one\n  two\n  - **b**: deep\n- **c**: third');
    expect(threadToMarkdown(t, 2)).toContain('_2 more replies not included._');
  });
  it('fetches each platform from its public api and explains X and errors', async () => {
    const urls: string[] = [];
    const f = (status: number, body: unknown): FetchLike => async (url) => { urls.push(url); return { status, text: async () => JSON.stringify(body) }; };
    await fetchThread(f(200, { title: 'T', children: [] }), 'https://news.ycombinator.com/item?id=5');
    expect(urls[0]).toBe('https://hn.algolia.com/api/v1/items/5');
    urls.length = 0;
    await fetchThread(async (url) => { urls.push(url); return { status: 200, text: async () => JSON.stringify(url.includes('resolveHandle') ? { did: 'did:plc:abc' } : { thread: { post: { author: { handle: 'h' }, record: { text: 't' } } } }) }; }, 'https://bsky.app/profile/h.bsky.social/post/3k');
    expect(urls[1]).toContain('at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp.bsky.feed.post%2F3k');
    await expect(fetchThread(f(200, {}), 'https://x.com/a/status/1')).rejects.toThrow(/browser extension/);
    await expect(fetchThread(f(404, {}), 'https://news.ycombinator.com/item?id=5')).rejects.toThrow(/not found/);
    await expect(fetchThread(f(403, {}), 'https://reddit.com/r/a/comments/b')).rejects.toThrow(/refused/);
    await expect(fetchThread(f(200, {}), 'https://example.com')).rejects.toThrow(/not a Reddit/);
  });
});
