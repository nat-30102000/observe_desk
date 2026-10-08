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
  /** Imported bookmarks may already be read. */
  read?: boolean;
}

export interface MarkdownCapture extends CaptureBase {
  kind: 'markdown';
  title: string;
  body: string;
  /** Extra frontmatter, e.g. email sender and subject. Keys are limited to a-z, 0-9 and underscore. */
  meta?: Record<string, string>;
}

/** A dropped or pasted file or image. The bytes wait in a staging area outside the queue file. */
export interface FileCapture extends CaptureBase {
  kind: 'file';
  name: string;
  mime: string;
  size: number;
  /** Text to put under the embedded file, e.g. OCR output or a caption. */
  text?: string;
  /** Chosen on the first write attempt and kept, so retries overwrite the same file. */
  attachmentPath?: string;
  notePath?: string;
}

export type Capture = HighlightCapture | BookmarkCapture | MarkdownCapture | FileCapture;

export interface Folders {
  clippings: string;
  bookmarks: string;
  notes: string;
  subscriptions: string;
  attachments: string;
}

export const DEFAULT_FOLDERS: Folders = {
  clippings: 'Clippings',
  bookmarks: 'Bookmarks',
  notes: 'Notes',
  subscriptions: 'Subscriptions',
  attachments: 'Attachments',
};

export function newId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
