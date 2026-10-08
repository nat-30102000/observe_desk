import { describe, expect, it } from 'vitest';
import { addHighlight, bookId, cleanSelection, fileTitle, formatOf, removeBook, setPosition, upsertBook, type Library } from '../library';

const base = { id: 'a', title: 'Book', format: 'pdf' as const, lastOpened: '2026-10-08T00:00:00Z' };

describe('library', () => {
  it('detects format from the first bytes, then the extension', () => {
    expect(formatOf('x.bin', new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(formatOf('x.bin', Uint8Array.from([0x50, 0x4b, 3, 4]))).toBe('epub');
    expect(formatOf('Book.EPUB')).toBe('epub');
    expect(formatOf('notes.txt')).toBeNull();
  });
  it('makes stable ids and readable titles', () => {
    expect(bookId('C:\\books\\a.pdf')).toBe(bookId('C:\\books\\a.pdf'));
    expect(bookId('a')).not.toBe(bookId('b'));
    expect(fileTitle('C:\\books\\The_Slow_Book.pdf')).toBe('The Slow Book');
    expect(fileTitle('/x/y/Dune.epub')).toBe('Dune');
  });
  it('upsert keeps position and highlights, and moves the book to the front', () => {
    let lib: Library = upsertBook({ books: [] }, base);
    lib = setPosition(lib, 'a', 42, 0);
    lib = addHighlight(lib, 'a', { id: 'h1', text: 'quote', location: 'p. 42', at: 42, savedAt: 'x' });
    lib = upsertBook(lib, { id: 'b', title: 'Other', format: 'epub', lastOpened: 'y' });
    lib = upsertBook(lib, { ...base, path: 'C:\\a.pdf' });
    expect(lib.books.map((b) => b.id)).toEqual(['a', 'b']);
    expect(lib.books[0]).toMatchObject({ position: 42, path: 'C:\\a.pdf' });
    expect(lib.books[0]!.highlights).toHaveLength(1);
    expect(lib.books[1]).toMatchObject({ position: 0 });
  });
  it('ignores duplicate highlights at the same place and can remove books', () => {
    let lib = upsertBook({ books: [] }, base);
    const h = { id: 'h1', text: 'quote', location: 'p. 1', at: 1, savedAt: 'x' };
    lib = addHighlight(addHighlight(lib, 'a', h), 'a', { ...h, id: 'h2' });
    expect(lib.books[0]!.highlights).toHaveLength(1);
    expect(removeBook(lib, 'a').books).toEqual([]);
  });
  it('cleans selections', () => {
    expect(cleanSelection('A well-\nknown fact\nthat  spans   lines.')).toBe('A well- known fact that spans lines.');
    expect(cleanSelection('  one\n\ntwo ')).toBe('one two');
  });
});
