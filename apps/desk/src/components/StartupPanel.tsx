import { useEffect, useState } from 'react';
import { autostartEnabled, isTauri, setAutostart } from '../platform';

/** Start with Windows. The switch lives in Windows itself (the per-user Run list), so it is read back rather than stored in our settings. */
export function StartupPanel() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void autostartEnabled().then(setOn, () => setOn(false));
  }, []);

  if (!isTauri()) return null;

  const toggle = async (next: boolean) => {
    setError(null);
    try {
      await setAutostart(next);
      setOn(await autostartEnabled());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="panel">
      <h2>Startup</h2>
      <label className="check">
        <input type="checkbox" checked={on === true} disabled={on === null} onChange={(e) => void toggle(e.target.checked)} />
        Start Nib when I sign in to Windows
      </label>
      <p className="muted small">Nib appears quietly near the corner of your screen. Only one copy of the app runs at a time: opening it again just brings the Desk forward.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
