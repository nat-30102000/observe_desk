import { newId, type Capture } from '@observe/core';
import { useEffect, useState } from 'react';
import { describeAiError, providerFor, suggestTags } from '../ai';
import { emitBus, hideWindow, listenBus, removeStaged, stageFile } from '../platform';
import { loadSettings } from '../service';
import { FilePanel, type Staged } from './FilePanel';
import { ImportPanel, importKind, type Imported } from './ImportPanel';

type Kind = 'highlight' | 'markdown' | 'bookmark';
type Tab = Kind | 'file' | 'import';
const TABS: Array<{ kind: Tab; label: string }> = [
  { kind: 'highlight', label: 'Highlight' },
  { kind: 'markdown', label: 'Markdown' },
  { kind: 'bookmark', label: 'Bookmark' },
  { kind: 'file', label: 'File' },
  { kind: 'import', label: 'Video or thread' },
];
const MAX_FILE = 50 * 1024 * 1024;
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');

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
  const [tab, setTab] = useState<Tab>('highlight');
  const kind: Kind = tab === 'markdown' || tab === 'bookmark' ? tab : 'highlight';
  const [staged, setStaged] = useState<Staged | null>(null);
  const [fileText, setFileText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [imported, setImported] = useState<Imported | null>(null);
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
  }, [tab]);

  const askTags = async () => {
    const source = (tab === 'file' ? fileText : tab === 'import' ? (imported?.body ?? '') : text).trim() || note.trim() || title.trim();
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
    setStaged(null);
    setFileText('');
    setImportUrl('');
    setImported(null);
  };

  const stage = async (file: File) => {
    setError(null);
    if (file.size > MAX_FILE) return setError('That file is larger than 50 MB.');
    try {
      const id = newId();
      await stageFile(id, new Uint8Array(await file.arrayBuffer()));
      if (staged) void removeStaged(staged.id);
      setStaged({ id, name: file.name || `Pasted file ${stamp()}`, mime: file.type, size: file.size });
      setFileText('');
      setTab('file');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    let off = () => undefined as void;
    void listenBus<{ text?: string; screenshot?: Staged }>('quickadd:prefill', ({ text: t, screenshot }) => {
      reset();
      if (screenshot) {
        setTab('file');
        setStaged({ ...screenshot, autoOcr: true });
        return;
      }
      const clip = (t ?? '').trim();
      if (looksLikeUrl(clip) && importKind(clip)) {
        setTab('import');
        setImportUrl(clip);
      } else if (looksLikeUrl(clip)) {
        setTab('bookmark');
        setUrl(clip);
      } else {
        setTab('highlight');
        setText(clip);
      }
    }).then((u) => (off = u));
    return () => off();
  }, []);

  const save = async () => {
    const base = { id: newId(), createdAt: new Date().toISOString(), tags: parseTags(tags) };
    let result: Capture | string;
    if (tab === 'file') {
      result = staged ? { ...base, id: staged.id, kind: 'file', name: staged.name.trim() || 'File', mime: staged.mime, size: staged.size, text: fileText.trim() || undefined } : 'Choose a file first.';
    } else if (tab === 'import') {
      result = imported && imported.body.trim() ? { ...base, kind: 'markdown', title: imported.title.trim() || 'Imported note', body: imported.body, tags: [...imported.tags, ...base.tags] } : 'Fetch the video or thread first.';
    } else result = buildCapture(kind, { text, url, title, note, tags });
    if (typeof result === 'string') return setError(result);
    await emitBus('capture', result);
    reset();
    await hideWindow('quickadd');
  };

  const cancel = () => {
    if (staged) void removeStaged(staged.id);
    reset();
    void hideWindow('quickadd');
  };

  const simple = tab !== 'file' && tab !== 'import';
  const needsText = kind !== 'bookmark';
  const needsUrl = kind !== 'markdown';

  return (
    <form
      className="quickadd"
      onPaste={(e) => {
        const f = e.clipboardData.files[0];
        if (f) {
          e.preventDefault();
          void stage(f.name ? f : new File([f], `Pasted image ${stamp()}.png`, { type: f.type || 'image/png' }));
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const f = e.dataTransfer.files[0];
        if (f) {
          e.preventDefault();
          void stage(f);
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1>Quick add</h1>
      <div role="tablist" aria-label="Type" className="tabs">
        {TABS.map((t) => (
          <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind} className={tab === t.kind ? 'tab on' : 'tab'} onClick={() => setTab(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'file' && <FilePanel staged={staged} text={fileText} onText={setFileText} onName={(name) => staged && setStaged({ ...staged, name })} onPick={(f) => void stage(f)} onClear={() => { if (staged) void removeStaged(staged.id); setStaged(null); setFileText(''); }} />}
      {tab === 'import' && <ImportPanel url={importUrl} onUrl={setImportUrl} imported={imported} onImported={setImported} />}
      {simple && needsText && (
        <label>
          {kind === 'highlight' ? 'Highlighted text' : 'Markdown'}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={kind === 'markdown' ? 8 : 5} autoFocus />
        </label>
      )}
      {simple && needsUrl && (
        <label>
          {kind === 'highlight' ? 'Source link' : 'Link'}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </label>
      )}
      {simple && (
        <label>
          {kind === 'markdown' ? 'Note title (optional)' : 'Title (optional)'}
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      )}
      {simple && kind !== 'markdown' && (
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
        <button type="button" className="btn" onClick={cancel}>Cancel</button>
        <button type="submit" className="btn primary">Save</button>
      </div>
    </form>
  );
}
