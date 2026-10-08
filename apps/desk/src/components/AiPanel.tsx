import { PROVIDERS, type ProviderId } from '@observe/core';
import { useEffect, useState } from 'react';
import { callFor, describeAiError, getAiKey, loadProviderModels, setAiKey, testProvider } from '../ai';
import type { Settings } from '../state';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** One row per provider: key, model, test. Keys are saved straight to the secret store. */
export function AiPanel({ settings, onChange }: Props) {
  const [hasKey, setHasKey] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [draft, setDraft] = useState<Partial<Record<ProviderId, string>>>({});
  const [models, setModels] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [msg, setMsg] = useState<Partial<Record<ProviderId, { ok: boolean; text: string }>>>({});
  const [busy, setBusy] = useState<ProviderId | null>(null);

  useEffect(() => {
    void Promise.all(PROVIDERS.map(async (p) => [p.id, !!(await getAiKey(p.id))] as const)).then((rows) => setHasKey(Object.fromEntries(rows)));
  }, []);

  const say = (id: ProviderId, ok: boolean, text: string) => setMsg((m) => ({ ...m, [id]: { ok, text } }));
  const patchProvider = (id: ProviderId, patch: { model?: string; baseUrl?: string }) =>
    onChange({ ai: { ...settings.ai, providers: { ...settings.ai.providers, [id]: { ...settings.ai.providers[id], ...patch } } } });

  const saveKey = async (id: ProviderId) => {
    const key = (draft[id] ?? '').trim();
    if (!key) return;
    await setAiKey(id, key);
    setDraft((d) => ({ ...d, [id]: '' }));
    setHasKey((h) => ({ ...h, [id]: true }));
    say(id, true, 'Key saved.');
  };

  const removeKey = async (id: ProviderId) => {
    await setAiKey(id, '');
    setHasKey((h) => ({ ...h, [id]: false }));
    say(id, true, 'Key removed.');
  };

  const guarded = async (id: ProviderId, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      say(id, false, describeAiError(e));
    } finally {
      setBusy(null);
    }
  };

  const ready = PROVIDERS.filter((p) => hasKey[p.id]);

  return (
    <div className="panel">
      <h2>AI helpers</h2>
      <p className="muted">
        Optional. Add a key for any provider to summarise articles and suggest tags. When you press a button, the text of that article is sent to the provider you chose, and nothing is sent otherwise. Keys are kept in Windows Credential Manager.
      </p>

      {PROVIDERS.map((p) => {
        const call = callFor(settings, p.id);
        const list = models[p.id] ?? [];
        return (
          <div key={p.id} className="provider">
            <div className="provider-head">
              <strong>{p.label}</strong>
              <span className={hasKey[p.id] ? 'okmsg' : 'muted'}>{hasKey[p.id] ? 'Key saved' : 'No key'}</span>
            </div>
            {p.note && <p className="muted small">{p.note}</p>}
            <div className="three">
              <label>
                API key
                <input type="password" autoComplete="off" value={draft[p.id] ?? ''} placeholder={hasKey[p.id] ? 'Saved. Type to replace' : 'Paste key'} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })} />
              </label>
              <label>
                Model
                <input list={`models-${p.id}`} value={settings.ai.providers[p.id]?.model ?? ''} placeholder={p.defaultModel || 'Load models, then choose'} onChange={(e) => patchProvider(p.id, { model: e.target.value })} />
                <datalist id={`models-${p.id}`}>{list.map((m) => <option key={m} value={m} />)}</datalist>
              </label>
              <label>
                Address
                <input value={settings.ai.providers[p.id]?.baseUrl ?? ''} placeholder={p.baseUrl} onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <button className="btn small" disabled={!(draft[p.id] ?? '').trim()} onClick={() => void saveKey(p.id)}>Save key</button>
              <button className="btn small" disabled={!hasKey[p.id] || busy === p.id} onClick={() => void guarded(p.id, async () => { const l = await loadProviderModels(settings, p.id); setModels((m) => ({ ...m, [p.id]: l })); say(p.id, true, `${l.length} models loaded. Click the Model box to choose.`); })}>Load models</button>
              <button className="btn small" disabled={!hasKey[p.id] || busy === p.id || !call.model} title={call.model ? '' : 'Choose a model first'} onClick={() => void guarded(p.id, async () => { say(p.id, true, `Working: ${(await testProvider(settings, p.id)).slice(0, 60)}`); })}>{busy === p.id ? 'Working...' : 'Test'}</button>
              {hasKey[p.id] && <button className="btn small" onClick={() => void removeKey(p.id)}>Remove key</button>}
            </div>
            {msg[p.id] && <p className={msg[p.id]!.ok ? 'okmsg' : 'error'} role="status">{msg[p.id]!.text}</p>}
          </div>
        );
      })}

      <div className="three">
        <label>
          Summaries use
          <select value={settings.ai.summaryProvider ?? ''} onChange={(e) => onChange({ ai: { ...settings.ai, summaryProvider: (e.target.value || undefined) as ProviderId | undefined } })}>
            <option value="">First provider with a key</option>
            {ready.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label>
          Auto-tagging uses
          <select value={settings.ai.tagProvider ?? ''} onChange={(e) => onChange({ ai: { ...settings.ai, tagProvider: (e.target.value || undefined) as ProviderId | undefined } })}>
            <option value="">First provider with a key</option>
            {ready.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">Press Save at the top of Settings to keep the model, address and provider choices.</p>
    </div>
  );
}
