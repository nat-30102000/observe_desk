import { useEffect, useRef, useState } from 'react';
import { describeAiError, providerFor, readTextWithAi } from '../ai';
import { isTauri, ocrStaged, readStaged } from '../platform';
import { loadSettings } from '../service';

export interface Staged {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Run the built-in OCR as soon as the image shows up (screenshots). */
  autoOcr?: boolean;
}

interface Props {
  staged: Staged | null;
  text: string;
  onText: (t: string) => void;
  onName: (name: string) => void;
  onPick: (file: File) => void;
  onClear: () => void;
}

const isImage = (s: Staged) => s.mime.startsWith('image/');
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function FilePanel({ staged, text, onText, onName, onPick, onClear }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'ocr' | 'ai' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSettings().then(async (st) => setAiReady((await providerFor(st, 'summary')) !== null));
  }, []);

  // Preview of the staged image.
  useEffect(() => {
    setError(null);
    if (!staged || !isImage(staged)) return setPreview(null);
    let url: string | null = null;
    let live = true;
    void readStaged(staged.id).then((b) => {
      if (!live) return;
      url = URL.createObjectURL(new Blob([b as unknown as BlobPart], { type: staged.mime }));
      setPreview(url);
    }, () => setError('Could not show the picture.'));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [staged?.id]);

  const run = async (kind: 'ocr' | 'ai') => {
    if (!staged) return;
    setBusy(kind);
    setError(null);
    try {
      const out = kind === 'ocr' ? await ocrStaged(staged.id) : (await readTextWithAi(await loadSettings(), staged.mime, await readStaged(staged.id))).text;
      if (!out.trim()) setError('No text was found in the picture.');
      else onText(out.trim());
    } catch (e) {
      setError(describeAiError(e));
    } finally {
      setBusy(null);
    }
  };

  // Screenshots read their text straight away with the offline engine.
  useEffect(() => {
    if (staged?.autoOcr && isTauri()) void run('ocr');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged?.id]);

  return (
    <div className="filepanel">
      {!staged ? (
        <div className="dropzone">
          <p>Drop a file or picture here, paste an image (Ctrl+V), or</p>
          <button type="button" className="btn" onClick={() => input.current?.click()}>Choose a file</button>
          <input ref={input} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
          <p className="muted small">Up to 50 MB. It is saved in your Attachments folder with a note that shows it.</p>
        </div>
      ) : (
        <>
          {preview && <img className="staged-preview" src={preview} alt="Preview of the picture to save" />}
          <label>File name<input value={staged.name} onChange={(e) => onName(e.target.value)} /></label>
          <p className="muted small">{staged.mime || 'unknown type'} · {kb(staged.size)}</p>
          {isImage(staged) && (
            <div className="row">
              {isTauri() && <button type="button" className="btn small" disabled={busy !== null} onClick={() => void run('ocr')}>{busy === 'ocr' ? 'Reading...' : 'Read text (offline)'}</button>}
              {aiReady && <button type="button" className="btn small" disabled={busy !== null} onClick={() => void run('ai')} title="Sends the picture to your AI provider">{busy === 'ai' ? 'Reading...' : 'Read text with AI'}</button>}
            </div>
          )}
          <label>Text shown under it (optional)<textarea rows={4} value={text} onChange={(e) => onText(e.target.value)} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={onClear}>Choose a different file</button>
        </>
      )}
    </div>
  );
}
