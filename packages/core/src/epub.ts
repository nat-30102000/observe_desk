import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';
import { htmlToText } from './feeds';

export interface EpubChapter {
  index: number;
  /** Path inside the zip. */
  path: string;
  title: string;
}

export interface EpubBook {
  title: string;
  author?: string;
  chapters: EpubChapter[];
  /** Body markup of one chapter, with images inlined as data URIs. Untrusted: sanitise before display. */
  chapterHtml(index: number): string;
  /** Index of the chapter that a link (relative to `fromIndex`) points at, or -1. */
  resolveLink(fromIndex: number, href: string): number;
}

const MAX_BOOK_BYTES = 150 * 1024 * 1024;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_INLINE_IMAGE = 6 * 1024 * 1024;

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true });
type Obj = Record<string, unknown>;
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});

function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (Array.isArray(v)) return text(v[0]);
  return text(obj(v)['#text']);
}

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

/** Join and normalise "a/b/" + "../c.png" -> "a/c.png". Drops query and fragment. */
function joinZip(base: string, rel: string): string {
  const clean = decodeURIComponent(rel.split('#')[0]!.split('?')[0]!);
  const parts = (clean.startsWith('/') ? clean.slice(1) : base + clean).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function dataUri(path: string, files: Record<string, Uint8Array>): string | null {
  const data = files[path];
  const type = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
  if (!data || !type || data.length > MAX_INLINE_IMAGE) return null;
  return `data:${type};base64,${btoa(strFromU8(data, true))}`;
}

function bodyOf(html: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? (m[1] as string) : html;
}

const stripTags = (s: string): string => htmlToText(s);

/** Map "chapter file path" -> title from an EPUB 3 nav document. */
function navTitles(html: string, navDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const path = joinZip(navDir, m[1] as string);
    const title = stripTags(m[2] as string);
    if (title && !map.has(path)) map.set(path, title);
  }
  return map;
}

/** Same for an EPUB 2 NCX file. */
function ncxTitles(doc: Obj, ncxDir: string): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (points: unknown) => {
    for (const p of arr(points as Obj | Obj[])) {
      const src = text(obj(p['content'])['@_src']);
      const title = text(obj(p['navLabel'])['text']);
      if (src && title) {
        const path = joinZip(ncxDir, src);
        if (!map.has(path)) map.set(path, title);
      }
      walk(p['navPoint']);
    }
  };
  walk(obj(obj(doc['ncx'])['navMap'])['navPoint']);
  return map;
}

export function openEpub(bytes: Uint8Array): EpubBook {
  if (bytes.length > MAX_BOOK_BYTES) throw new Error('That book is too large to open.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.originalSize <= MAX_ENTRY_BYTES });
  } catch {
    throw new Error('This is not a valid EPUB file.');
  }

  const container = files['META-INF/container.xml'];
  let opfPath = '';
  if (container) {
    const rootfile = arr(obj(obj(obj(xml.parse(strFromU8(container)))['container'])['rootfiles'])['rootfile'] as Obj | Obj[])[0];
    opfPath = rootfile ? text(rootfile['@_full-path']) : '';
  }
  const opfBytes = opfPath ? files[opfPath] : undefined;
  if (!opfBytes) throw new Error('This EPUB has no readable contents.');

  const pkg = obj(obj(xml.parse(strFromU8(opfBytes)))['package']);
  const opfDir = dirOf(opfPath);
  const meta = obj(pkg['metadata']);
  const title = text(meta['dc:title']) || 'Untitled book';
  const author = text(meta['dc:creator']) || undefined;

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of arr(obj(pkg['manifest'])['item'] as Obj | Obj[])) {
    manifest.set(text(it['@_id']), { href: joinZip(opfDir, text(it['@_href'])), type: text(it['@_media-type']), props: text(it['@_properties']) });
  }

  // Chapter titles from the nav document (EPUB 3) or NCX (EPUB 2).
  let titles = new Map<string, string>();
  const nav = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
  const ncx = [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
  if (nav && files[nav.href]) titles = navTitles(strFromU8(files[nav.href] as Uint8Array), dirOf(nav.href));
  else if (ncx && files[ncx.href]) titles = ncxTitles(obj(xml.parse(strFromU8(files[ncx.href] as Uint8Array))), dirOf(ncx.href));

  const chapters: EpubChapter[] = [];
  for (const ref of arr(obj(pkg['spine'])['itemref'] as Obj | Obj[])) {
    const item = manifest.get(text(ref['@_idref']));
    if (!item || !/x?html/.test(item.type) || !files[item.href]) continue;
    const idx = chapters.length;
    let chapterTitle = titles.get(item.href);
    if (!chapterTitle) {
      const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(strFromU8(files[item.href] as Uint8Array));
      chapterTitle = h ? stripTags(h[1] as string) : '';
    }
    chapters.push({ index: idx, path: item.href, title: chapterTitle || `Section ${idx + 1}` });
  }
  if (chapters.length === 0) throw new Error('This EPUB has no readable chapters.');

  const byPath = new Map(chapters.map((c) => [c.path, c.index]));
  return {
    title,
    author,
    chapters,
    chapterHtml(index) {
      const chapter = chapters[index];
      if (!chapter) return '';
      const dir = dirOf(chapter.path);
      return bodyOf(strFromU8(files[chapter.path] as Uint8Array)).replace(
        /(<img\b[^>]*?\bsrc=|<image\b[^>]*?href=)(["'])([^"']*)\2/gi,
        (_m, head: string, q: string, src: string) => {
          if (/^(data:|https?:)/i.test(src)) return `${head}${q}${src}${q}`;
          const uri = dataUri(joinZip(dir, src), files);
          return uri ? `${head}${q}${uri}${q}` : `${head}${q}${q}`;
        },
      );
    },
    resolveLink(fromIndex, href) {
      const from = chapters[fromIndex];
      if (!from || /^[a-z][a-z0-9+.-]*:/i.test(href)) return -1;
      return byPath.get(joinZip(dirOf(from.path), href)) ?? -1;
    },
  };
}
