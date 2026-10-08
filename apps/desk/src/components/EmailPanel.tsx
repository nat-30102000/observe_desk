import { useEffect, useState } from 'react';
import { getSecret, setSecret } from '../platform';
import { MAIL_PASSWORD_SECRET, testMail } from '../mailService';
import type { EmailSettings, Settings } from '../state';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** Forwarded mail and newsletters arrive in a mailbox you choose; Nib reads new messages and files them as notes. */
export function EmailPanel({ settings, onChange }: Props) {
  const e = settings.email;
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [allow, setAllow] = useState(e.allowFrom.join(', '));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSecret(MAIL_PASSWORD_SECRET).then((p) => setHasPassword(!!p));
  }, []);

  const set = (patch: Partial<EmailSettings>) => onChange({ email: { ...e, ...patch } });

  const savePassword = async () => {
    if (!password) return;
    await setSecret(MAIL_PASSWORD_SECRET, password);
    setPassword('');
    setHasPassword(true);
    setMsg({ ok: true, text: 'Password saved.' });
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (password) await savePassword();
      const n = await testMail(e);
      setMsg({ ok: true, text: `Connected. "${e.folder || 'INBOX'}" holds ${n} message${n === 1 ? '' : 's'}.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Email and newsletters</h2>
      <p className="muted">
        Make a mailbox just for this (a new address works well, with an app password), then forward emails and subscribe newsletters to it. Nib checks it, turns each new message into a note in your Notes folder, and never changes the mailbox: nothing is deleted, moved or marked as read. Pictures are not downloaded.
      </p>
      <label className="check"><input type="checkbox" checked={e.enabled} onChange={(ev) => set({ enabled: ev.target.checked })} /> Check this mailbox for new mail</label>
      <div className="three">
        <label>Mail server (IMAP)<input value={e.host} onChange={(ev) => set({ host: ev.target.value })} placeholder="imap.example.com" /></label>
        <label>Port<input inputMode="numeric" value={e.port} onChange={(ev) => set({ port: Number(ev.target.value.replace(/\D/g, '')) || 993 })} /></label>
        <label>Folder<input value={e.folder} onChange={(ev) => set({ folder: ev.target.value })} /></label>
      </div>
      <div className="three">
        <label>User name<input value={e.username} onChange={(ev) => set({ username: ev.target.value })} autoComplete="off" /></label>
        <label>
          Password {hasPassword && <span className="muted">(saved)</span>}
          <input type="password" autoComplete="off" value={password} onChange={(ev) => setPassword(ev.target.value)} placeholder={hasPassword ? 'Type to replace' : 'App password'} />
        </label>
        <label>Check every (minutes)<input inputMode="numeric" value={e.everyMinutes} onChange={(ev) => set({ everyMinutes: Math.min(60, Math.max(1, Number(ev.target.value.replace(/\D/g, '')) || 5)) })} /></label>
      </div>
      <label>
        Only keep mail from (optional, addresses or domains, separated by commas)
        <input value={allow} onChange={(ev) => { setAllow(ev.target.value); set({ allowFrom: ev.target.value.split(/[,\s]+/).filter(Boolean) }); }} placeholder="me@example.com, newsletter.example" />
      </label>
      <label className="check"><input type="checkbox" checked={e.tls} onChange={(ev) => set({ tls: ev.target.checked })} /> Encrypted connection (keep this on, except for a server on this computer)</label>
      <label className="check"><input type="checkbox" checked={e.importExisting} onChange={(ev) => set({ importExisting: ev.target.checked })} /> The first time, also import the mail that is already there</label>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void test()}>{busy ? 'Checking...' : 'Test connection'}</button>
        <button className="btn" disabled={!password} onClick={() => void savePassword()}>Save password</button>
      </div>
      {msg && <p className={msg.ok ? 'okmsg' : 'error'} role="status">{msg.text}</p>}
      <p className="muted small">Press Save at the top of Settings to keep these choices.</p>
    </div>
  );
}
