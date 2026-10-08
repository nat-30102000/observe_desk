import { newId, type Capture } from '@observe/core';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  addHighlight,
  bookId,
  cleanSelection,
  fileTitle,
  formatOf,
  removeBook,
  setPosition,
  upsertBook,
  type BookHighlight,
  type Library as LibraryData,
  type LibraryBook,
} from '../library';
import { emitBus, isTauri, loadJson, pickBook, readBook, saveJson } from '../platform';

const PdfViewer = lazy(() => import('./PdfViewer'));
const EpubViewer = lazy(() => import('./EpubViewer'));

const EMPTY: LibraryData = { books: [] };

async function loadLibrary(): Promise<LibraryData> {
  const saved = await loadJson<LibraryData>('library');
  return saved && Array.isArray(saved.books) ? saved : EMPTY;
}

interface Open {
  bookId: string;
  bytes: Uint8Array;
}

export function Library() {
  const [lib, setLib] = useState<LibraryData>(EMPTY);
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState<string | null>(null);
  const libRef = useRef(lib);
  libRef.current = lib;

  useEffect(() => {
    void loadLibrary().then(setLib);
  }, []);

  /** Apply a change to the library and save it. */
  const update = useCallback((fn: (l: LibraryData) => LibraryData) => {
    const next = fn(libRef.current);
    libRef.current = next;
    setLib(next);
    void saveJson('library', next);
  }, []);

  const start = (name: string, path: string | undefined, bytes: Uint8Array) => {
    const format = formatOf(name, bytes);
    if (!format) return setError('Only PDF and EPUB files can be opened.');
    const id = bookId(path ?? `${name}:${bytes.length}`);
    update((l) => upsertBook(l, { id, path, title: l.books.find((b) => b.id === id)?.title ?? fileTitle(name), format, lastOpened: new Date().toISOString() }));
    setOpen({ bookId: id, bytes });
    setError(null);
  };

  const choose = async () => {
    setError(null);
    try {
      const picked = await pickBook();
      if (picked) start(picked.name, picked.path, picked.bytes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reopen = async (b: LibraryBook) => {
    setError(null);
    if (!b.path || !isTauri()) return void choose();
    try {
      start(b.path, b.path, await readBook(b.path));
    } catch {
      setError(`Could not find "${b.title}" at its saved location. Choose the file again.`);
    }
  };

  const current = open ? lib.books.find((b) => b.id === open.bookId) : undefined;
  if (open && current) {
    return <BookView book={current} bytes={open.bytes} update={update} onClose={() => setOpen(null)} />;
  }

  return (
    <section>
      <header className="bar">
        <h1>Library</h1>
        <button className="btn primary" onClick={() => void choose()}>Open a PDF or EPUB</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {lib.books.length === 0 && <p className="muted">Open a book to read it here. Select text and press Highlight to send the quote, with its page or chapter, to your Obsidian vault.</p>}
      <ul className="cards">
        {lib.books.map((b) => (
          <li key={b.id} className="card book">
            <div className="meta">{b.format.toUpperCase()}{b.author ? ` · ${b.author}` : ''}{b.format === 'pdf' && b.pages ? ` · page ${b.position} of ${b.pages}` : b.format === 'epub' ? ` · chapter ${b.position + 1}` : ''}</div>
            <div className="title">{b.title}</div>
            <div className="meta">{b.highlights.length} highlight{b.highlights.length === 1 ? '' : 's'}</div>
            <div className="row">
              <button className="btn small primary" onClick={() => void reopen(b)}>{b.path && isTauri() ? 'Continue reading' : 'Choose file to continue'}</button>
              <button className="btn small" onClick={() => update((l) => removeBook(l, b.id))}>Remove from list</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ViewProps {
  book: LibraryBook;
  bytes: Uint8Array;
  update: (fn: (l: LibraryData) => LibraryData) => void;
  onClose: () => void;
}

function BookView({ book, bytes, update, onClose }: ViewProps) {
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const chapters = useRef<string[]>([]);
  const mainRef = useRef<HTMLDivElement>(null);
  /** Last selection made inside the book, so typing a note afterwards does not lose it. */
  const lastSelection = useRef('');

  const rememberSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString() ?? '';
    if (text.trim() && sel?.anchorNode && mainRef.current?.contains(sel.anchorNode)) lastSelection.current = text;
  };

  const locationFor = (at: number): string => (book.format === 'pdf' ? `p. ${at}` : (chapters.current[at] ?? `Chapter ${at + 1}`));

  const highlight = () => {
    const raw = window.getSelection()?.toString() || lastSelection.current;
    const text = cleanSelection(raw);
    if (!text) return setMessage('Select some text in the book first.');
    const at = book.position;
    const location = locationFor(at);
    const entry: BookHighlight = { id: newId(), text, location, at, note: note.trim() || undefined, savedAt: new Date().toISOString() };
    const capture: Capture = {
      id: entry.id,
      kind: 'highlight',
      createdAt: entry.savedAt,
      tags: ['books'],
      text,
      note: entry.note,
      location,
      source: { url: `book://${book.id}`, title: book.title, author: book.author, format: book.format },
    };
    update((l) => addHighlight(l, book.id, entry));
    void emitBus('capture', capture);
    setNote('');
    lastSelection.current = '';
    window.getSelection()?.removeAllRanges();
    setMessage(`Sent to Nib (${location}).`);
  };

  const setBook = (patch: Partial<LibraryBook>) => update((l) => ({ books: l.books.map((b) => (b.id === book.id ? { ...b, ...patch } : b)) }));

  return (
    <section className="bookview">
      <header className="bar">
        <button className="btn small" onClick={onClose}>Back to library</button>
        <h1 className="book-title">{book.title}</h1>
        {book.author && <span className="muted">{book.author}</span>}
        <span className="spacer" />
        <button className="btn small" aria-expanded={showList} onClick={() => setShowList((s) => !s)}>Highlights ({book.highlights.length})</button>
      </header>

      <div className="hl-bar">
        <input aria-label="Note for the next highlight" placeholder="Optional note for the next highlight" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && highlight()} />
        <button className="btn primary" onClick={highlight}>Highlight selection</button>
      </div>
      {message && <p className="okmsg" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="book-split">
        <div className="book-main" ref={mainRef} onMouseUp={rememberSelection} onKeyUp={rememberSelection}>
          <Suspense fallback={<p className="muted">Opening the book...</p>}>
            {book.format === 'pdf' ? (
              <PdfViewer
                bytes={bytes}
                page={book.position}
                onPage={(p) => setBook({ position: p, progress: 0 })}
                onLoaded={(info) => setBook({ pages: info.pages, ...(info.title && book.title === fileTitle(book.path ?? book.title) ? { title: info.title } : {}), ...(info.author ? { author: info.author } : {}) })}
                onError={setError}
              />
            ) : (
              <EpubViewer
                bytes={bytes}
                chapter={book.position}
                progress={book.progress}
                onChapter={(c) => setBook({ position: c, progress: 0 })}
                onProgress={(c, p) => update((l) => setPosition(l, book.id, c, p))}
                onLoaded={(info) => {
                  chapters.current = info.chapters;
                  setBook({ title: info.title, author: info.author });
                }}
                onError={setError}
              />
            )}
          </Suspense>
        </div>
        {showList && (
          <aside className="hl-list" aria-label="Highlights in this book">
            {book.highlights.length === 0 && <p className="muted">Nothing highlighted yet.</p>}
            {book.highlights.map((h) => (
              <button key={h.id} className="hl-item" onClick={() => setBook({ position: h.at, progress: 0 })}>
                <span className="meta">{h.location}</span>
                <span className="snippet">{h.text}</span>
                {h.note && <span className="muted small">{h.note}</span>}
              </button>
            ))}
          </aside>
        )}
      </div>
    </section>
  );
}
