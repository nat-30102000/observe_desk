import { newId } from '@observe/core';
import { useEffect, useRef, useState } from 'react';
import { emitBus, isTauri, showWindow, snipClose, snipImage, stageFile } from '../platform';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN_SIZE = 8;
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');

/** Full-window frozen screenshot. Drag a box to crop; Escape cancels. */
export function Snip() {
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [error, setError] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const bytes = useRef<Uint8Array | null>(null);

  const load = (data: Uint8Array) => {
    bytes.current = data;
    setUrl(URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: 'image/png' })));
  };

  useEffect(() => {
    if (!isTauri()) return;
    void snipImage().then(load, (e) => setError(String(e)));
  }, []);

  const cancel = () => void snipClose().then(() => setUrl(null));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const finish = async (b: Box) => {
    const el = img.current;
    if (!el) return;
    const sx = el.naturalWidth / el.clientWidth;
    const sy = el.naturalHeight / el.clientHeight;
    const x = Math.round(Math.min(b.x0, b.x1) * sx);
    const y = Math.round(Math.min(b.y0, b.y1) * sy);
    const w = Math.round(Math.abs(b.x1 - b.x0) * sx);
    const h = Math.round(Math.abs(b.y1 - b.y0) * sy);
    if (w < MIN_SIZE || h < MIN_SIZE) return setBox(null);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(el, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return setError('Could not crop the picture.');
    const png = new Uint8Array(await blob.arrayBuffer());
    const id = newId();
    await stageFile(id, png);
    await emitBus('quickadd:prefill', { screenshot: { id, name: `Screenshot ${stamp()}.png`, mime: 'image/png', size: png.length } });
    await snipClose();
    await showWindow('quickadd');
  };

  const rect = box && { left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) };

  return (
    <div
      className="snip"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      }}
      onPointerMove={(e) => box && setBox({ ...box, x1: e.clientX, y1: e.clientY })}
      onPointerUp={() => box && void finish(box).catch((e) => setError(String(e)))}
    >
      {!isTauri() && !url && (
        <label className="snip-test">
          Test image (browser only)
          <input type="file" accept="image/png" onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(new Uint8Array(await f.arrayBuffer())); }} />
        </label>
      )}
      {url && <img ref={img} src={url} alt="" draggable={false} className="snip-img" />}
      <div className="snip-dim" />
      {rect && <div className="snip-box" style={rect} />}
      <div className="snip-hint">{error ?? 'Drag to select an area. Esc to cancel.'}</div>
    </div>
  );
}
