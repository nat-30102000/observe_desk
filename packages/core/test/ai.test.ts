import { describe, expect, it } from 'vitest';
import {
  AiError, PROVIDERS, buildChat, chat, cleanSummary, cleanTag, listModels, parseChat, parseModels, parseTags, summarizeMessages, tagMessages,
  type FetchLike, type ProviderCall,
} from '../src';

const msgs = [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: 'hi' }];
const call = (style: ProviderCall['style'], baseUrl: string): ProviderCall => ({ style, baseUrl, model: 'm1' });

describe('buildChat', () => {
  it('anthropic: system is top level, key in x-api-key', () => {
    const r = buildChat(call('anthropic', 'https://api.anthropic.com/'), 'KEY', msgs);
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers).toMatchObject({ 'x-api-key': 'KEY', 'anthropic-version': '2023-06-01' });
    expect(JSON.parse(r.body!)).toEqual({ model: 'm1', max_tokens: 700, system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  });
  it('openai style: bearer key, max_completion_tokens only on openai.com', () => {
    const o = buildChat(call('openai', 'https://api.openai.com/v1'), 'K', msgs);
    expect(o.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(o.headers['Authorization']).toBe('Bearer K');
    expect(JSON.parse(o.body!)).toMatchObject({ max_completion_tokens: 700 });
    const n = JSON.parse(buildChat(call('openai', 'https://integrate.api.nvidia.com/v1'), 'K', msgs).body!);
    expect(n.max_tokens).toBe(700);
    expect(n.max_completion_tokens).toBeUndefined();
  });
  it('ollama cloud: native /api/chat without streaming', () => {
    const r = buildChat(call('ollama', 'https://ollama.com'), 'K', msgs);
    expect(r.url).toBe('https://ollama.com/api/chat');
    expect(JSON.parse(r.body!)).toMatchObject({ stream: false, messages: msgs });
  });
});

describe('parseChat', () => {
  it('reads each provider shape', () => {
    expect(parseChat('anthropic', { content: [{ type: 'text', text: ' A ' }, { type: 'tool_use' }] })).toBe('A');
    expect(parseChat('openai', { choices: [{ message: { content: 'B' } }] })).toBe('B');
    expect(parseChat('openai', { choices: [{ message: { content: [{ text: 'C' }, { text: 'D' }] } }] })).toBe('CD');
    expect(parseChat('ollama', { message: { content: 'E' } })).toBe('E');
  });
  it('throws on empty or unknown shapes', () => {
    expect(() => parseChat('openai', { choices: [{ message: { content: null } }] })).toThrow(AiError);
    expect(() => parseChat('anthropic', {})).toThrow(AiError);
    expect(() => parseChat('ollama', null)).toThrow(AiError);
  });
});

describe('chat and listModels', () => {
  const reply = (status: number, body: unknown): FetchLike => async () => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  it('returns the answer', async () => {
    expect(await chat(reply(200, { choices: [{ message: { content: 'ok' } }] }), call('openai', 'https://x.com/v1'), 'k', msgs)).toBe('ok');
  });
  it('maps errors by kind', async () => {
    const kind = async (f: FetchLike) => chat(f, call('openai', 'https://x.com/v1'), 'k', msgs).catch((e: AiError) => e.kind);
    expect(await kind(reply(401, 'no'))).toBe('auth');
    expect(await kind(reply(429, 'slow'))).toBe('rate');
    expect(await kind(reply(500, { error: { message: 'boom' } }))).toBe('http');
    expect(await kind(reply(200, 'not json'))).toBe('format');
    expect(await kind(async () => { throw new TypeError('x'); })).toBe('offline');
  });
  it('shows the provider message in http errors', async () => {
    await expect(chat(reply(400, { error: { message: 'bad model' } }), call('openai', 'https://x.com/v1'), 'k', msgs)).rejects.toThrow(/bad model/);
  });
  it('asks for a model before calling', async () => {
    await expect(chat(reply(200, {}), { ...call('openai', 'https://x'), model: ' ' }, 'k', msgs)).rejects.toThrow(/model/);
  });
  it('lists models in each style', async () => {
    expect(await listModels(reply(200, { data: [{ id: 'models/b' }, { id: 'a' }, { id: 'a' }] }), { style: 'openai', baseUrl: 'https://x/v1' }, 'k')).toEqual(['a', 'b']);
    expect(await listModels(reply(200, { models: [{ name: 'gpt-oss:120b' }] }), { style: 'ollama', baseUrl: 'https://ollama.com' }, 'k')).toEqual(['gpt-oss:120b']);
    expect(parseModels('openai', {})).toEqual([]);
  });
});

describe('providers', () => {
  it('lists the seven requested providers, https only, unique ids', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['anthropic', 'openai', 'xai', 'gemini', 'nvidia', 'opencode', 'ollama']);
    expect(PROVIDERS.every((p) => p.baseUrl.startsWith('https://'))).toBe(true);
  });
});

describe('tasks', () => {
  it('prompts mark content as untrusted and truncate long text', () => {
    const m = summarizeMessages('T', 'x'.repeat(50_000));
    expect(m[0]!.content).toMatch(/untrusted/);
    expect(m[1]!.content.length).toBeLessThan(13_000);
    expect(tagMessages('T', 'body', ['a', 'b'])[0]!.content).toContain('a, b');
  });
  it('cleans tags', () => {
    expect(cleanTag('  #Deep Reading!! ')).toBe('deep-reading');
    expect(cleanTag('a/b_c')).toBe('a/b_c');
    expect(cleanTag('<script>')).toBe('script');
    expect(cleanTag('x'.repeat(80)).length).toBe(30);
  });
  it('parses tags from json, fenced json, or a plain list; dedupes and limits', () => {
    expect(parseTags('["Reading", "deep work", "reading"]')).toEqual(['reading', 'deep-work']);
    expect(parseTags('Here you go:\n```json\n["a","b"]\n```')).toEqual(['a', 'b']);
    expect(parseTags('productivity, notes\nfocus')).toEqual(['productivity', 'notes', 'focus']);
    expect(parseTags('["1","2","3","4","5","6","7"]')).toHaveLength(5);
    expect(parseTags('')).toEqual([]);
  });
  it('keeps only bullet lines in summaries', () => {
    expect(cleanSummary('Sure! Here:\n* one\n- two\n• three\nDone.')).toBe('- one\n- two\n- three');
    expect(cleanSummary('just text')).toBe('just text');
  });
});
