import { newId, type Capture } from '@observe/core';
import { useEffect, useRef, useState } from 'react';
import { extractArticle, htmlToMarkdown, sanitizeHtml, type Article } from '../article';
import { emitBus, httpGet, isTauri } from '../platform';

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

interface Props {
  url: string;
  title: string;
  /** Shown if the page itself cannot be fetched or parsed (e.g. the feed's own content). */
  fallbackHtml?: string;
  onClose?: () => void;
}

export function Reader({ url, title, fallbackHtml, onClose }: Props) {
  const [article, setArticle] = useState<Article | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setState('loading');
    setArticle(null);
    setMessage(null);
    const useFallback = () => {
      if (!live) return;
      if (fallbackHtml) {
        setArticle({ title, html: sanitizeHtml(fallbackHtml), text: '' });
        setState('fallback');
      } else setState('error');
    };
    httpGet(url)
      .then((res) => {
        if (!live) return;
        const a = res.status < 400 ? extractArticle(res.body, res.finalUrl) : null;
        if (a) {
          setArticle(a);
          setState('ready');
        } else useFallback();
      })
      .catch(useFallback);
    return () => {
      live = false;
    };
  }, [url, title, fallbackHtml]);

  const base = () => ({ id: newId(), createdAt: new Date().toISOString(), tags: [] as string[] });

  const clipArticle = () => {
    if (!article) return;
    const capture: Capture = { ...base(), kind: 'markdown', title: article.title, tags: ['clippings'], body: `Source: <${url}>\n\n${htmlToMarkdown(article.html)}` };
    void emitBus('capture', capture);
    setMessage('Sent to Nib. It will be filed in Notes.');
  };

  const highlight = () => {
    const text = window.getSelection()?.toString().trim();
    if (!text) return setMessage('Select some text in the article first.');
    const capture: Capture = { ...base(), kind: 'highlight', text, source: { url, title: article?.title ?? title, author: article?.byline } };
    void emitBus('capture', capture);
    setMessage('Highlight sent to Nib.');
  };

  // Links inside an article must open in the real browser, never navigate the app.
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href && /^https?:\/\//i.test(href)) void openExternal(href);
  };

  return (
    <article className="reader">
      <div className="reader-bar">
        {onClose && <button className="btn small" onClick={onClose}>Back</button>}
        <button className="btn small" onClick={highlight} disabled={!article}>Highlight selection</button>
        <button className="btn small primary" onClick={clipArticle} disabled={!article}>Clip article</button>
        <button className="btn small" onClick={() => void openExternal(url)}>Open original</button>
      </div>
      {message && <p className="okmsg" role="status">{message}</p>}
      {state === 'loading' && <p className="muted">Loading the article...</p>}
      {state === 'error' && <p className="error">Could not load this page. Use Open original instead.</p>}
      {state === 'fallback' && <p className="muted">Showing the feed's own text, because the full page could not be read.</p>}
      {article && (
        <>
          <h1>{article.title}</h1>
          {article.byline && <p className="muted">{article.byline}</p>}
          {/* article.html went through DOMPurify in article.ts */}
          <div ref={body} className="article-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: article.html }} />
        </>
      )}
    </article>
  );
}
