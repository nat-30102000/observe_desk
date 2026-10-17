import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from '@azure/msal-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, callApi, prepareGuest, type Me } from './api';
import { apiScopes, tenantAuthority } from './msal';

function Login() {
  const { instance, inProgress } = useMsal();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const idle = inProgress === 'none' && !busy;

  const gmail = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    setBusy(true);
    await prepareGuest(address);
    await instance.loginRedirect({ scopes: apiScopes, authority: tenantAuthority, loginHint: address, prompt: 'login' });
  };

  return (
    <main className="card">
      <h1>Welcome to MyApp</h1>
      <p>Sign in with your work, school or personal Microsoft account.</p>
      <button className="primary" disabled={!idle} onClick={() => void instance.loginRedirect({ scopes: apiScopes, prompt: 'select_account' })}>
        Continue with Microsoft
      </button>
      {tenantAuthority && (
        <form onSubmit={(e) => void gmail(e)}>
          <p className="or">or use a Gmail address</p>
          <input type="email" required placeholder="you@gmail.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button disabled={!idle || !email.trim()}>Continue with Gmail</button>
        </form>
      )}
    </main>
  );
}

type State = { kind: 'loading' } | { kind: 'ok'; me: Me } | { kind: 'denied'; message: string } | { kind: 'error'; message: string };

function Home() {
  const { instance } = useMsal();
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    callApi<Me>(instance, apiScopes, '/api/me')
      .then((me) => setState({ kind: 'ok', me }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 403) setState({ kind: 'denied', message: e.message });
        else setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, [instance]);

  const signOut = <button onClick={() => void instance.logoutRedirect()}>Sign out</button>;
  if (state.kind === 'loading') return <main className="card"><p>Checking your access…</p></main>;
  if (state.kind === 'denied') return <main className="card"><h1>Access denied</h1><p role="alert">{state.message}</p>{signOut}</main>;
  if (state.kind === 'error') return <main className="card"><h1>Something went wrong</h1><p role="alert">{state.message}</p>{signOut}</main>;
  const { me } = state;
  return (
    <main className="card">
      <h1>Hello, {me.user.name}</h1>
      <dl>
        <dt>Organization</dt><dd>{me.organization.name}</dd>
        <dt>Signed in with</dt><dd>{me.idp === 'google.com' ? 'Google' : 'Microsoft'}</dd>
        <dt>Roles</dt><dd>{me.roles.join(', ')}</dd>
        <dt>Permissions</dt><dd>{me.permissions.join(', ')}</dd>
      </dl>
      {signOut}
    </main>
  );
}

export function App() {
  return (
    <>
      <UnauthenticatedTemplate><Login /></UnauthenticatedTemplate>
      <AuthenticatedTemplate><Home /></AuthenticatedTemplate>
    </>
  );
}
