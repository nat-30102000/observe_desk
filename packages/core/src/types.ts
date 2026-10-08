export interface Source {
  url: string;
  title: string;
  author?: string;
  /** Set for books opened in the reader. */
  format?: 'pdf' | 'epub';
}

interface CaptureBase {
  /** Short stable id; makes writes idempotent. */
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  tags: string[];
}

export interface HighlightCapture extends CaptureBase {
  kind: 'highlight';
  source: Source;
  text: string;
  note?: string;
  /** Where in the source: "p. 12" for PDFs, a chapter title for EPUBs. */
  location?: string;
}

export interface BookmarkCapture extends CaptureBase {
  kind: 'bookmark';
  url: string;
  title: string;
  description?: string;
}

export interface MarkdownCapture extends CaptureBase {
  kind: 'markdown';
  title: string;
  body: string;
}

export type Capture = HighlightCapture | BookmarkCapture | MarkdownCapture;

export interface Folders {
  clippings: string;
  bookmarks: string;
  notes: string;
  subscriptions: string;
}

export const DEFAULT_FOLDERS: Folders = {
  clippings: 'Clippings',
  bookmarks: 'Bookmarks',
  notes: 'Notes',
  subscriptions: 'Subscriptions',
};

export function newId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
