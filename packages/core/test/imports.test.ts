import { describe, expect, it } from 'vitest';
import {
  CaptureQueue, DEFAULT_FOLDERS, MemoryStorage, ObsidianClient, chunk, detectImport, parseCsv, parseFrontmatter, parseImport, parseKindleClippings,
  parsePocketCsv, parsePocketHtml, parseReadwiseCsv, stableId, summarizeImport, writeCapture, type BookmarkCapture, type HighlightCapture,
} from '../src';
import { FakeVault } from './fakeVault';

const NOW = new Date('2026-10-08T12:00:00Z');

const READWISE = `Highlight,Book Title,Book Author,Amazon Book ID,Note,Color,Tags,Location Type,Location,Highlighted at,Document tags
"Attention is trained, not given.
A page read twice is a different page.",The Slow Book,Mara Ellison,B00X,"Key idea",yellow,".favorite, Deep Work",page,12,2020-10-05 10:15:30+00:00,
"She said ""hello"".",The Slow Book,Mara Ellison,B00X,,,,location,345,2020-10-06 08:00:00+00:00,
Thrown away,Other,Nobody,,,,.discard,page,1,2020-10-06,
,Missing quote,X,,,,,,,,
`;

const KINDLE = `﻿The Slow Book (Mara Ellison)
- Your Highlight on page 12 | Location 123-124 | Added on Monday, 5 October 2020 10:15:30

Attention is trained, not given.
==========
The Slow Book (Mara Ellison)
- Your Note on page 12 | Location 124 | Added on Monday, 5 October 2020 10:16:00

Connects to rereading
==========
The Slow Book (Mara Ellison)
- Your Highlight on page 40 | Location 400-401 | Added on Tuesday, 6 October 2020 09:00:00

A short quote.
==========
The Slow Book (Mara Ellison)
- Your Highlight on page 40 | Location 400-402 | Added on Tuesday, 6 October 2020 09:01:00

A short quote. Now extended further.
==========
The Slow Book (Mara Ellison)
- Your Bookmark on page 50 | Location 500 | Added on Tuesday, 6 October 2020 09:02:00


==========
Dune
- Your Highlight at location 77-78 | Added on Wednesday, October 7, 2020 6:30:00 PM

Fear is the mind-killer.
==========
Garbage that is not a clipping
==========
`;

