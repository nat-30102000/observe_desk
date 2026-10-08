import { moodFor, newId, type Capture, type Mood } from '@observe/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emitBus, hideWindow, listenBus, listenNative, readClipboardText, showWindow } from '../platform';
import { AppService } from '../service';
import { INITIAL_STATE, type AppState } from '../state';
import { Nib } from './Nib';

const BUBBLE_MS = 7000;
const URL_RE = /^https?:\/\/\S+$/i;

/** A dropped string is a link (bookmark) or text (markdown note). */
function captureFromDrop(text: string): Capture | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const base = { id: newId(), createdAt: new Date().toISOString(), tags: [] as string[] };
  if (URL_RE.test(trimmed)) {
    const u = new URL(trimmed);
    return { ...base, kind: 'bookmark', url: u.toString(), title: u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') };
  }
  const firstLine = trimmed.split(/\r?\n/)[0] ?? 'Dropped text';
  return { ...base, kind: 'markdown', title: firstLine.slice(0, 60), body: trimmed };
}

export function Pet() {
  const service = useMemo(() => new AppService(), []);
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [transient, setTransient] = useState<Mood | undefined>();
  const [bubble, setBubble] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const transientTimer = useRef<ReturnType<typeof setTimeout>>();
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>();

  const flash = useCallback((mood: Mood, ms = 3500) => {
    setTransient(mood);
    clearTimeout(transientTimer.current);
    transientTimer.current = setTimeout(() => setTransient(undefined), ms);
  }, []);

  const speak = useCallback((text: string) => {
    setBubble(text);
    clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), BUBBLE_MS);
  }, []);

  useEffect(() => {
    const off = service.subscribe(setState);
    void service.start();
    return () => {
      off();
      service.stop();
    };
  }, [service]);

  // Show whatever the service says, and celebrate successful filing.
  useEffect(() => {
    if (!state.speech) return;
    speak(state.speech.text);
    if (/^Filed/.test(state.speech.text)) flash('happy');
    else if (/^Extra, extra/.test(state.speech.text)) flash('newsflash', 6000);
    else if (/^Psst!/.test(state.speech.text)) flash('reminder', 8000);
  }, [state.speech, speak, flash]);

  // Other windows can ask Nib to show a mood (e.g. thinking while an AI call runs).
  useEffect(() => {
    let off = () => undefined as void;
    void listenBus<{ mood: Mood | null; ms?: number }>('pet:mood', ({ mood, ms }) => {
      if (mood) flash(mood, ms ?? 3500);
      else {
        clearTimeout(transientTimer.current);
        setTransient(undefined);
      }
    }).then((u) => (off = u));
    return () => off();
  }, [flash]);

  // Ctrl+Alt+H: read the clipboard and open quick-add with it.
  useEffect(() => {
    let off = () => undefined as void;
    void listenNative<void>('hotkey-capture', async () => {
      flash('curious', 5000);
      const text = await readClipboardText();
      await emitBus('quickadd:prefill', { text });
      await showWindow('quickadd');
    }).then((u) => (off = u));
    return () => off();
  }, [flash]);

  const mood = moodFor({ pending: state.pending, failed: state.failed, offline: state.offline, authError: state.authError, transient });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      flash('worried');
      speak("I can't eat files yet. Files and images arrive in a later version.");
      return;
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const capture = captureFromDrop(text.split(/\r?\n/).find((l) => l && !l.startsWith('#')) ?? text);
    if (!capture) return;
    flash('nom');
    void service.capture(capture);
  };

  const go = (fn: () => Promise<void>) => () => {
    setMenuOpen(false);
    void fn();
  };

  return (
    <div className="pet-root" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {bubble && (
        <div className="bubble" role="status">
          {bubble}
        </div>
      )}
      {menuOpen && (
        <nav className="pet-menu" aria-label="Nib menu">
          <button className="pill primary" onClick={go(() => showWindow('quickadd'))}>+ Quick add</button>
          <button className="pill" onClick={go(() => showWindow('desk'))}>Open the Desk</button>
          <button
            className="pill"
            onClick={go(async () => {
              await showWindow('desk');
              await emitBus('desk:goto', 'bookmarks');
            })}
          >
            Bookmarks
          </button>
          <button className="pill" onClick={go(() => hideWindow('pet'))}>Hide Nib</button>
        </nav>
      )}
      <button
        className="nib-btn"
        aria-label="Nib, your desktop pet. Click for the menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <Nib mood={mood} size={190} />
      </button>
      <div className="grip" data-tauri-drag-region title="Drag to move Nib" />
      {state.pending > 0 && <span className="queue-badge" aria-label={`${state.pending} waiting`}>{state.pending}</span>}
    </div>
  );
}
