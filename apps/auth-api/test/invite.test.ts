import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createInviter } from '../src/graph.js';
import { Store } from '../src/store.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const env = { API_CLIENT_ID: 'app-id', TENANT_ID: TENANT, INVITE_CLIENT_SECRET: 's3cret', INVITES_PER_HOUR: '8' };

async function start(invite?: (e: string) => Promise<void>, over: Record<string, string> = {}) {
  const app = createApp({ config: loadConfig({ ...env, ...over }), store: new Store(), verify: async () => { throw new Error('unused'); }, invite });
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (email: unknown) => {
    const r = await fetch(`${url}/auth/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { post, close: () => server.close() };
}

describe('POST /auth/invite', () => {
  it('invites a Gmail address and normalises it', async () => {
    const seen: string[] = [];
    const s = await start(async (e) => void seen.push(e));
    expect((await s.post('  Person@Gmail.com ')).status).toBe(200);
    expect(seen).toEqual(['person@gmail.com']);
    s.close();
  });

  it('rejects other domains and malformed addresses without calling Graph', async () => {
    const seen: string[] = [];
    const s = await start(async (e) => void seen.push(e));
    expect((await s.post('boss@company.com')).status).toBe(400);
    expect((await s.post('not-an-email')).status).toBe(400);
    expect((await s.post(42)).status).toBe(400);
    expect(seen).toEqual([]);
    s.close();
  });

  it('rate limits per client and does not leak Graph errors', async () => {
    const s = await start(async () => { throw new Error('Graph says secret detail'); });
    const first = await s.post('a@gmail.com');
    expect(first.status).toBe(502);
    expect(JSON.stringify(first.body)).not.toContain('secret detail');
    for (let i = 0; i < 4; i++) await s.post(`a${i}@gmail.com`);
    expect((await s.post('z@gmail.com')).status).toBe(429);
    s.close();
  });

  it('is off (404) when no client secret is configured', async () => {
    const s = await start(undefined, { INVITE_CLIENT_SECRET: '' });
    expect((await s.post('a@gmail.com')).status).toBe(404);
    s.close();
  });

  it('requires TENANT_ID when a secret is set', () => {
    expect(() => loadConfig({ API_CLIENT_ID: 'x', INVITE_CLIENT_SECRET: 's' })).toThrow(/TENANT_ID/);
  });
});

describe('createInviter (Graph calls)', () => {
  it('gets an app token once, then posts a no-email guest invitation', async () => {
    const calls: Array<{ url: string; body: string; auth?: string }> = [];
    const fake = async (url: string, init: any = {}) => {
      calls.push({ url, body: init.body, auth: init.headers?.authorization });
      return url.includes('/oauth2/v2.0/token')
        ? { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
        : { ok: true, status: 201, json: async () => ({}) };
    };
    const invite = createInviter(loadConfig(env).invite!, fake as any);
    await invite('a@gmail.com');
    await invite('b@gmail.com');
    expect(calls.filter((c) => c.url.includes('/oauth2/v2.0/token'))).toHaveLength(1);
    expect(calls[0]!.url).toContain(TENANT);
    expect(calls[0]!.body).toContain('client_credentials');
    const inv = calls.filter((c) => c.url.endsWith('/invitations'));
    expect(inv).toHaveLength(2);
    expect(inv[0]!.auth).toBe('Bearer T');
    expect(JSON.parse(inv[0]!.body)).toMatchObject({ invitedUserEmailAddress: 'a@gmail.com', sendInvitationMessage: false });
  });

  it('surfaces a failed token or invitation', async () => {
    const bad = createInviter(loadConfig(env).invite!, (async () => ({ ok: false, status: 401, json: async () => ({ error_description: 'bad secret' }) })) as any);
    await expect(bad('a@gmail.com')).rejects.toThrow(/token request failed/);
  });
});
