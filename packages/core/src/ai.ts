import type { FetchLike } from './obsidian';

export type ProviderId = 'anthropic' | 'openai' | 'xai' | 'gemini' | 'nvidia' | 'opencode' | 'ollama';
/** Which wire format a provider speaks. Most hosted providers copy OpenAI's. */
export type ApiStyle = 'openai' | 'anthropic' | 'ollama';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  style: ApiStyle;
  /** Default base URL; the user can override it in Settings. */
  baseUrl: string;
  /** Suggested model. Model names change often, so it is always editable and can be loaded from the provider. */
  defaultModel: string;
  note?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', label: 'Claude', style: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-haiku-4-5-20251001' },
  { id: 'openai', label: 'GPT', style: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { id: 'xai', label: 'Grok', style: 'openai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini' },
  { id: 'gemini', label: 'Gemini', style: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash', note: "Uses Google's OpenAI-compatible endpoint." },
  { id: 'nvidia', label: 'NVIDIA NIM', style: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.3-70b-instruct' },
  { id: 'opencode', label: 'OpenCode', style: 'openai', baseUrl: 'https://opencode.ai/zen/v1', defaultModel: '', note: 'OpenCode Zen. Press "Load models" and pick one that uses the chat-completions format.' },
  { id: 'ollama', label: 'Ollama Cloud', style: 'ollama', baseUrl: 'https://ollama.com', defaultModel: '', note: 'Hosted Ollama (not local). Press "Load models" to choose one.' },
];

export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS.find((p) => p.id === id) as ProviderInfo;

export interface ChatImage {
  mime: string;
  /** Base64 without the data: prefix. */
  base64: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Attached to user messages for vision models (OCR). */
  images?: ChatImage[];
}

export interface ProviderCall {
  style: ApiStyle;
  baseUrl: string;
  model: string;
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export function buildChat(call: ProviderCall, apiKey: string, messages: ChatMessage[], maxTokens = 700): BuiltRequest {
  const base = trimSlash(call.baseUrl);
  const json = { 'Content-Type': 'application/json' };
  if (call.style === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    return {
      url: `${base}/v1/messages`,
      headers: { ...json, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: call.model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) =>
            m.images?.length
              ? { role: m.role, content: [...m.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })), { type: 'text', text: m.content }] }
              : { role: m.role, content: m.content },
          ),
      }),
    };
  }
  if (call.style === 'ollama') {
    return {
      url: `${base}/api/chat`,
      headers: { ...json, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: call.model,
        messages: messages.map((m) => (m.images?.length ? { role: m.role, content: m.content, images: m.images.map((i) => i.base64) } : { role: m.role, content: m.content })),
        stream: false,
        options: { num_predict: maxTokens },
      }),
    };
  }
  // OpenAI's own newer models reject max_tokens; other OpenAI-compatible hosts still expect it.
  const limit = base.includes('api.openai.com') ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
  return {
    url: `${base}/chat/completions`,
    headers: { ...json, Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: call.model,
      messages: messages.map((m) =>
        m.images?.length
          ? { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] }
          : { role: m.role, content: m.content },
      ),
      ...limit,
    }),
  };
}

export type AiErrorKind = 'auth' | 'rate' | 'offline' | 'http' | 'format';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {});

/** Pull the reply text out of a provider response. */
export function parseChat(style: ApiStyle, raw: unknown): string {
  const data = asObj(raw);
  let text = '';
  if (style === 'anthropic') {
    const blocks = Array.isArray(data['content']) ? (data['content'] as unknown[]) : [];
    text = blocks.map((b) => (asObj(b)['type'] === 'text' ? String(asObj(b)['text'] ?? '') : '')).join('');
  } else if (style === 'ollama') {
    text = String(asObj(data['message'])['content'] ?? '');
  } else {
    const choice = asObj(Array.isArray(data['choices']) ? (data['choices'] as unknown[])[0] : undefined);
    const content = asObj(choice['message'])['content'];
    text = Array.isArray(content)
      ? content.map((p) => String(asObj(p)['text'] ?? '')).join('')
      : typeof content === 'string'
        ? content
        : '';
  }
  text = text.trim();
  if (!text) throw new AiError('format', 'The model returned an empty answer.');
  return text;
}

export function buildModelsRequest(call: Omit<ProviderCall, 'model'>, apiKey: string): BuiltRequest {
  const base = trimSlash(call.baseUrl);
  if (call.style === 'anthropic') return { url: `${base}/v1/models?limit=100`, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } };
  if (call.style === 'ollama') return { url: `${base}/api/tags`, headers: { Authorization: `Bearer ${apiKey}` } };
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
}

export function parseModels(style: ApiStyle, raw: unknown): string[] {
  const data = asObj(raw);
  const list = (style === 'ollama' ? data['models'] : data['data']) as unknown;
  if (!Array.isArray(list)) return [];
  const names = list.map((m) => String(asObj(m)[style === 'ollama' ? 'name' : 'id'] ?? '')).filter(Boolean);
  // Gemini's compatible endpoint prefixes ids with "models/".
  return [...new Set(names.map((n) => n.replace(/^models\//, '')))].sort();
}

async function send(fetchImpl: FetchLike, req: BuiltRequest, method: 'GET' | 'POST'): Promise<unknown> {
  let res;
  try {
    res = await fetchImpl(req.url, { method, headers: req.headers, body: req.body });
  } catch (e) {
    throw new AiError('offline', e instanceof Error ? e.message : 'Could not reach the provider.');
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new AiError('auth', 'The provider rejected the API key.');
  if (res.status === 429) throw new AiError('rate', 'The provider is rate limiting you. Try again in a minute.');
  if (res.status < 200 || res.status >= 300) {
    let detail = text.slice(0, 200);
    try {
      const err = asObj(asObj(JSON.parse(text))['error']);
      detail = String(err['message'] ?? detail);
    } catch {
      /* not json */
    }
    throw new AiError('http', `The provider answered ${res.status}: ${detail}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('format', 'The provider did not answer with JSON.');
  }
}

export async function chat(fetchImpl: FetchLike, call: ProviderCall, apiKey: string, messages: ChatMessage[], maxTokens?: number): Promise<string> {
  if (!call.model.trim()) throw new AiError('format', 'Choose a model for this provider in Settings first.');
  return parseChat(call.style, await send(fetchImpl, buildChat(call, apiKey, messages, maxTokens), 'POST'));
}

export async function listModels(fetchImpl: FetchLike, call: Omit<ProviderCall, 'model'>, apiKey: string): Promise<string[]> {
  return parseModels(call.style, await send(fetchImpl, buildModelsRequest(call, apiKey), 'GET'));
}
