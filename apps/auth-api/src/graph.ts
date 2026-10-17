import type { Config } from './config.js';

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/**
 * Creates (or finds) a guest user for an e-mail address through the Microsoft Graph invitations API.
 * No invitation e-mail is sent; the person redeems the guest account the first time they sign in with Google.
 */
export function createInviter(cfg: NonNullable<Config['invite']>, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  let token: { value: string; expires: number } | undefined;

  const getToken = async (): Promise<string> => {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const res = await fetchImpl(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) throw new Error(`Graph token request failed (${res.status}): ${body.error_description ?? body.error ?? 'unknown'}`);
    token = { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3000) * 1000 };
    return token.value;
  };

  return async (email: string): Promise<void> => {
    const res = await fetchImpl('https://graph.microsoft.com/v1.0/invitations', {
      method: 'POST',
      headers: { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ invitedUserEmailAddress: email, inviteRedirectUrl: cfg.redirectUrl, sendInvitationMessage: false, invitedUserType: 'Guest' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Graph invitation failed (${res.status}): ${body?.error?.message ?? 'unknown'}`);
    }
  };
}
