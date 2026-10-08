import { describe, expect, it } from 'vitest';
import {
  AuthError,
  CaptureQueue,
  DEFAULT_FOLDERS,
  MAX_ATTEMPTS,
  MemoryStorage,
  ObsidianClient,
  OfflineError,
  listBookmarks,
  moodFor,
  parseFrontmatter,
  sanitizeFileName,
  toFrontmatter,
  writeCapture,
  type BookmarkCapture,
  type HighlightCapture,
  type MarkdownCapture,
} from '../src';
import { FakeVault } from './fakeVault';

const setup = (key = 'secret') => {
  const vault = new FakeVault();
  const client = new ObsidianClient({ baseUrl: 'https://127.0.0.1:27124', apiKey: key }, vault.fetch);
  return { vault, client };
};

const highlight = (id: string, text = 'Attention is trained, not given.', url = 'https://aeon.co/essays/slow'): HighlightCapture => ({
  kind: 'highlight',
  id,
  createdAt: '2026-10-07T10:00:00.000Z',
  tags: ['reading'],
  text,
  source: { url, title: 'The slow case for deep reading', author: 'Mara Ellison' },
});

describe('sanitizeFileName', () => {
  it('strips characters Windows and Obsidian reject', () => {
    expect(sanitizeFileName('What? A "test": a/b\\c|d*')).toBe('What A test a b c d');
    expect(sanitizeFileName('Title with [brackets] and #hash ^caret')).toBe('Title with brackets and hash caret');
  });
  it('handles reserved, empty and trailing-dot names', () => {
    expect(sanitizeFileName('CON')).toBe('CON_');
    expect(sanitizeFileName('???')).toBe('Untitled');
    expect(sanitizeFileName('Notes...')).toBe('Notes');
  });
  it('caps length', () => {
    expect(sanitizeFileName('a'.repeat(300)).length).toBeLessThanOrEqual(120);
  });
});

describe('frontmatter', () => {
  it('round-trips strings that need quoting, booleans and lists', () => {
    const data = { title: 'Why: a "quoted" title', url: 'https://x.com/a?b=1', read: false, n: 3, tags: ['a', 'two words', 'true'], empty: [] as string[] };
    const parsed = parseFrontmatter(toFrontmatter(data) + '\nbody');
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe('body');
  });
  it('reads flow lists written by hand in Obsidian', () => {
    expect(parseFrontmatter('---\ntags: [a, b]\n---\nx').data['tags']).toEqual(['a', 'b']);
  });
  it('returns the whole text when there is no frontmatter', () => {
    expect(parseFrontmatter('# hi').body).toBe('# hi');
  });
});

describe('ObsidianClient', () => {
  it('reports whether the key was accepted', async () => {
    const { client } = setup();
    expect(await client.status()).toMatchObject({ authenticated: true, version: '3.0.0' });
    const bad = setup('wrong').client;
    expect((await bad.status()).authenticated).toBe(false);
  });
  it('maps network failure to OfflineError and 401 to AuthError', async () => {
    const { vault, client } = setup();
    vault.online = false;
    await expect(client.getNote('a.md')).rejects.toBeInstanceOf(OfflineError);
    vault.online = true;
    vault.key = 'rotated';
    await expect(client.getNote('a.md')).rejects.toBeInstanceOf(AuthError);
  });
  it('encodes path segments but keeps slashes', async () => {
    const { vault, client } = setup();
    await client.putNote('Clippings/A & B #1.md', 'x');
    expect(vault.calls.at(-1)).toBe('PUT /vault/Clippings/A%20%26%20B%20%231.md');
    expect(vault.files.get('Clippings/A & B #1.md')).toBe('x');
  });
});

