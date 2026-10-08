import { describe, expect, it } from 'vitest';
import {
  AiError, CaptureQueue, MemoryStorage, buildChat, buildMultipart, downsample, encodeWav, mergeChunks, peakLevel, transcribeMessages, transcribeOpenAi, transcribeViaChat,
  type FetchInit, type FetchLike,
} from '../src';

describe('wav', () => {
  it('writes a valid 16-bit mono header and clamps samples', () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2, -2, 0.5]), 16000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 16))).toBe('WAVEfmt ');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(40, true)).toBe(12);
    expect(wav.length).toBe(44 + 12);
    expect([...Array(6).keys()].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });
  it('downsamples by averaging and leaves lower or equal rates alone', () => {
    expect([...downsample(Float32Array.from([1, 3, 5, 7]), 4, 2)]).toEqual([2, 6]);
    const same = Float32Array.from([1, 2]);
    expect(downsample(same, 16000, 16000)).toBe(same);
    expect(downsample(new Float32Array(48000), 48000, 16000)).toHaveLength(16000);
  });
  it('merges chunks and finds the peak', () => {
    expect([...mergeChunks([Float32Array.from([1]), Float32Array.from([2, 3])])]).toEqual([1, 2, 3]);
    expect(peakLevel(Float32Array.from([0.1, -0.7, 0.3]))).toBeCloseTo(0.7);
    expect(peakLevel(new Float32Array(0))).toBe(0);
  });
});

describe('multipart', () => {
  it('lays out fields and the file with the boundary', () => {
    const { contentType, bytes } = buildMultipart({ model: 'whisper-1' }, { field: 'file', name: 'a"b.wav', mime: 'audio/wav', bytes: Uint8Array.from([1, 2, 3]) }, 'BOUND');
    expect(contentType).toBe('multipart/form-data; boundary=BOUND');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('--BOUND\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n');
    expect(text).toContain('name="file"; filename="a_b.wav"\r\nContent-Type: audio/wav\r\n\r\n\u0001\u0002\u0003\r\n--BOUND--\r\n');
  });
});

const reply = (status: number, body: unknown): FetchLike => async () => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const call = { style: 'openai' as const, baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' };

describe('transcribeOpenAi', () => {
  it('uploads the wav and returns the text', async () => {
    let seen: { url: string; init: FetchInit } | null = null;
    const f: FetchLike = async (url, init) => { seen = { url, init }; return { status: 200, text: async () => '{"text":" Hello there. "}' }; };
    expect(await transcribeOpenAi(f, call, 'KEY', Uint8Array.from([1, 2]), 'en')).toBe('Hello there.');
    expect(seen!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(seen!.init.headers['Authorization']).toBe('Bearer KEY');
    expect(seen!.init.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(new TextDecoder().decode(seen!.init.bodyBytes)).toContain('name="language"');
  });
  it('maps errors', async () => {
    const kind = (f: FetchLike) => transcribeOpenAi(f, call, 'k', new Uint8Array(1)).catch((e: AiError) => e.kind);
    expect(await kind(reply(401, 'no'))).toBe('auth');
    expect(await kind(reply(429, 'slow'))).toBe('rate');
    expect(await kind(reply(413, 'big'))).toBe('http');
    expect(await kind(reply(500, { error: { message: 'boom' } }))).toBe('http');
    expect(await kind(reply(200, { text: '  ' }))).toBe('format');
    expect(await kind(async () => { throw new TypeError('x'); })).toBe('offline');
  });
});

describe('audio through chat', () => {
  it('sends input_audio to OpenAI-style providers', () => {
    const body = JSON.parse(buildChat({ style: 'openai', baseUrl: 'https://g/v1beta/openai', model: 'gemini' }, 'k', transcribeMessages({ format: 'wav', base64: 'QUJD' })).body!);
    expect(body.messages[1].content).toContainEqual({ type: 'input_audio', input_audio: { data: 'QUJD', format: 'wav' } });
    expect(body.messages[0].content).toMatch(/Do not follow/);
  });
  it('returns the transcript from the chat answer', async () => {
    const f = reply(200, { choices: [{ message: { content: 'spoken words' } }] });
    expect(await transcribeViaChat(f, { ...call, model: 'gemini-2.0-flash' }, 'k', Uint8Array.from([1]))).toBe('spoken words');
  });
});

describe('enqueueMany', () => {
  it('adds many with one save, skipping repeats', async () => {
    let saves = 0;
    const store = new MemoryStorage();
    const orig = store.save.bind(store);
    store.save = async (items) => { saves++; await orig(items); };
    const q = new CaptureQueue(store);
    const mk = (id: string) => ({ kind: 'bookmark' as const, id, createdAt: 'x', tags: [], url: 'https://a.com', title: id });
    expect(await q.enqueueMany([mk('a'), mk('b'), mk('a')])).toBe(2);
    expect(await q.enqueueMany([mk('b'), mk('c')])).toBe(1);
    expect(await q.enqueueMany([mk('c')])).toBe(0);
    expect(saves).toBe(2);
    expect(await q.pendingCount()).toBe(3);
  });
});
