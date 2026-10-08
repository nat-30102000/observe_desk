import { chunk, detectImport, IMPORT_LABEL, parseImport, summarizeImport, type Capture, type ImportKind } from '@observe/core';
import { useRef, useState } from 'react';
import { emitBus } from '../platform';

const BATCH = 200;
const MAX_BYTES = 60 * 1024 * 1024;

interface Loaded {
  name: string;
  kind: ImportKind;
  captures: Capture[];
}

/** Bring in highlights and bookmarks you collected elsewhere. */
export function ImportView() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    setError(null);
    setSent(null);
    setLoaded(null);
    if (file.size > MAX_BYTES) return setError('That file is larger than 60 MB.');
    const text = await file.text();
    const kind = detectImport(text);
    if (!kind) return setError('I do not recognise this file. Supported: Readwise CSV, Kindle "My Clippings.txt", and Pocket exports (HTML or CSV).');
    const captures = parseImport(kind, text);
    if (captures.length === 0) return setError('That file is the right kind but has nothing I can import.');
    setLoaded({ name: file.name, kind, captures });
  };

  const send = async () => {
    if (!loaded) return;
    for (const part of chunk(loaded.captures, BATCH)) await emitBus('capture-batch', part);
    setSent(`Sent ${loaded.captures.length} items to Nib. They are filed in the background, so you can keep working. Importing the same file again is safe: nothing is duplicated.`);
    setLoaded(null);
  };

  const sample = loaded?.captures.slice(0, 5) ?? [];

  return (
    <section>
      <header className="bar"><h1>Import</h1></header>
      <div className="panel">
        <h2>Bring your reading over</h2>
        <ul className="muted importlist">
          <li><strong>Readwise:</strong> readwise.io, then Export, then CSV</li>
          <li><strong>Kindle:</strong> the <code>My Clippings.txt</code> file on your Kindle (documents folder)</li>
          <li><strong>Pocket:</strong> the export file (HTML or CSV) from getpocket.com/export</li>
        </ul>
        <div className="row">
          <button className="btn primary" onClick={() => input.current?.click()}>Choose a file</button>
          <input ref={input} hidden type="file" accept=".csv,.txt,.html,.htm" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {sent && <p className="okmsg" role="status">{sent}</p>}
      </div>

      {loaded && (
        <div className="panel">
          <h2>{IMPORT_LABEL[loaded.kind]}</h2>
          <p><strong>{summarizeImport(loaded.captures)}</strong> found in {loaded.name}.</p>
          <ul className="cards">
            {sample.map((c) => (
              <li key={c.id} className="card">
                <div className="meta">{c.kind}</div>
                <div className="title">{c.kind === 'highlight' ? c.source.title : c.kind === 'bookmark' ? c.title : ''}</div>
                <div className="snippet">{c.kind === 'highlight' ? c.text : c.kind === 'bookmark' ? c.url : ''}</div>
              </li>
            ))}
          </ul>
          {loaded.captures.length > sample.length && <p className="muted small">...and {loaded.captures.length - sample.length} more.</p>}
          <div className="row">
            <button className="btn primary" onClick={() => void send()}>Import {loaded.captures.length} items</button>
            <button className="btn" onClick={() => setLoaded(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
