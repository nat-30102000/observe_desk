import { useEffect, useState } from 'react';
import { emitBus, isTauri, listenBus } from '../platform';
import { INITIAL_STATE, type AppState, type Settings } from '../state';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

export function UpdatesPanel({ settings, onChange }: Props) {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  useEffect(() => {
    let off = () => undefined as void;
    void listenBus<AppState>('state', setState).then((u) => {
      off = u;
      void emitBus('state-request');
    });
    return () => off();
  }, []);

  if (!isTauri()) return null;
  const u = state.updates;
  const pct = u.progress === null ? null : Math.round(u.progress * 100);

  return (
    <div className="panel">
      <h2>Updates</h2>
      <p>
        Version <strong>{u.current || '...'}</strong>
        {u.lastChecked && <span className="muted"> · checked {new Date(u.lastChecked).toLocaleString()}</span>}
      </p>
      {!u.enabled && <p className="muted">Updates are only available in released builds of the app. This build does not check for them.</p>}
      {u.enabled && (
        <>
          {u.available ? (
            <div className="ai-box">
              <h3>Version {u.available.version} is ready</h3>
              {u.available.notes && <p className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{u.available.notes}</p>}
              <button className="btn primary" disabled={u.installing} onClick={() => void emitBus('updates:install')}>
                {u.installing ? (pct === null ? 'Installing...' : `Downloading ${pct}%`) : 'Update and restart'}
              </button>
              <p className="muted small">The download is checked against the app's built-in signature key before it installs. Anything waiting to be filed stays safe and is filed after the restart.</p>
            </div>
          ) : (
            <p className="muted">{u.checking ? 'Checking...' : u.lastChecked ? 'You have the latest version.' : 'Not checked yet.'}</p>
          )}
          <div className="row">
            <button className="btn" disabled={u.checking || u.installing} onClick={() => void emitBus('updates:check')}>Check for updates</button>
          </div>
          {u.error && <p className="error" role="alert">{u.error}</p>}
          <label className="check"><input type="checkbox" checked={settings.updates.autoCheck} onChange={(e) => onChange({ updates: { ...settings.updates, autoCheck: e.target.checked } })} /> Look for updates automatically</label>
          <label className="check"><input type="checkbox" checked={settings.updates.autoInstall} disabled={!settings.updates.autoCheck} onChange={(e) => onChange({ updates: { ...settings.updates, autoInstall: e.target.checked } })} /> Install them by myself when Nib is idle (otherwise I ask first)</label>
          <p className="muted small">Press Save at the top of Settings to keep these choices.</p>
        </>
      )}
    </div>
  );
}
