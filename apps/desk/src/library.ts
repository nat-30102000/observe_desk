export type BookFormat = 'pdf' | 'epub';

export interface BookHighlight {
  id: string;
  text: string;
  /** "p. 12" or a chapter title. */
  location: string;
  /** 1-based page (PDF) or 0-based chapter index (EPUB), used to jump back. */
  at: number;
  note?: string;
  savedAt: string;
}

export interface LibraryBook {
  id: string;
  /** Only known when opened through the file dialog; lets the book reopen after a restart. */
  path?: string;
  title: string;
  author?: string;
  format: BookFormat;
  addedAt: string;
  lastOpened: string;
  /** 1-based page (PDF) or 0-based chapter (EPUB). */
  position: number;
  /** 0 to 1 scroll inside the current EPUB chapter. */
  progress: number;
  pages?: number;
  highlights: BookHighlight[];
}

export interface Library {
  books: LibraryBook[];
}

export const MAX_HIGHLIGHTS_PER_BOOK = 500;
export const MAX_BOOKS = 100;

/** Short stable id from a path (or "name:size" when there is no path). */
export function bookId(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function formatOf(nameOrPath: string, head?: Uint8Array): BookFormat | null {
  if (head && head.length >= 5 && String.fromCharCode(...head.slice(0, 5)) === '%PDF-') return 'pdf';
  if (head && head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) return 'epub'; // "PK" zip
  const ext = nameOrPath.toLowerCase().split('.').pop();
  return ext === 'pdf' ? 'pdf' : ext === 'epub' ? 'epub' : null;
}

export function fileTitle(nameOrPath: string): string {
  return (nameOrPath.split(/[\\/]/).pop() ?? nameOrPath).replace(/\.(pdf|epub)$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled book';
}

/** Add a book or refresh an existing one (keeps position and highlights). Most recent first. */
export function upsertBook(lib: Library, book: Omit<LibraryBook, 'position' | 'progress' | 'highlights' | 'addedAt'> & Partial<LibraryBook>): Library {
  const old = lib.books.find((b) => b.id === book.id);
  const merged: LibraryBook = {
    position: old?.position ?? (book.format === 'pdf' ? 1 : 0),
    progress: old?.progress ?? 0,
    highlights: old?.highlights ?? [],
    addedAt: old?.addedAt ?? book.lastOpened,
    ...old,
    ...book,
    path: book.path ?? old?.path,
  };
  return { books: [merged, ...lib.books.filter((b) => b.id !== book.id)].slice(0, MAX_BOOKS) };
}

export function setPosition(lib: Library, id: string, position: number, progress = 0): Library {
  return { books: lib.books.map((b) => (b.id === id ? { ...b, position, progress } : b)) };
}

/** Returns the library unchanged when the same passage is already saved at that spot. */
export function addHighlight(lib: Library, id: string, h: BookHighlight): Library {
  return {
    books: lib.books.map((b) => {
      if (b.id !== id) return b;
      if (b.highlights.some((x) => x.text === h.text && x.at === h.at)) return b;
      return { ...b, highlights: [h, ...b.highlights].slice(0, MAX_HIGHLIGHTS_PER_BOOK) };
    }),
  };
}

export function removeBook(lib: Library, id: string): Library {
  return { books: lib.books.filter((b) => b.id !== id) };
}

/** Selected text from a PDF or EPUB: line breaks become spaces. Hyphens are left alone, since a line-end hyphen can be real. */
export function cleanSelection(raw: string): string {
  return raw
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
