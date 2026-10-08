export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** "asr" means auto-generated. */
  kind?: string;
  name?: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  channel?: string;
  lengthSeconds?: number;
  description?: string;
  tracks: CaptionTrack[];
}

export interface Segment {
  /** Seconds from the start. */
  start: number;
  text: string;
}

/** Video id from watch, short, shorts, embed and live links. Null for anything else. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = /^\/(shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
        id = m ? (m[2] as string) : null;
      }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Finds the JSON object assigned to a variable in a page script, by brace matching. */
function jsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {});

/** Read title, channel and caption tracks from the player response (embedded in the page or returned by the player API). */
export function parsePlayerResponse(player: unknown, id: string): VideoInfo {
  const p = obj(player);
  const details = obj(p['videoDetails']);
  const rawTracks = obj(obj(p['captions'])['playerCaptionsTracklistRenderer'])['captionTracks'];
  const tracks: CaptionTrack[] = (Array.isArray(rawTracks) ? rawTracks : [])
    .map((t) => obj(t))
    .filter((t) => typeof t['baseUrl'] === 'string' && typeof t['languageCode'] === 'string')
    .map((t) => ({
      baseUrl: t['baseUrl'] as string,
      languageCode: t['languageCode'] as string,
      kind: typeof t['kind'] === 'string' ? t['kind'] : undefined,
      name: typeof obj(t['name'])['simpleText'] === 'string' ? (obj(t['name'])['simpleText'] as string) : undefined,
    }));
  const len = Number(details['lengthSeconds']);
  return {
    id,
    title: typeof details['title'] === 'string' ? details['title'] : `YouTube video ${id}`,
    channel: typeof details['author'] === 'string' ? details['author'] : undefined,
    lengthSeconds: Number.isFinite(len) && len > 0 ? len : undefined,
    description: typeof details['shortDescription'] === 'string' ? details['shortDescription'] : undefined,
    tracks,
  };
}

export function parseWatchPage(html: string, id: string): VideoInfo | null {
  const player = jsonAfter(html, 'ytInitialPlayerResponse');
  return player ? parsePlayerResponse(player, id) : null;
}

/** Prefer a human-written track in the wanted language, then auto-generated in it, then any human one, then anything. */
export function pickTrack(tracks: CaptionTrack[], lang = 'en'): CaptionTrack | null {
  const same = (t: CaptionTrack) => t.languageCode.toLowerCase().split('-')[0] === lang.toLowerCase().split('-')[0];
  const human = (t: CaptionTrack) => t.kind !== 'asr';
  return tracks.find((t) => same(t) && human(t)) ?? tracks.find(same) ?? tracks.find(human) ?? tracks[0] ?? null;
}

/** URL that returns the captions as json3. */
export function timedTextUrl(track: CaptionTrack): string {
  const u = new URL(track.baseUrl);
  u.searchParams.set('fmt', 'json3');
  return u.toString();
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#39;/g, "'");

/** Parse json3 ({events:[{tStartMs,segs:[{utf8}]}]}) or the older XML (<text start="1.2">). */
export function parseCaptions(body: string): Segment[] {
  const trimmed = body.trim();
  const out: Segment[] = [];
  if (trimmed.startsWith('{')) {
    let data: Json;
    try {
      data = obj(JSON.parse(trimmed));
    } catch {
      return [];
    }
    for (const e of Array.isArray(data['events']) ? data['events'] : []) {
      const ev = obj(e);
      const segs = Array.isArray(ev['segs']) ? ev['segs'] : [];
      const text = segs.map((s) => String(obj(s)['utf8'] ?? '')).join('').replace(/\s+/g, ' ').trim();
      if (text) out.push({ start: Number(ev['tStartMs'] ?? 0) / 1000, text });
    }
    return out;
  }
  for (const m of trimmed.matchAll(/<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = decodeEntities(decodeEntities(m[2] as string)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) out.push({ start: Number(m[1]), text });
  }
  return out;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Group lines into paragraphs of about `window` seconds, each starting with a timestamp link. */
export function transcriptMarkdown(id: string, segments: Segment[], window = 30): string {
  const blocks: Array<{ start: number; parts: string[] }> = [];
  for (const seg of segments) {
    const last = blocks[blocks.length - 1];
    if (last && seg.start - last.start < window) last.parts.push(seg.text);
    else blocks.push({ start: seg.start, parts: [seg.text] });
  }
  return blocks
    .map((b) => `[${formatTime(b.start)}](https://youtu.be/${id}?t=${Math.floor(b.start)}) ${b.parts.join(' ')}`)
    .join('\n\n');
}

export function videoNoteBody(info: VideoInfo, segments: Segment[]): string {
  const url = `https://www.youtube.com/watch?v=${info.id}`;
  const head = [`Source: <${url}>`, info.channel ? `Channel: ${info.channel}` : '', info.lengthSeconds ? `Length: ${formatTime(info.lengthSeconds)}` : '']
    .filter(Boolean)
    .join('  \n');
  const body = segments.length ? transcriptMarkdown(info.id, segments) : '_No captions were available for this video._';
  return `${head}\n\n## Notes\n\n\n## Transcript\n\n${body}`;
}

import type { FetchLike } from './obsidian';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

async function getText(f: FetchLike, url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await f(url, { method: 'GET', headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers } });
  if (res.status >= 400) throw new Error(`YouTube answered ${res.status}.`);
  return res.text();
}

/**
 * Title, channel and captions for a video. Uses the watch page first and, if that has no captions,
 * the app-style player endpoint. YouTube changes these often, so failures say what to try instead.
 */
export async function fetchVideo(f: FetchLike, input: string, lang = 'en'): Promise<{ info: VideoInfo; segments: Segment[] }> {
  const id = parseVideoId(input);
  if (!id) throw new Error('That is not a YouTube video link.');

  let info = parseWatchPage(await getText(f, `https://www.youtube.com/watch?v=${id}&hl=${lang}`), id);
  if (!info || info.tracks.length === 0) {
    try {
      const res = await f('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' },
        body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: lang } }, videoId: id }),
      });
      if (res.status < 400) {
        const viaApi = parsePlayerResponse(JSON.parse(await res.text()), id);
        if (viaApi.tracks.length > 0 || !info) info = { ...viaApi, title: info?.title ?? viaApi.title };
      }
    } catch {
      /* keep what the page gave us */
    }
  }
  if (!info) throw new Error('Could not read that video page.');

  const track = pickTrack(info.tracks, lang);
  if (!track) return { info, segments: [] };
  const segments = parseCaptions(await getText(f, timedTextUrl(track)));
  return { info, segments };
}
