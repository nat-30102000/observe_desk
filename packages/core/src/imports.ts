import { cleanTag } from './ai-tasks';
import type { BookmarkCapture, Capture, HighlightCapture } from './types';

/** Same input always gives the same id, so importing a file twice does not duplicate anything. */
export function stableId(...parts: string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (const ch of parts.join('\u0001')) {
    const c = ch.codePointAt(0) as number;
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, line breaks inside quotes, optional BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function table(text: string): Array<Record<string, string>> {
  const [head, ...rest] = parseCsv(text);
  if (!head) return [];
  const names = head.map((h) => h.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(names.map((n, i) => [n, (r[i] ?? '').trim()])));
}

export type ImportKind = 'readwise-csv' | 'kindle-clippings' | 'pocket-html' | 'pocket-csv';

export const IMPORT_LABEL: Record<ImportKind, string> = {
  'readwise-csv': 'Readwise export (CSV)',
  'kindle-clippings': 'Kindle My Clippings.txt',
  'pocket-html': 'Pocket export (HTML)',
  'pocket-csv': 'Pocket export (CSV)',
};

/** Work out what an exported file is from its content, not just its name. */
export function detectImport(text: string): ImportKind | null {
  const head = text.replace(/^﻿/, '').slice(0, 4000);
  if (/^\s*"?highlight"?\s*,\s*"?book title"?/i.test(head)) return 'readwise-csv';
  if (/^==========/m.test(text) && /- Your (Highlight|Note|Bookmark)/.test(text)) return 'kindle-clippings';
  if (/<a\s[^>]*href=/i.test(head) && /time_added|Pocket|Read Archive|Unread/i.test(text.slice(0, 20000))) return 'pocket-html';
  const first = (head.split(/\r?\n/)[0] ?? '').toLowerCase();
  if (first.includes('url') && first.includes('time_added')) return 'pocket-csv';
  return null;
}

const tagsOf = (raw: string, sep: RegExp): string[] =>
  [...new Set(raw.split(sep).map((t) => cleanTag(t.replace(/^\./, ''))).filter(Boolean))];

function dateOf(raw: string | undefined, fallback: Date): string {
  if (!raw) return fallback.toISOString();
  const d = /^\d{9,11}$/.test(raw) ? new Date(Number(raw) * 1000) : new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
}

export function parseReadwiseCsv(text: string, now = new Date()): Capture[] {
  const out: HighlightCapture[] = [];
  for (const r of table(text)) {
    const quote = r['highlight'] ?? '';
    const title = r['book title'] ?? '';
    if (!quote || !title) continue;
    const tags = tagsOf(r['tags'] ?? '', /[,;]/);
    if (tags.includes('discard')) continue;
    const type = (r['location type'] ?? '').toLowerCase();
    const where = r['location'] ? `${type === 'page' ? 'p.' : type === 'location' ? 'loc.' : type || 'at'} ${r['location']}`.trim() : undefined;
    const author = r['book author'] || undefined;
    out.push({
      kind: 'highlight',
      id: stableId('rw', title, author ?? '', quote, r['location'] ?? ''),
      createdAt: dateOf(r['highlighted at'], now),
      tags: ['readwise', ...tags.filter((t) => t !== 'readwise')],
      text: quote,
      note: r['note'] || undefined,
      location: where,
      source: { url: r['url'] || `readwise://${stableId(title, author ?? '')}`, title, author },
    });
  }
  return out;
}

const KIND_RE = /^- Your (Highlight|Note|Bookmark)\b(.*)$/;

interface Clip {
  title: string;
  author?: string;
  kind: 'Highlight' | 'Note' | 'Bookmark';
  page?: string;
  loc?: string;
  locEnd: number | null;
  added?: string;
  body: string;
}

function parseClip(block: string): Clip | null {
  const lines = block.split(/\r?\n/).map((l) => l.replace(/^﻿/, ''));
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  const titleLine = lines[0]?.trim();
  const meta = KIND_RE.exec((lines[1] ?? '').trim());
  if (!titleLine || !meta) return null;
  const tm = /^(.*?)(?:\s+\(([^()]*)\))?$/.exec(titleLine);
  const rest = meta[2] ?? '';
  const page = /\bpage\s+([\w-]+)/i.exec(rest)?.[1];
  const loc = /\blocation\s+(\d+(?:-\d+)?)/i.exec(rest)?.[1];
  const added = /Added on\s+(.+)$/i.exec(rest)?.[1]?.trim();
  return {
    title: (tm?.[1] ?? titleLine).trim(),
    author: tm?.[2]?.trim() || undefined,
    kind: meta[1] as Clip['kind'],
    page,
    loc,
    locEnd: loc ? Number(loc.split('-').pop()) : null,
    added: added?.replace(/^[A-Za-z]+,\s*/, ''),
    body: lines.slice(2).join('\n').trim(),
  };
}

/** Kindle "My Clippings.txt" (English). Notes attach to the highlight that ends at their location; repeated and extended highlights collapse. */
export function parseKindleClippings(text: string, now = new Date()): Capture[] {
  const clips = text.split(/^={5,}\s*$/m).map(parseClip).filter((c): c is Clip => c !== null);
  const byBook = new Map<string, Array<{ clip: Clip; note?: string }>>();
  for (const clip of clips) {
    if (clip.kind === 'Bookmark') continue;
    const key = `${clip.title}\u0001${clip.author ?? ''}`;
    const list = byBook.get(key) ?? [];
    byBook.set(key, list);
    if (clip.kind === 'Note') {
      const target = [...list].reverse().find((h) => h.clip.locEnd !== null && h.clip.locEnd === clip.locEnd);
      if (target && clip.body) target.note = [target.note, clip.body].filter(Boolean).join('\n');
      continue;
    }
    if (!clip.body) continue;
    // Kindle writes the old and the extended highlight; keep the longer one.
    const dup = list.findIndex((h) => h.clip.body.startsWith(clip.body) || clip.body.startsWith(h.clip.body));
    if (dup >= 0) {
      if (clip.body.length >= (list[dup] as { clip: Clip }).clip.body.length) list[dup] = { clip, note: list[dup]?.note };
    } else list.push({ clip });
  }
  const out: HighlightCapture[] = [];
  for (const entries of byBook.values()) {
    for (const { clip, note } of entries) {
      const where = clip.page ? `p. ${clip.page}` : clip.loc ? `loc. ${clip.loc}` : undefined;
      out.push({
        kind: 'highlight',
        id: stableId('kindle', clip.title, clip.author ?? '', clip.body),
        createdAt: dateOf(clip.added, now),
        tags: ['kindle'],
        text: clip.body,
        note,
        location: where,
        source: { url: `kindle://${stableId(clip.title, clip.author ?? '')}`, title: clip.title, author: clip.author },
      });
    }
  }
  return out;
}

function bookmark(url: string, title: string, added: string | undefined, tags: string[], read: boolean, now: Date): BookmarkCapture | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { kind: 'bookmark', id: stableId('pocket', url), createdAt: dateOf(added, now), tags: ['pocket', ...tags], url, title: title.trim() || new URL(url).hostname, read };
}

const unescapeHtml = (s: string): string => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

export function parsePocketHtml(text: string, now = new Date()): Capture[] {
  const out: Capture[] = [];
  let read = false;
  for (const m of text.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>|<a\s([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (m[1] !== undefined) {
      read = /read|archive/i.test(m[1]) && !/unread/i.test(m[1]);
      continue;
    }
    const attrs = m[2] ?? '';
    const href = /href="([^"]*)"/i.exec(attrs)?.[1];
    if (!href) continue;
    const b = bookmark(unescapeHtml(href), unescapeHtml((m[3] ?? '').replace(/<[^>]+>/g, '')), /time_added="(\d+)"/i.exec(attrs)?.[1], tagsOf(/tags="([^"]*)"/i.exec(attrs)?.[1] ?? '', /,/), read, now);
    if (b) out.push(b);
  }
  return out;
}

export function parsePocketCsv(text: string, now = new Date()): Capture[] {
  const out: Capture[] = [];
  for (const r of table(text)) {
    const b = bookmark(r['url'] ?? '', r['title'] ?? '', r['time_added'], tagsOf(r['tags'] ?? '', /[|,]/), /archive|read/i.test(r['status'] ?? '') && !/unread/i.test(r['status'] ?? ''), now);
    if (b) out.push(b);
  }
  return out;
}

export function parseImport(kind: ImportKind, text: string, now = new Date()): Capture[] {
  switch (kind) {
    case 'readwise-csv':
      return parseReadwiseCsv(text, now);
    case 'kindle-clippings':
      return parseKindleClippings(text, now);
    case 'pocket-html':
      return parsePocketHtml(text, now);
    case 'pocket-csv':
      return parsePocketCsv(text, now);
  }
}

/** "3 highlights from 2 books" or "120 bookmarks", for the preview. */
export function summarizeImport(captures: Capture[]): string {
  const highlights = captures.filter((c): c is HighlightCapture => c.kind === 'highlight');
  const marks = captures.filter((c) => c.kind === 'bookmark').length;
  const books = new Set(highlights.map((h) => h.source.title)).size;
  return [highlights.length ? `${highlights.length} highlight${highlights.length === 1 ? '' : 's'} from ${books} book${books === 1 ? '' : 's'}` : '', marks ? `${marks} bookmark${marks === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') || 'nothing to import';
}
