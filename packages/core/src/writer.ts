import { parseFrontmatter } from './frontmatter';
import { blockId, renderBookmark, renderHighlight, renderMarkdownNote, renderSourceNote } from './notes';
import type { ObsidianClient } from './obsidian';
import { hostOf, joinPath, sanitizeFileName } from './paths';
import type { Capture, Folders } from './types';

export type WriteAction = 'created' | 'appended' | 'unchanged';
export interface WriteResult {
  path: string;
  action: WriteAction;
}

/**
 * Pick the note path for a title. If a note with that name exists but belongs to something else
 * (different url / capture id), try " (suffix)" variants.
 */
async function resolvePath(
  client: ObsidianClient,
  folder: string,
  title: string,
  suffix: string,
  matches: (existing: string) => boolean,
): Promise<{ path: string; existing: string | null }> {
  const base = sanitizeFileName(title);
  for (const name of [base, `${base} (${suffix})`]) {
    const path = joinPath(folder, `${name}.md`);
    const existing = await client.getNote(path);
    if (existing === null || matches(existing)) return { path, existing };
  }
  const path = joinPath(folder, `${base} (${suffix}-${Date.now().toString(36)}).md`);
  return { path, existing: null };
}

const sameUrl = (url: string) => (existing: string) => parseFrontmatter(existing).data['url'] === url;

export async function writeCapture(
  client: ObsidianClient,
  folders: Folders,
  c: Capture,
): Promise<WriteResult> {
  switch (c.kind) {
    case 'highlight': {
      const { path, existing } = await resolvePath(
        client,
        folders.clippings,
        c.source.title,
        hostOf(c.source.url),
        sameUrl(c.source.url),
      );
      if (existing === null) {
        await client.putNote(path, renderSourceNote(c));
        return { path, action: 'created' };
      }
      if (existing.includes(`^${blockId(c.id)}`)) return { path, action: 'unchanged' };
      await client.appendNote(path, renderHighlight(c));
      return { path, action: 'appended' };
    }
    case 'bookmark': {
      const { path, existing } = await resolvePath(
        client,
        folders.bookmarks,
        c.title,
        hostOf(c.url),
        sameUrl(c.url),
      );
      if (existing !== null) return { path, action: 'unchanged' };
      await client.putNote(path, renderBookmark(c));
      return { path, action: 'created' };
    }
    case 'markdown': {
      const { path, existing } = await resolvePath(
        client,
        folders.notes,
        c.title,
        c.id,
        (e) => parseFrontmatter(e).data['capture_id'] === c.id,
      );
      if (existing !== null) return { path, action: 'unchanged' };
      await client.putNote(path, renderMarkdownNote(c));
      return { path, action: 'created' };
    }
  }
}

export interface BookmarkEntry {
  path: string;
  title: string;
  url: string;
  description?: string;
  tags: string[];
  read: boolean;
  captured?: string;
}

/** Read bookmarks back out of the vault (the vault is the source of truth). */
export async function listBookmarks(client: ObsidianClient, folders: Folders): Promise<BookmarkEntry[]> {
  const files = (await client.listDir(folders.bookmarks)).filter((f) => f.endsWith('.md'));
  const out: BookmarkEntry[] = [];
  for (const file of files) {
    const path = joinPath(folders.bookmarks, file);
    const text = await client.getNote(path);
    if (text === null) continue;
    const { data } = parseFrontmatter(text);
    if (data['type'] !== 'bookmark' || typeof data['url'] !== 'string') continue;
    out.push({
      path,
      title: typeof data['title'] === 'string' ? data['title'] : file.replace(/\.md$/, ''),
      url: data['url'],
      description: typeof data['description'] === 'string' ? data['description'] : undefined,
      tags: Array.isArray(data['tags']) ? data['tags'] : [],
      read: data['read'] === true,
      captured: typeof data['captured'] === 'string' ? data['captured'] : undefined,
    });
  }
  return out;
}
