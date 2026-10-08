import { toFrontmatter } from './frontmatter';
import type { BookmarkCapture, HighlightCapture, MarkdownCapture } from './types';

export const blockId = (id: string): string => `h-${id}`;

const day = (iso: string): string => iso.slice(0, 10);

export function renderSourceNote(c: HighlightCapture): string {
  const fm = toFrontmatter({
    type: 'clipping',
    url: c.source.url,
    title: c.source.title,
    ...(c.source.author ? { author: c.source.author } : {}),
    ...(c.source.format ? { format: c.source.format } : {}),
    captured: day(c.createdAt),
    tags: ['clippings', ...c.tags.filter((t) => t !== 'clippings')],
  });
  return `${fm}\n## Highlights\n${renderHighlight(c)}`;
}

/** One highlight block. The trailing ^h-<id> is an Obsidian block id, used to keep appends idempotent. */
export function renderHighlight(c: HighlightCapture): string {
  const quote = c.text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  const where = c.location?.trim() ? `\n*${c.location.trim().replace(/[*\r\n]+/g, ' ')}*\n` : '';
  const note = c.note?.trim() ? `\n${c.note.trim()}\n` : '';
  return `\n${quote} ^${blockId(c.id)}\n${where}${note}`;
}

export function renderBookmark(c: BookmarkCapture): string {
  const fm = toFrontmatter({
    type: 'bookmark',
    url: c.url,
    title: c.title,
    ...(c.description ? { description: c.description } : {}),
    captured: day(c.createdAt),
    read: false,
    tags: ['bookmarks', ...c.tags.filter((t) => t !== 'bookmarks')],
  });
  return `${fm}\n# ${c.title}\n\n<${c.url}>\n${c.description ? `\n${c.description}\n` : ''}`;
}

export function renderMarkdownNote(c: MarkdownCapture): string {
  const fm = toFrontmatter({
    type: 'note',
    capture_id: c.id,
    captured: day(c.createdAt),
    tags: c.tags,
  });
  return `${fm}\n${c.body.trim()}\n`;
}
