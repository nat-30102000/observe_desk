import { downsample, encodeWav, mergeChunks, peakLevel } from '@observe/core';
import { useEffect, useRef, useState } from 'react';
import { describeAiError, transcribeAudio, voiceProviderFor } from '../ai';
import { emitBus } from '../platform';
import { loadSettings } from '../service';

export interface VoiceDraft {
  wav: Uint8Array;
  seconds: number;
  text: string;
  keep: boolean;
  title: string;
}

interface Props {
  draft: VoiceDraft | null;
  onChange: (d: VoiceDraft | null) => void;
  /** Start recording as soon as the panel shows (the Ctrl+Alt+V shortcut). */
  autoStart: boolean;
}

const RATE = 16000;
const MAX_SECONDS = 10 * 60;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Recorder {
  ctx: AudioContext;
  stream: MediaStream;
  node: ScriptProcessorNode;
  chunks: Float32Array[];
}

export function VoicePanel({ draft, onChange, autoStart }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canTranscribe, setCanTranscribe] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const rec = useRef<Recorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const started = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    void loadSettings().then(async (st) => setCanTranscribe((await voiceProviderFor(st)) !== null));
  }, [draft]);

  useEffect(() => {
    if (!draft) return setAudioUrl(null);
    const url = URL.createObjectURL(new Blob([draft.wav as unknown as BlobPart], { type: 'audio/wav' }));
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft?.wav]);

  const finish = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearInterval(timer.current);
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    const rate = r.ctx.sampleRate;
    void r.ctx.close();
    setRecording(false);
    setLevel(0);
    void emitBus('pet:mood', { mood: null });
    const samples = downsample(mergeChunks(r.chunks), rate, RATE);
    if (samples.length < RATE / 2) return setError('That was too short to keep.');
    onChange({ wav: encodeWav(samples, RATE), seconds: samples.length / RATE, text: '', keep: true, title: draftRef.current?.title ?? '' });
  };

  const start = async () => {
    setError(null);
    onChange(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(data);
        setLevel(peakLevel(data));
      };
      source.connect(node);
      node.connect(ctx.destination);
      rec.current = { ctx, stream, node, chunks };
      started.current = Date.now();
      setSeconds(0);
      setRecording(true);
      void emitBus('pet:mood', { mood: 'listening', ms: MAX_SECONDS * 1000 });
      timer.current = setInterval(() => {
        const s = (Date.now() - started.current) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS) finish();
      }, 250);
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it in Windows privacy settings and try again.' : e instanceof DOMException && e.name === 'NotFoundError' ? 'No microphone was found.' : describeAiError(e));
    }
  };

  useEffect(() => {
    if (autoStart && !draft && !rec.current) void start();
    return () => {
      // Closing the window or switching tabs must not leave the microphone on.
      if (rec.current) {
        rec.current.node.disconnect();
        rec.current.stream.getTracks().forEach((t) => t.stop());
        void rec.current.ctx.close();
        rec.current = null;
        clearInterval(timer.current);
        void emitBus('pet:mood', { mood: null });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const transcribe = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const r = await transcribeAudio(await loadSettings(), draft.wav);
      onChange({ ...draft, text: r.text });
    } catch (e) {
      setError(describeAiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="voice">
      {!draft && (
        <>
          <button type="button" className={recording ? 'recbtn on' : 'recbtn'} onClick={() => (recording ? finish() : void start())}>
            {recording ? 'Stop recording' : 'Start recording'}
          </button>
          {recording && (
            <>
              <div className="timer" aria-live="off">{clock(seconds)}</div>
              <div className="meter" role="img" aria-label="Microphone level"><i style={{ width: `${Math.min(100, level * 140)}%` }} /></div>
            </>
          )}
          {!recording && <p className="muted small">Speak, then stop. You can listen back, turn it into text, and edit before saving. Up to 10 minutes.</p>}
        </>
      )}
      {draft && (
        <>
          {audioUrl && <audio controls src={audioUrl} aria-label="Your recording" />}
          <p className="muted small">{clock(draft.seconds)} recorded.</p>
          <div className="row">
            <button type="button" className="btn small" onClick={() => onChange(null)}>Record again</button>
            <button type="button" className="btn small primary" disabled={busy || !canTranscribe} onClick={() => void transcribe()} title={canTranscribe ? 'Sends the recording to your AI provider' : 'Add an OpenAI or Gemini key in Settings'}>
              {busy ? 'Listening...' : 'Turn into text'}
            </button>
          </div>
          {!canTranscribe && <p className="muted small">Speech to text needs an OpenAI or Gemini key (Settings). You can also type the note yourself.</p>}
          <label>Title (optional)<input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} /></label>
          <label>Text<textarea rows={6} value={draft.text} onChange={(e) => onChange({ ...draft, text: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={draft.keep} onChange={(e) => onChange({ ...draft, keep: e.target.checked })} /> Also keep the recording in my vault</label>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
