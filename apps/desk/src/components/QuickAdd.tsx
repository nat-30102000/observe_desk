import { newId, type Capture } from '@observe/core';
import { useEffect, useState } from 'react';
import { describeAiError, providerFor, suggestTags } from '../ai';
import { emitBus, hideWindow, listenBus } from '../platform';
import { loadSettings } from '../service';

type Kind = 'highlight' | 'markdown' | 'bookmark';
const TABS: Array<{ kind: Kind; label: string }> = [
  { kind: 'highlight', label: 'Highlight' },
  { kind: 'markdown', label: 'Markdown' },
  { kind: 'bookmark', label: 'Bookmark' },
];

const looksLikeUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

function parseTags(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, ''))
    .filter(Boolean);
}

/** Returns the capture, or a message explaining what is missing. */
export function buildCapture(kind: Kind, f: { text: string; url: string; title: string; note: string; tags: string }): Capture | string {
  const base = { id: newId(), createdAt: new Date().toISOString(), tags: parseTags(f.tags) };
  const url = f.url.trim();
  if (kind === 'bookmark') {
    if (!looksLikeUrl(url)) return 'A bookmark needs a link that starts with http:// or https://';
    return { ...base, kind: 'bookmark', url, title: f.title.trim() || new URL(url).hostname, description: f.note.trim() || undefined };
  }
  if (!f.text.trim()) return 'Add some text first.';
  if (kind === 'markdown') {
    return { ...base, kind: 'markdown', title: f.title.trim() || f.text.trim().split(/\r?\n/)[0]!.slice(0, 60), body: f.text };
  }
  if (!looksLikeUrl(url)) return 'Add the page link so the highlight knows where it came from.';
  return { ...base, kind: 'highlight', text: f.text, note: f.note.trim() || undefined, source: { url, title: f.title.trim() || new URL(url).hostname } };
}

export function QuickAdd() {
  const [kind, setKind] = useState<Kind>('highlight');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    void loadSettings().then(async (st) => setAiReady((await providerFor(st, 'tags')) !== null));
  }, [kind]);

  const askTags = async () => {
    const source = text.trim() || note.trim() || title.trim();
    if (!source) return setError('Add some text first so there is something to tag.');
    setAiBusy(true);
    setError(null);
    try {
      const r = await suggestTags(await loadSettings(), title.trim() || url || 'Untitled', source);
      setTags([...new Set([...parseTags(tags), ...r.tags])].join(', '));
    } catch (e) {
      setError(describeAiError(e));
    } finally {
      setAiBusy(false);
    }
  };

  const reset = () => {
    setText('');
    setUrl('');
    setTitle('');
    setNote('');
    setTags('');
    setError(null);
  };

  useEffect(() => {
    let off = () => undefined as void;
    void listenBus<{ text: string }>('quickadd:prefill', ({ text: t }) => {
      reset();
      const clip = t.trim();
      if (looksLikeUrl(clip)) {
        setKind('bookmark');
        setUrl(clip);
      } else {
        setKind('highlight');
        setText(clip);
      }
    }).then((u) => (off = u));
    return () => off();
  }, []);

  const save = async () => {
    const result = buildCapture(kind, { text, url, title, note, tags });
    if (typeof result === 'string') return setError(result);
    await emitBus('capture', result);
    reset();
    await hideWindow('quickadd');
  };

  const needsText = kind !== 'bookmark';
  const needsUrl = kind !== 'markdown';

  return (
    <form
      className="quickadd"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1>Quick add</h1>
      <div role="tablist" aria-label="Type" className="tabs">
        {TABS.map((t) => (
          <button key={t.kind} type="button" role="tab" aria-selected={kind === t.kind} className={kind === t.kind ? 'tab on' : 'tab'} onClick={() => setKind(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>
      {needsText && (
        <label>
          {kind === 'highlight' ? 'Highlighted text' : 'Markdown'}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={kind === 'markdown' ? 8 : 5} autoFocus />
        </label>
      )}
      {needsUrl && (
        <label>
          {kind === 'highlight' ? 'Source link' : 'Link'}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </label>
      )}
      <label>
        {kind === 'markdown' ? 'Note title (optional)' : 'Title (optional)'}
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {kind !== 'markdown' && (
        <label>
          {kind === 'bookmark' ? 'Description (optional)' : 'Your note (optional)'}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why does this matter?" />
        </label>
      )}
      <label>
        Tags
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="research, reading" />
      </label>
      {aiReady && <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} disabled={aiBusy} onClick={() => void askTags()}>{aiBusy ? 'Thinking...' : 'Suggest tags with AI'}</button>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row end">
        <button type="button" className="btn" onClick={() => void hideWindow('quickadd')}>Cancel</button>
        <button type="submit" className="btn primary">Save</button>
      </div>
    </form>
  );
}
