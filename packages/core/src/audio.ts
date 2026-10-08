import { AiError, chat, type ProviderCall } from './ai';
import { transcribeMessages } from './ai-tasks';
import type { FetchLike } from './obsidian';

/** Providers that can turn speech into text, and how. Others (Claude, Grok, NIM, OpenCode, Ollama) have no audio input here. */
export const TRANSCRIPTION_PROVIDERS = ['openai', 'gemini'] as const;
export type TranscriptionProvider = (typeof TRANSCRIPTION_PROVIDERS)[number];

export function mergeChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Average down to a lower sample rate (speech needs only 16 kHz, which keeps files small). */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] as number;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

export const peakLevel = (samples: Float32Array): number => samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

export interface MultipartFile {
  field: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** Build a multipart/form-data body by hand (our fetch shape only carries bytes). */
export function buildMultipart(fields: Record<string, string>, file: MultipartFile, boundary = `----observe${Math.random().toString(16).slice(2)}`): { contentType: string; bytes: Uint8Array } {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  const safeName = file.name.replace(/["\r\n]/g, '_');
  parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${safeName}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.bytes, enc.encode(`\r\n--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, bytes: mergeBytes(parts) };
}

function mergeBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** OpenAI's /audio/transcriptions takes a file upload and answers {text}. */
export async function transcribeOpenAi(f: FetchLike, call: ProviderCall, apiKey: string, wav: Uint8Array, language?: string): Promise<string> {
  const body = buildMultipart({ model: call.model || 'whisper-1', response_format: 'json', ...(language ? { language } : {}) }, { field: 'file', name: 'voice-note.wav', mime: 'audio/wav', bytes: wav });
  let res;
  try {
    res = await f(`${call.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': body.contentType }, bodyBytes: body.bytes });
  } catch (e) {
    throw new AiError('offline', e instanceof Error ? e.message : 'Could not reach the provider.');
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new AiError('auth', 'The provider rejected the API key.');
  if (res.status === 429) throw new AiError('rate', 'The provider is rate limiting you. Try again in a minute.');
  if (res.status === 413) throw new AiError('http', 'The recording is too long for this provider (limit about 25 MB).');
  if (res.status >= 300) {
    let detail = text.slice(0, 200);
    try {
      detail = String(((JSON.parse(text) as { error?: { message?: string } }).error ?? {}).message ?? detail);
    } catch {
      /* not json */
    }
    throw new AiError('http', `The provider answered ${res.status}: ${detail}`);
  }
  let out = '';
  try {
    out = String((JSON.parse(text) as { text?: unknown }).text ?? '').trim();
  } catch {
    /* handled below */
  }
  if (!out) throw new AiError('format', 'No speech was found in the recording.');
  return out;
}

/** Gemini (via its OpenAI-compatible endpoint) takes the audio inside a chat message. */
export async function transcribeViaChat(f: FetchLike, call: ProviderCall, apiKey: string, wav: Uint8Array): Promise<string> {
  return chat(f, call, apiKey, transcribeMessages({ format: 'wav', base64: toBase64(wav) }), 4000);
}