describe('writeCapture', () => {
  it('creates one source note, then appends further highlights to it', async () => {
    const { vault, client } = setup();
    const a = await writeCapture(client, DEFAULT_FOLDERS, highlight('aaaa1111'));
    const b = await writeCapture(client, DEFAULT_FOLDERS, highlight('bbbb2222', 'A second line.\nOver two lines.'));
    expect(a).toEqual({ path: 'Clippings/The slow case for deep reading.md', action: 'created' });
    expect(b.action).toBe('appended');
    const note = vault.files.get(a.path) as string;
    const { data } = parseFrontmatter(note);
    expect(data).toMatchObject({ type: 'clipping', url: 'https://aeon.co/essays/slow', author: 'Mara Ellison' });
    expect(note).toContain('> Attention is trained, not given. ^h-aaaa1111');
    expect(note).toContain('> A second line.\n> Over two lines. ^h-bbbb2222');
  });
  it('is idempotent for the same capture id', async () => {
    const { vault, client } = setup();
    const c = highlight('aaaa1111');
    await writeCapture(client, DEFAULT_FOLDERS, c);
    const before = vault.files.get('Clippings/The slow case for deep reading.md');
    expect((await writeCapture(client, DEFAULT_FOLDERS, c)).action).toBe('unchanged');
    expect(vault.files.get('Clippings/The slow case for deep reading.md')).toBe(before);
  });
  it('does not mix two pages that share a title', async () => {
    const { vault, client } = setup();
    await writeCapture(client, DEFAULT_FOLDERS, highlight('aaaa1111'));
    const other = await writeCapture(client, DEFAULT_FOLDERS, highlight('cccc3333', 'Other site', 'https://other.org/post'));
    expect(other.path).toBe('Clippings/The slow case for deep reading (other.org).md');
    expect(vault.files.size).toBe(2);
  });
  it('saves a bookmark once per url', async () => {
    const { vault, client } = setup();
    const b: BookmarkCapture = { kind: 'bookmark', id: 'b1', createdAt: '2026-10-07T10:00:00Z', tags: ['tools'], url: 'https://tauri.app', title: 'Tauri 2', description: 'Plugins' };
    expect((await writeCapture(client, DEFAULT_FOLDERS, b)).action).toBe('created');
    expect((await writeCapture(client, DEFAULT_FOLDERS, { ...b, id: 'b2' })).action).toBe('unchanged');
    expect(vault.files.size).toBe(1);
  });
  it('saves markdown notes and keeps a different note with the same title', async () => {
    const { vault, client } = setup();
    const m: MarkdownCapture = { kind: 'markdown', id: 'm1', createdAt: '2026-10-07T10:00:00Z', tags: [], title: 'Idea', body: '# Hello' };
    await writeCapture(client, DEFAULT_FOLDERS, m);
    expect((await writeCapture(client, DEFAULT_FOLDERS, m)).action).toBe('unchanged');
    const second = await writeCapture(client, DEFAULT_FOLDERS, { ...m, id: 'm2' });
    expect(second.path).toBe('Notes/Idea (m2).md');
    expect(vault.files.size).toBe(2);
  });
});

describe('listBookmarks', () => {
  it('reads bookmark notes back from the vault', async () => {
    const { client } = setup();
    await writeCapture(client, DEFAULT_FOLDERS, { kind: 'bookmark', id: 'b1', createdAt: '2026-10-07T10:00:00Z', tags: ['design'], url: 'https://linear.app/method', title: 'Linear method' });
    await writeCapture(client, DEFAULT_FOLDERS, { kind: 'markdown', id: 'm1', createdAt: '2026-10-07T10:00:00Z', tags: [], title: 'Not a bookmark', body: 'x' });
    const list = await listBookmarks(client, DEFAULT_FOLDERS);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Linear method', url: 'https://linear.app/method', read: false, tags: ['bookmarks', 'design'] });
  });
});

