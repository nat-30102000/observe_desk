import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';

export interface PdfInfo {
  title?: string;
  author?: string;
  pages: number;
}

interface Props {
  bytes: Uint8Array;
  page: number;
  onPage: (page: number) => void;
  onLoaded: (info: PdfInfo) => void;
  onError: (message: string) => void;
}

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 3];

/** One page at a time: a canvas for the picture and pdf.js's text layer on top so text can be selected. */
export default function PdfViewer({ bytes, page, onPage, onLoaded, onError }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(2);
  const [rendering, setRendering] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  // Load the document once per file.
  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        // pdf.js takes ownership of the buffer, so give it a copy.
        task = pdfjs.getDocument({ data: bytes.slice() });
        const loaded = await task.promise;
        if (!live) return;
        const meta = await loaded.getMetadata().catch(() => null);
        const info = (meta?.info ?? {}) as Record<string, unknown>;
        onLoaded({ title: typeof info['Title'] === 'string' && info['Title'].trim() ? info['Title'] : undefined, author: typeof info['Author'] === 'string' && info['Author'].trim() ? info['Author'] : undefined, pages: loaded.numPages });
        setDoc(loaded);
      } catch (e) {
        console.error('pdf load failed', e);
        if (live) onError(e instanceof Error && /password/i.test(e.message) ? 'This PDF is password protected, which is not supported yet.' : 'This PDF could not be opened.');
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth - 32)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth - 32));
    return () => ro.disconnect();
  }, []);

  // Draw the current page.
  useEffect(() => {
    if (!doc || !canvas.current || !textLayer.current) return;
    let live = true;
    let task: RenderTask | null = null;
    setRendering(true);
    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const p = await doc.getPage(Math.min(Math.max(page, 1), doc.numPages));
      const base = p.getViewport({ scale: 1 });
      const scale = (width / base.width) * (ZOOMS[zoom] ?? 1);
      const viewport = p.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      c.style.width = `${Math.floor(viewport.width)}px`;
      c.style.height = `${Math.floor(viewport.height)}px`;
      const f = frame.current!;
      f.style.width = c.style.width;
      f.style.height = c.style.height;
      f.style.setProperty('--scale-factor', String(scale));
      f.style.setProperty('--total-scale-factor', String(scale));
      task = p.render({ canvas: c, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task.promise;
      if (!live) return;
      const layer = textLayer.current!;
      layer.replaceChildren();
      await new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: layer, viewport }).render();
      if (live) setRendering(false);
    })().catch((e: unknown) => {
      // A cancelled render (page changed quickly) is normal.
      if (live && !(e instanceof Error && /cancel/i.test(e.name + e.message))) onError('A page could not be drawn.');
    });
    return () => {
      live = false;
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page, width, zoom]);

  const total = doc?.numPages ?? 0;
  const go = (n: number) => onPage(Math.min(Math.max(n, 1), Math.max(total, 1)));

  return (
    <div
      className="pdf"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') go(page + 1);
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(page - 1);
      }}
    >
      <div className="viewer-bar">
        <button className="btn small" onClick={() => go(page - 1)} disabled={page <= 1}>Previous</button>
        <label className="inline">
          <span className="sr">Page</span>
          <input
            className="pageno"
            inputMode="numeric"
            aria-label="Page number"
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''));
              if (n >= 1) go(n);
            }}
          />
          <span className="muted">of {total || '...'}</span>
        </label>
        <button className="btn small" onClick={() => go(page + 1)} disabled={page >= total}>Next</button>
        <span className="spacer" />
        <button className="btn small" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0}>A-</button>
        <button className="btn small" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1}>A+</button>
      </div>
      <div className="pdf-stage" ref={stage}>
        <div className="pdf-frame" ref={frame} aria-busy={rendering}>
          <canvas ref={canvas} />
          <div className="textLayer" ref={textLayer} />
        </div>
      </div>
    </div>
  );
}
