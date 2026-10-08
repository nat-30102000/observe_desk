import { newId, providerInfo, type Capture, type ProviderId } from '@observe/core';
import { useEffect, useRef, useState } from 'react';
import { extractArticle, htmlToMarkdown, sanitizeHtml, type Article } from '../article';
import { describeAiError, providerFor, suggestTags, summarize } from '../ai';
import { emitBus, httpGet, isTauri } from '../platform';
import { loadSettings } from '../service';

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
  const [aiProvider, setAiProvider] = useState<{ summary: ProviderId | null; tags: ProviderId | null }>({ summary: null, tags: null });
  const [summary, setSummary] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState<'summary' | 'tags' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then(async (st) => setAiProvider({ summary: await providerFor(st, 'summary'), tags: await providerFor(st, 'tags') }));
  }, []);

  // A new article starts without the previous article's AI output.
  useEffect(() => {
    setSummary(null);
    setTags([]);
    setChosen(new Set());
    setAiError(null);
  }, [url]);

  const askAi = async (task: 'summary' | 'tags') => {
    if (!article) return;
    setAiBusy(task);
    setAiError(null);
    try {
      const st = await loadSettings();
      const text = article.text || article.html.replace(/<[^>]+>/g, ' ');
      if (task === 'summary') setSummary((await summarize(st, article.title, text)).summary);
      else {
        const r = await suggestTags(st, article.title, text);
        setTags(r.tags);
        setChosen(new Set(r.tags));
      }
    } catch (e) {
      setAiError(describeAiError(e));
    } finally {
      setAiBusy(null);
    }
  };

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
    const capture: Capture = { ...base(), kind: 'markdown', title: article.title, tags: ['clippings', ...chosen], body: `Source: <${url}>\n\n${summary ? `## Summary\n${summary}\n\n## Article\n` : ''}${htmlToMarkdown(article.html)}` };
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
      {(aiProvider.summary || aiProvider.tags) && (
        <div className="reader-bar">
          {aiProvider.summary && <button className="btn small" disabled={!article || aiBusy !== null} onClick={() => void askAi('summary')}>{aiBusy === 'summary' ? 'Summarizing...' : 'Summarize'}</button>}
          {aiProvider.tags && <button className="btn small" disabled={!article || aiBusy !== null} onClick={() => void askAi('tags')}>{aiBusy === 'tags' ? 'Thinking...' : 'Suggest tags'}</button>}
          <span className="muted small">Sends this article's text to {providerInfo((aiProvider.summary ?? aiProvider.tags)!).label}.</span>
        </div>
      )}
      {aiError && <p className="error" role="alert">{aiError}</p>}
      {summary && (
        <div className="ai-box">
          <h3>Summary</h3>
          <ul>{summary.split('\n').map((l, i) => <li key={i}>{l.replace(/^-\s*/, '')}</li>)}</ul>
          <p className="muted small">Made by AI, so check it. It is added to the note when you press Clip article.</p>
        </div>
      )}
      {tags.length > 0 && (
        <div className="ai-box">
          <h3>Suggested tags</h3>
          <div className="tagrow">
            {tags.map((t) => (
              <button key={t} className={chosen.has(t) ? 'tagbtn on' : 'tagbtn'} aria-pressed={chosen.has(t)} onClick={() => setChosen((c) => { const n = new Set(c); if (n.has(t)) n.delete(t); else n.add(t); return n; })}>#{t}</button>
            ))}
          </div>
          <p className="muted small">Selected tags are added when you press Clip article.</p>
        </div>
      )}
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
