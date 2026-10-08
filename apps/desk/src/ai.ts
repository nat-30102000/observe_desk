import {
  AiError,
  PROVIDERS,
  chat,
  cleanSummary,
  listModels,
  ocrMessages,
  parseTags,
  transcribeOpenAi,
  transcribeViaChat,
  providerInfo,
  summarizeMessages,
  tagMessages,
  type ChatMessage,
  type ProviderCall,
  type ProviderId,
} from '@observe/core';
import { aiFetch, emitBus, getSecret, setSecret, toBase64 } from './platform';
import type { Settings } from './state';

export const aiKeyName = (id: ProviderId): string => `ai-key-${id}`;

export const getAiKey = (id: ProviderId): Promise<string | null> => getSecret(aiKeyName(id));
export const setAiKey = (id: ProviderId, key: string): Promise<void> => setSecret(aiKeyName(id), key);

export function callFor(settings: Settings, id: ProviderId): ProviderCall {
  const info = providerInfo(id);
  const o = settings.ai.providers[id];
  return { style: info.style, baseUrl: o?.baseUrl?.trim() || info.baseUrl, model: o?.model?.trim() || info.defaultModel };
}

/** Providers that have a key saved. AI features only appear when at least one exists. */
export async function readyProviders(): Promise<ProviderId[]> {
  const out: ProviderId[] = [];
  for (const p of PROVIDERS) if (await getAiKey(p.id)) out.push(p.id);
  return out;
}

export type AiTask = 'summary' | 'tags';

/** Which provider a task uses: the chosen one if it still has a key, else the first that does. */
export async function providerFor(settings: Settings, task: AiTask): Promise<ProviderId | null> {
  const ready = await readyProviders();
  const chosen = task === 'summary' ? settings.ai.summaryProvider : settings.ai.tagProvider;
  return chosen && ready.includes(chosen) ? chosen : (ready[0] ?? null);
}

async function run(settings: Settings, task: AiTask, messages: ChatMessage[]): Promise<{ text: string; provider: ProviderId }> {
  const provider = await providerFor(settings, task);
  if (!provider) throw new AiError('auth', 'Add an AI provider key in Settings first.');
  const key = await getAiKey(provider);
  if (!key) throw new AiError('auth', 'Add an AI provider key in Settings first.');
  // Nib thinks while the model works.
  void emitBus('pet:mood', { mood: 'thinking', ms: 90_000 });
  try {
    const text = await chat(aiFetch, callFor(settings, provider), key, messages, task === 'summary' ? 500 : 120);
    void emitBus('pet:mood', { mood: null });
    return { text, provider };
  } catch (e) {
    void emitBus('pet:mood', { mood: 'worried', ms: 4000 });
    throw e;
  }
}

export async function summarize(settings: Settings, title: string, text: string): Promise<{ summary: string; provider: ProviderId }> {
  const r = await run(settings, 'summary', summarizeMessages(title, text));
  return { summary: cleanSummary(r.text), provider: r.provider };
}

export async function suggestTags(settings: Settings, title: string, text: string, existing: string[] = []): Promise<{ tags: string[]; provider: ProviderId }> {
  const r = await run(settings, 'tags', tagMessages(title, text, existing));
  return { tags: parseTags(r.text), provider: r.provider };
}

export async function loadProviderModels(settings: Settings, id: ProviderId): Promise<string[]> {
  const key = await getAiKey(id);
  if (!key) throw new AiError('auth', 'Save a key for this provider first.');
  const { model: _model, ...call } = callFor(settings, id);
  return listModels(aiFetch, call, key);
}

export async function testProvider(settings: Settings, id: ProviderId): Promise<string> {
  const key = await getAiKey(id);
  if (!key) throw new AiError('auth', 'Save a key for this provider first.');
  return chat(aiFetch, callFor(settings, id), key, [{ role: 'user', content: 'Reply with the single word: ready' }], 20);
}

export function describeAiError(e: unknown): string {
  return e instanceof AiError || e instanceof Error ? e.message : String(e);
}

/** Read text from an image with the chosen AI provider. The image is sent to that provider. */
export async function readTextWithAi(settings: Settings, mime: string, bytes: Uint8Array): Promise<{ text: string; provider: ProviderId }> {
  const provider = await providerFor(settings, 'summary');
  const key = provider ? await getAiKey(provider) : null;
  if (!provider || !key) throw new AiError('auth', 'Add an AI provider key in Settings first.');
  void emitBus('pet:mood', { mood: 'thinking', ms: 90_000 });
  try {
    const text = await chat(aiFetch, callFor(settings, provider), key, ocrMessages({ mime, base64: toBase64(bytes) }), 2000);
    void emitBus('pet:mood', { mood: null });
    return { text, provider };
  } catch (e) {
    void emitBus('pet:mood', { mood: 'worried', ms: 4000 });
    throw e;
  }
}

const VOICE_PROVIDERS: ProviderId[] = ['openai', 'gemini'];

/** Which provider turns speech into text: the chosen one if it can and has a key, else the first that can. */
export async function voiceProviderFor(settings: Settings): Promise<ProviderId | null> {
  const ready = (await readyProviders()).filter((p) => VOICE_PROVIDERS.includes(p));
  const chosen = settings.ai.voiceProvider;
  return chosen && ready.includes(chosen) ? chosen : (ready[0] ?? null);
}

/** Speech to text. Sends the recording to the chosen provider. */
export async function transcribeAudio(settings: Settings, wav: Uint8Array): Promise<{ text: string; provider: ProviderId }> {
  const provider = await voiceProviderFor(settings);
  const key = provider ? await getAiKey(provider) : null;
  if (!provider || !key) throw new AiError('auth', 'Add an OpenAI or Gemini key in Settings to turn voice notes into text.');
  void emitBus('pet:mood', { mood: 'thinking', ms: 120_000 });
  try {
    const call = callFor(settings, provider);
    const text =
      provider === 'openai'
        ? await transcribeOpenAi(aiFetch, { ...call, model: settings.ai.transcribeModel?.trim() || 'whisper-1' }, key, wav)
        : await transcribeViaChat(aiFetch, call, key, wav);
    void emitBus('pet:mood', { mood: null });
    return { text, provider };
  } catch (e) {
    void emitBus('pet:mood', { mood: 'worried', ms: 4000 });
    throw e;
  }
}
