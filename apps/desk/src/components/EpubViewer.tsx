import { openEpub, type EpubBook } from '@observe/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeHtml } from '../article';
import { isTauri } from '../platform';

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

interface Props {
  bytes: Uint8Array;
  chapter: number;
  /** 0 to 1 scroll position to restore when the chapter opens. */
  progress: number;
  onChapter: (chapter: number) => void;
  onProgress: (chapter: number, progress: number) => void;
  onLoaded: (book: { title: string; author?: string; chapters: string[] }) => void;
  onError: (message: string) => void;
}

const SIZES = [15, 17, 19, 22, 26];

export default function EpubViewer({ bytes, chapter, progress, onChapter, onProgress, onLoaded, onError }: Props) {
  const [size, setSize] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const restore = useRef(progress);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const book = useMemo<EpubBook | null>(() => {
    try {
      return openEpub(bytes);
    } catch (e) {
      queueMicrotask(() => onError(e instanceof Error ? e.message : 'This EPUB could not be opened.'));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => {
    if (book) onLoaded({ title: book.title, author: book.author, chapters: book.chapters.map((c) => c.title) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const index = book ? Math.min(Math.max(chapter, 0), book.chapters.length - 1) : 0;
  const html = useMemo(() => (book ? sanitizeHtml(book.chapterHtml(index)) : ''), [book, index]);

  // Restore the reading position once, when a chapter first shows; later chapters start at the top.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const r = restore.current;
    restore.current = 0;
    el.scrollTop = r > 0 ? r * Math.max(el.scrollHeight - el.clientHeight, 0) : 0;
  }, [html]);

  if (!book) return null;
  const last = book.chapters.length - 1;

  const onScroll = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = scroller.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      onProgress(index, max > 0 ? el.scrollTop / max : 0);
    }, 400);
  };

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) return void openExternal(href);
    const target = book.resolveLink(index, href);
    if (target >= 0) onChapter(target);
  };

  return (
    <div className="epub">
      <div className="viewer-bar">
        <button className="btn small" onClick={() => setTocOpen((o) => !o)} aria-expanded={tocOpen}>Contents</button>
        <button className="btn small" onClick={() => onChapter(index - 1)} disabled={index <= 0}>Previous</button>
        <span className="muted chapter-name">{book.chapters[index]?.title} ({index + 1} of {last + 1})</span>
        <button className="btn small" onClick={() => onChapter(index + 1)} disabled={index >= last}>Next</button>
        <span className="spacer" />
        <button className="btn small" aria-label="Smaller text" onClick={() => setSize((s) => Math.max(0, s - 1))} disabled={size === 0}>A-</button>
        <button className="btn small" aria-label="Larger text" onClick={() => setSize((s) => Math.min(SIZES.length - 1, s + 1))} disabled={size === SIZES.length - 1}>A+</button>
      </div>
      <div className="epub-body">
        {tocOpen && (
          <ol className="toc" aria-label="Contents">
            {book.chapters.map((c) => (
              <li key={c.index}>
                <button className={c.index === index ? 'toc-item on' : 'toc-item'} onClick={() => { onChapter(c.index); setTocOpen(false); }}>{c.title}</button>
              </li>
            ))}
          </ol>
        )}
        <div className="epub-scroll" ref={scroller} onScroll={onScroll}>
          {/* html went through DOMPurify (sanitizeHtml) */}
          <div className="article-body epub-text" style={{ fontSize: SIZES[size] }} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