describe('CaptureQueue', () => {
  it('holds captures while offline and files them, in order, once Obsidian is back', async () => {
    const { vault, client } = setup();
    const q = new CaptureQueue(new MemoryStorage());
    vault.online = false;
    await q.enqueue(highlight('aaaa1111'));
    await q.enqueue(highlight('bbbb2222', 'Second'));
    const r1 = await q.flush(client, DEFAULT_FOLDERS);
    expect(r1).toMatchObject({ offline: true, pending: 2, written: [] });
    expect(moodFor({ pending: r1.pending, failed: r1.failed, offline: r1.offline, authError: r1.authError })).toBe('sleepy');

    vault.online = true;
    const r2 = await q.flush(client, DEFAULT_FOLDERS);
    expect(r2.pending).toBe(0);
    expect(r2.written.map((w) => w.id)).toEqual(['aaaa1111', 'bbbb2222']);
    const note = vault.files.get('Clippings/The slow case for deep reading.md') as string;
    expect(note.indexOf('aaaa1111')).toBeLessThan(note.indexOf('bbbb2222'));
  });
  it('keeps everything and flags authError when the key is rejected', async () => {
    const { vault, client } = setup();
    const q = new CaptureQueue(new MemoryStorage());
    await q.enqueue(highlight('aaaa1111'));
    vault.key = 'rotated';
    const r = await q.flush(client, DEFAULT_FOLDERS);
    expect(r).toMatchObject({ authError: true, pending: 1 });
    expect(moodFor({ ...r, pending: r.pending })).toBe('worried');
  });
  it('ignores a capture id that is already queued', async () => {
    const q = new CaptureQueue(new MemoryStorage());
    await q.enqueue(highlight('aaaa1111'));
    await q.enqueue(highlight('aaaa1111'));
    expect(await q.pendingCount()).toBe(1);
  });
  it('gives up after repeated server errors and can retry', async () => {
    const { vault, client } = setup();
    const q = new CaptureQueue(new MemoryStorage());
    await q.enqueue(highlight('aaaa1111'));
    vault.failWrites = 100;
    let r = await q.flush(client, DEFAULT_FOLDERS);
    for (let i = 1; i < MAX_ATTEMPTS; i++) r = await q.flush(client, DEFAULT_FOLDERS);
    expect(r).toMatchObject({ pending: 0, failed: 1 });
    vault.failWrites = 0;
    expect((await q.flush(client, DEFAULT_FOLDERS)).written).toHaveLength(0);
    await q.retryFailed();
    expect((await q.flush(client, DEFAULT_FOLDERS)).written).toHaveLength(1);
  });
  it('survives concurrent enqueue and flush', async () => {
    const { client } = setup();
    const q = new CaptureQueue(new MemoryStorage());
    await Promise.all([
      q.enqueue(highlight('aaaa1111')),
      q.flush(client, DEFAULT_FOLDERS),
      q.enqueue(highlight('bbbb2222', 'Two')),
      q.flush(client, DEFAULT_FOLDERS),
    ]);
    expect(await q.pendingCount()).toBe(0);
  });
});

import { captureFromExtension } from '../src';

describe('captureFromExtension', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  it('builds a highlight and cleans tags', () => {
    const c = captureFromExtension({ type: 'highlight', url: 'https://aeon.co/x', title: 'T', text: ' hi ', tags: ['#Deep Reading', '', 5] }, now, 'id1');
    expect(c).toMatchObject({ kind: 'highlight', id: 'id1', tags: ['Deep-Reading'], source: { url: 'https://aeon.co/x', title: 'T' } });
  });
  it('builds bookmarks and page clips', () => {
    expect(captureFromExtension({ type: 'bookmark', url: 'https://a.com', title: 'A' }, now, 'i')).toMatchObject({ kind: 'bookmark' });
    expect(captureFromExtension({ type: 'page', url: 'https://a.com', title: 'A', markdown: '# x' }, now, 'i')).toMatchObject({ kind: 'markdown', title: 'A' });
  });
  it('rejects non-http urls, empty text, unknown types and junk', () => {
    expect(captureFromExtension({ type: 'highlight', url: 'javascript:alert(1)', title: 'x', text: 'y' })).toBeNull();
    expect(captureFromExtension({ type: 'highlight', url: 'file:///etc/passwd', title: 'x', text: 'y' })).toBeNull();
    expect(captureFromExtension({ type: 'highlight', url: 'https://a.com', title: 'x', text: '  ' })).toBeNull();
    expect(captureFromExtension({ type: 'nope', url: 'https://a.com' })).toBeNull();
    expect(captureFromExtension(null)).toBeNull();
    expect(captureFromExtension('x')).toBeNull();
  });
});
