import { newId, type Capture } from './types';

/** What the browser extension POSTs to the desktop app. Untrusted input, so it is validated. */
export type ExtensionPayload =
  | { type: 'highlight'; url: string; title: string; text: string; note?: string; author?: string; tags?: string[] }
  | { type: 'bookmark'; url: string; title: string; description?: string; tags?: string[] }
  | { type: 'page'; url: string; title: string; markdown: string; tags?: string[] };

const MAX_TEXT = 200_000;

const str = (v: unknown, max = MAX_TEXT): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : undefined;

function tagsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().replace(/^#/, '').replace(/\s+/g, '-'))
    .filter((t) => t !== '')
    .slice(0, 20);
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v, 2048);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Turn an extension payload into a Capture, or null if it is malformed. */
export function captureFromExtension(
  raw: unknown,
  now: Date = new Date(),
  id: string = newId(),
): Capture | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const url = httpUrl(p['url']);
  if (!url) return null;
  const title = str(p['title'], 300) ?? new URL(url).hostname;
  const base = { id, createdAt: now.toISOString(), tags: tagsOf(p['tags']) };

  switch (p['type']) {
    case 'highlight': {
      const text = str(p['text']);
      if (!text) return null;
      return {
        ...base,
        kind: 'highlight',
        text,
        note: str(p['note']),
        source: { url, title, author: str(p['author'], 200) },
      };
    }
    case 'bookmark':
      return { ...base, kind: 'bookmark', url, title, description: str(p['description'], 1000) };
    case 'page': {
      const markdown = str(p['markdown']);
      if (!markdown) return null;
      return { ...base, kind: 'markdown', title, body: `Source: <${url}>\n\n${markdown}` };
    }
    default:
      return null;
  }
}
