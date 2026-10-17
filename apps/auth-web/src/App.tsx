import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from '@azure/msal-react';
import { useEffect, useState } from 'react';
import { ApiError, callApi, type Me } from './api';
import { apiScopes } from './msal';

function Login() {
  const { instance, inProgress } = useMsal();
  return (
    <main className="card">
      <h1>Welcome to MyApp</h1>
      <p>Sign in with your work, school or Google account.</p>
      <button className="primary" disabled={inProgress !== 'none'} onClick={() => void instance.loginRedirect({ scopes: apiScopes, prompt: 'select_account' })}>
        Continue with Microsoft
      </button>
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
