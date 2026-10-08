import {
  AuthError,
  CYCLES,
  OfflineError,
  addCycle,
  daysUntil,
  isYmd,
  listSubscriptions,
  saveSubscription,
  totals,
  upcomingRenewal,
  type Cycle,
  type SubStatus,
  type Subscription,
} from '@observe/core';
import { useCallback, useEffect, useState } from 'react';
import { emitBus } from '../platform';
import { loadSettings, makeClient } from '../service';

const today = () => new Date().toLocaleDateString('en-CA');
const money = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
};

const EMPTY: Subscription = { service: '', cost: 0, currency: 'USD', cycle: 'monthly', nextRenewal: today(), status: 'active' };

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Subscription | null>(null);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof OfflineError ? 'Obsidian is not reachable. Open it and try again.' : e instanceof AuthError ? 'Obsidian rejected the API key.' : String(e));
      return undefined;
    }
  }, []);

  const load = useCallback(async () => {
    await guard(async () => {
      const settings = await loadSettings();
      const client = await makeClient(settings);
      if (!client) throw new Error('Add your Obsidian API key in Settings first.');
      setSubs(await listSubscriptions(client, settings.folders));
    });
  }, [guard]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (s: Subscription) => {
    const ok = await guard(async () => {
      const settings = await loadSettings();
      const client = await makeClient(settings);
      if (!client) throw new Error('Add your Obsidian API key in Settings first.');
      await saveSubscription(client, settings.folders, s);
      return true;
    });
    if (ok) {
      setEditing(null);
      void emitBus('subs-changed');
      await load();
    }
  };

  const t = totals(subs ?? []);

  return (
    <section>
      <header className="bar">
        <h1>Subscriptions</h1>
        <span className="muted">Each one is a note in your Subscriptions folder</span>
        <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}>+ Add subscription</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      {subs && (
        <div className="stats">
          {t.length === 0 && <div className="stat"><span className="meta">Monthly total</span><strong>{money(0, 'USD')}</strong></div>}
          {t.map((x) => (
            <div key={x.currency} className="stat"><span className="meta">Per month ({x.currency})</span><strong>{money(x.monthly, x.currency)}</strong><span className="meta">{money(x.yearly, x.currency)} per year</span></div>
          ))}
          {(() => {
            const next = subs.filter((s) => s.status !== 'cancelled').map((s) => ({ s, date: upcomingRenewal(s, today()) })).sort((a, b) => a.date.localeCompare(b.date))[0];
            return next ? <div className="stat accent"><span className="meta">Next renewal</span><strong>{next.s.service}</strong><span className="meta">{next.date} · in {daysUntil(next.date, today())} days</span></div> : null;
          })()}
        </div>
      )}

      {subs && subs.length === 0 && <p className="muted">No subscriptions yet. Add Netflix, Notion, your VPN, anything that bills you regularly.</p>}
      {subs && subs.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Service</th><th>Category</th><th>Cycle</th><th>Cost</th><th>Renews</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {subs.map((s) => {
                const next = upcomingRenewal(s, today());
                return (
                  <tr key={s.service} className={s.status === 'cancelled' ? 'dim' : ''}>
                    <td><strong>{s.service}</strong></td>
                    <td>{s.category ?? ''}</td>
                    <td>{s.cycle}</td>
                    <td className="mono">{money(s.cost, s.currency)}</td>
                    <td>{s.status === 'cancelled' ? '' : `${next} (${daysUntil(next, today())}d)`}</td>
                    <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                    <td className="actions">
                      <button className="btn small" onClick={() => setEditing(s)}>Edit</button>
                      {s.status !== 'cancelled' && <button className="btn small" title="Roll the date forward one billing cycle" onClick={() => void save({ ...s, nextRenewal: addCycle(next, s.cycle) })}>Renewed</button>}
                      {s.status === 'active' && <button className="btn small" onClick={() => void save({ ...s, status: 'cancelling' })}>Cancelling</button>}
                      {s.status !== 'cancelled' && <button className="btn small" onClick={() => void save({ ...s, status: 'cancelled' })}>Ended</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Nib reminds you 7 days and 1 day before each renewal. Cancelling subscriptions still count towards the total until you mark them ended.</p>
      {editing && <SubForm initial={editing} onCancel={() => setEditing(null)} onSave={(s) => void save(s)} />}
    </section>
  );
}

function SubForm({ initial, onSave, onCancel }: { initial: Subscription; onSave: (s: Subscription) => void; onCancel: () => void }) {
  const [s, setS] = useState(initial);
  const [cost, setCost] = useState(String(initial.cost || ''));
  const [error, setError] = useState<string | null>(null);
  const isNew = initial.service === '';
  const set = (p: Partial<Subscription>) => setS({ ...s, ...p });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(cost.replace(',', '.'));
    if (!s.service.trim()) return setError('Give the service a name.');
    if (!Number.isFinite(n) || n < 0) return setError('Cost must be a number.');
    if (!isYmd(s.nextRenewal)) return setError('Pick the next renewal date.');
    if (!/^[A-Za-z]{3}$/.test(s.currency)) return setError('Currency is a 3-letter code such as USD or EUR.');
    onSave({ ...s, service: s.service.trim(), cost: n, currency: s.currency.toUpperCase(), category: s.category?.trim() || undefined, url: s.url?.trim() || undefined, notes: s.notes?.trim() || undefined });
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={isNew ? 'Add subscription' : 'Edit subscription'}>
      <form className="panel" onSubmit={submit}>
        <h2>{isNew ? 'Add subscription' : `Edit ${initial.service}`}</h2>
        <label>Service<input value={s.service} onChange={(e) => set({ service: e.target.value })} readOnly={!isNew} autoFocus /></label>
        <div className="three">
          <label>Cost<input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" /></label>
          <label>Currency<input value={s.currency} onChange={(e) => set({ currency: e.target.value })} maxLength={3} /></label>
          <label>Billed
            <select value={s.cycle} onChange={(e) => set({ cycle: e.target.value as Cycle })}>{CYCLES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        </div>
        <div className="three">
          <label>Next renewal<input type="date" value={s.nextRenewal} onChange={(e) => set({ nextRenewal: e.target.value })} /></label>
          <label>Status
            <select value={s.status} onChange={(e) => set({ status: e.target.value as SubStatus })}><option>active</option><option>cancelling</option><option>cancelled</option></select>
          </label>
          <label>Category<input value={s.category ?? ''} onChange={(e) => set({ category: e.target.value })} /></label>
        </div>
        <label>Account or cancel link<input value={s.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://" /></label>
        <label>Notes<textarea rows={3} value={s.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row end"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </div>
  );
}