const POCKET_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pocket Export</title></head><body>
<h1>Unread</h1><ul>
<li><a href="https://example.com/a?x=1&amp;y=2" time_added="1601900000" tags="design,tools">Great &amp; useful</a></li>
<li><a href="javascript:alert(1)" time_added="1">bad</a></li>
</ul>
<h1>Read Archive</h1><ul>
<li><a href="https://example.com/b" time_added="1601900100" tags="">Archived one</a></li>
</ul></body></html>`;

const POCKET_CSV = `title,url,time_added,tags,status
"Hello, world",https://example.com/c,1601900000,a|b,unread
Done,https://example.com/d,1601900100,,archive
No url,,1,,unread
`;

describe('csv', () => {
  it('handles quotes, doubled quotes, embedded newlines, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x,y","he said ""hi"""\r\n"line1\nline2",z\r\n')).toEqual([['a', 'b'], ['x,y', 'he said "hi"'], ['line1\nline2', 'z']]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('detectImport', () => {
  it('recognises each export by its content', () => {
    expect(detectImport(READWISE)).toBe('readwise-csv');
    expect(detectImport(KINDLE)).toBe('kindle-clippings');
    expect(detectImport(POCKET_HTML)).toBe('pocket-html');
    expect(detectImport(POCKET_CSV)).toBe('pocket-csv');
    expect(detectImport('just some text')).toBeNull();
  });
});

describe('Readwise', () => {
  const items = parseReadwiseCsv(READWISE, NOW) as HighlightCapture[];
  it('reads highlights, notes, tags and locations; skips discarded and empty rows', () => {
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ text: 'Attention is trained, not given.\nA page read twice is a different page.', note: 'Key idea', location: 'p. 12', tags: ['readwise', 'favorite', 'deep-work'], createdAt: '2020-10-05T10:15:30.000Z' });
    expect(items[0]!.source).toMatchObject({ title: 'The Slow Book', author: 'Mara Ellison' });
    expect(items[1]).toMatchObject({ text: 'She said "hello".', location: 'loc. 345' });
    expect(items[0]!.source.url).toBe(items[1]!.source.url);
  });
  it('gives the same ids every time, so a second import is a no-op', () => {
    expect(parseReadwiseCsv(READWISE, new Date()).map((c) => c.id)).toEqual(items.map((c) => c.id));
  });
});

describe('Kindle', () => {
  const items = parseKindleClippings(KINDLE, NOW) as HighlightCapture[];
  it('keeps highlights, joins notes, drops bookmarks and junk, and keeps the longest of repeated highlights', () => {
    expect(items).toHaveLength(3);
    const slow = items.filter((i) => i.source.title === 'The Slow Book');
    expect(slow.map((i) => i.text)).toEqual(['Attention is trained, not given.', 'A short quote. Now extended further.']);
    expect(slow[0]).toMatchObject({ note: 'Connects to rereading', location: 'p. 12', source: { author: 'Mara Ellison' } });
    expect(slow[0]!.createdAt).toBe(new Date('5 October 2020 10:15:30').toISOString());
  });
  it('reads device-style headers without a page and US dates', () => {
    const dune = items.find((i) => i.source.title === 'Dune')!;
    expect(dune).toMatchObject({ text: 'Fear is the mind-killer.', location: 'loc. 77-78' });
    expect(dune.source.author).toBeUndefined();
    expect(dune.createdAt).toBe(new Date('October 7, 2020 6:30:00 PM').toISOString());
  });
});

describe('Pocket', () => {
  it('reads the html export with entities, tags, dates and read state; ignores unsafe links', () => {
    const items = parsePocketHtml(POCKET_HTML, NOW) as BookmarkCapture[];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ url: 'https://example.com/a?x=1&y=2', title: 'Great & useful', tags: ['pocket', 'design', 'tools'], read: false, createdAt: '2020-10-05T12:13:20.000Z' });
    expect(items[1]).toMatchObject({ title: 'Archived one', read: true });
  });
  it('reads the csv export', () => {
    const items = parsePocketCsv(POCKET_CSV, NOW) as BookmarkCapture[];
    expect(items.map((i) => [i.title, i.tags, i.read])).toEqual([['Hello, world', ['pocket', 'a', 'b'], false], ['Done', ['pocket'], true]]);
  });
});

describe('helpers', () => {
  it('stableId is deterministic and sensitive to input', () => {
    expect(stableId('a', 'b')).toBe(stableId('a', 'b'));
    expect(stableId('a', 'b')).not.toBe(stableId('ab'));
    expect(stableId('x')).toMatch(/^[0-9a-f]{12}$/);
  });
  it('chunk splits evenly with a short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it('summarises for the preview', () => {
    expect(summarizeImport([...parseKindleClippings(KINDLE, NOW), ...parsePocketCsv(POCKET_CSV, NOW)])).toBe('3 highlights from 2 books and 2 bookmarks');
    expect(summarizeImport([])).toBe('nothing to import');
  });
});

describe('importing into the vault', () => {
  it('files everything once, even when the same export is imported twice', async () => {
    const vault = new FakeVault();
    const client = new ObsidianClient({ baseUrl: 'https://127.0.0.1:27124', apiKey: 'secret' }, vault.fetch);
    const q = new CaptureQueue(new MemoryStorage());
    for (let round = 0; round < 2; round++) {
      for (const c of [...parseImport('kindle-clippings', KINDLE, NOW), ...parseImport('pocket-csv', POCKET_CSV, NOW)]) await q.enqueue(c);
      await q.flush(client, DEFAULT_FOLDERS);
    }
    const clip = vault.files.get('Clippings/The Slow Book.md') as string;
    expect(clip.match(/\^h-/g)).toHaveLength(2);
    expect(clip).toContain('Connects to rereading');
    expect(parseFrontmatter(vault.files.get('Bookmarks/Done.md') as string).data).toMatchObject({ read: true });
    expect([...vault.files.keys()].filter((k) => k.startsWith('Bookmarks/'))).toHaveLength(2);
    // an unchanged file is a no-op: the note does not grow
    expect((await writeCapture(client, DEFAULT_FOLDERS, parseImport('kindle-clippings', KINDLE, NOW)[0]!)).action).toBe('unchanged');
  });
});
