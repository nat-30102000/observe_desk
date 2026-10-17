import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from 'jose';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authorize } from '../src/authz.js';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { createVerifier } from '../src/verify.js';

const CLIENT = 'api-client-id';
const TECHNORUCS = '11111111-1111-1111-1111-111111111111';
const MINDGATE = '22222222-2222-2222-2222-222222222222';
const RANDOM = '33333333-3333-3333-3333-333333333333';
const ADMIN_OID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

let key: CryptoKey;
let jwks: { keys: JWK[] };

async function token(o: { tid?: string; oid?: string; aud?: string; scp?: string; ver?: string; idp?: string; acct?: string; exp?: string; iss?: string; signWith?: CryptoKey } = {}) {
  const tid = o.tid ?? TECHNORUCS;
  return new SignJWT({ tid, oid: o.oid ?? 'bbbbbbbb-0000-0000-0000-000000000001', ver: o.ver ?? '2.0', scp: o.scp ?? 'access_as_user', name: 'Test User', preferred_username: 'test@example.com', ...(o.idp ? { idp: o.idp } : {}), ...(o.acct ? { acct: o.acct } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? `https://login.microsoftonline.com/${tid}/v2.0`)
    .setAudience(o.aud ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '5m')
    .sign(o.signWith ?? key);
}

function start(env: Record<string, string>) {
  const config = loadConfig({ API_CLIENT_ID: CLIENT, SEED_TENANTS: `${TECHNORUCS}=Technorucs,${MINDGATE}=Mindgate`, BOOTSTRAP_ADMINS: `${TECHNORUCS}:${ADMIN_OID}`, ...env });
  const store = new Store();
  for (const t of config.seedTenants) store.createOrg(t.tenantId, t.name);
  const app = createApp({ config, store, verify: createVerifier({ audiences: config.audiences, getKey: createLocalJWKSet(jwks) }) });
  const server: Server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, tok?: string, init: RequestInit = {}) => {
    const r = await fetch(url + path, { ...init, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), 'content-type': 'application/json' } });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { call, store, close: () => server.close() };
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
});

describe('restricted mode', () => {
  let s: ReturnType<typeof start>;
  beforeAll(() => void (s = start({ AUTH_MODE: 'restricted' })));
  afterAll(() => s.close());

  it('401 without a token, with garbage, expired, wrong audience, wrong issuer, bad signature, wrong scope or version', async () => {
    expect((await s.call('/api/me')).status).toBe(401);
    expect((await s.call('/api/me', 'not-a-jwt')).status).toBe(401);
    expect((await s.call('/api/me', await token({ exp: '-1m' }))).status).toBe(401);
    expect((await s.call('/api/me', await token({ aud: 'someone-else' }))).status).toBe(401);
    expect((await s.call('/api/me', await token({ iss: `https://login.microsoftonline.com/${MINDGATE}/v2.0` }))).status).toBe(401);
    expect((await s.call('/api/me', await token({ scp: 'other' }))).status).toBe(401);
    expect((await s.call('/api/me', await token({ ver: '1.0' }))).status).toBe(401);
    const other = (await generateKeyPair('RS256')).privateKey;
    expect((await s.call('/api/me', await token({ signWith: other }))).status).toBe(401);
  });

  it('lets approved tenants in and provisions an Employee', async () => {
    for (const tid of [TECHNORUCS, MINDGATE]) {
      const r = await s.call('/api/me', await token({ tid }));
      expect(r.status).toBe(200);
      expect(r.body.roles).toEqual(['Employee']);
    }
    expect((await s.call('/api/me', await token({ tid: MINDGATE }))).body.organization.name).toBe('Mindgate');
  });

  it('403 for a tenant that is not approved', async () => {
    const r = await s.call('/api/me', await token({ tid: RANDOM }));
    expect(r).toMatchObject({ status: 403, body: { reason: 'organization_not_approved' } });
  });

  it('does not merge identities that share an e-mail address', async () => {
    const a = await s.call('/api/me', await token({ oid: 'bbbbbbbb-0000-0000-0000-00000000aaa1' }));
    const b = await s.call('/api/me', await token({ oid: 'bbbbbbbb-0000-0000-0000-00000000aaa2' }));
    expect(a.body.user.id).not.toBe(b.body.user.id);
  });

  it('keeps Employees out of admin routes and lets the bootstrap admin manage users', async () => {
    const emp = await token({ oid: 'bbbbbbbb-0000-0000-0000-000000000009' });
    expect(await s.call('/api/admin/users', emp)).toMatchObject({ status: 403, body: { reason: 'missing_permission' } });
    const admin = await token({ oid: ADMIN_OID });
    expect((await s.call('/api/me', admin)).body.roles).toEqual(['SuperAdmin', 'Admin']);
    const users = await s.call('/api/admin/users', admin);
    expect(users.status).toBe(200);
    const victim = users.body.find((u: any) => u.roles.includes('Employee') && !u.roles.includes('Admin'));
    expect((await s.call(`/api/admin/users/${victim.id}`, admin, { method: 'PATCH', body: JSON.stringify({ role: 'Admin' }) })).body.roles).toEqual(['Admin']);
  });

  it('promotes a listed bootstrap admin who signed in before being listed', () => {
    const store = new Store();
    store.createOrg(TECHNORUCS, 'Technorucs');
    const principal = { tenantId: TECHNORUCS, subject: 'late-admin', issuer: `https://login.microsoftonline.com/${TECHNORUCS}/v2.0`, guest: false };
    const before = authorize(principal, store, loadConfig({ API_CLIENT_ID: CLIENT }));
    expect(before.ok && before.ctx.roles).toEqual(['Employee']);
    const after = authorize(principal, store, loadConfig({ API_CLIENT_ID: CLIENT, BOOTSTRAP_ADMINS: `${TECHNORUCS}:late-admin` }));
    expect(after.ok && after.ctx.roles).toEqual(['Employee', 'SuperAdmin', 'Admin']);
  });

  it('guests (self-service sign-up, e.g. Gmail) wait for approval, then get in', async () => {
    const admin = await token({ oid: ADMIN_OID });
    const guest = await token({ oid: 'bbbbbbbb-0000-0000-0000-00000000ee01', idp: 'google.com', acct: '1' });
    expect(await s.call('/api/me', guest)).toMatchObject({ status: 403, body: { reason: 'pending_approval' } });
    const pending = (await s.call('/api/admin/users', admin)).body.find((u: any) => u.status === 'pending');
    expect(pending).toBeTruthy();
    await s.call(`/api/admin/users/${pending.id}`, admin, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    const me = await s.call('/api/me', guest);
    expect(me.status).toBe(200);
    expect(me.body.idp).toBe('google.com');
  });

  it('a guest is recognised by its idp even without the acct claim', async () => {
    const r = await s.call('/api/me', await token({ oid: 'bbbbbbbb-0000-0000-0000-00000000ee02', idp: 'google.com' }));
    expect(r.body.reason).toBe('pending_approval');
  });

  it('suspended and deleted users are denied at once, even with a valid token', async () => {
    const admin = await token({ oid: ADMIN_OID });
    const oid = 'bbbbbbbb-0000-0000-0000-00000000dead';
    const t = await token({ oid });
    const id = (await s.call('/api/me', t)).body.user.id;
    await s.call(`/api/admin/users/${id}`, admin, { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) });
    expect((await s.call('/api/me', t)).body.reason).toBe('user_suspended');
    s.store.setUserStatus(id, 'deleted');
    expect((await s.call('/api/me', t)).body.reason).toBe('user_deleted');
  });

  it('an admin cannot suspend themself, and cannot reach another organization\'s users', async () => {
    const admin = await token({ oid: ADMIN_OID });
    const me = (await s.call('/api/me', admin)).body.user.id;
    expect((await s.call(`/api/admin/users/${me}`, admin, { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) })).status).toBe(400);
    const mind = (await s.call('/api/me', await token({ tid: MINDGATE, oid: 'bbbbbbbb-0000-0000-0000-00000000b0b0' }))).body.user.id;
    expect((await s.call(`/api/admin/users/${mind}`, admin, { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) })).status).toBe(404);
  });

  it('suspending an organization locks out its users; SuperAdmin can approve a new tenant', async () => {
    const admin = await token({ oid: ADMIN_OID });
    const orgs = (await s.call('/api/admin/organizations', admin)).body;
    const mind = orgs.find((o: any) => o.name === 'Mindgate');
    await s.call(`/api/admin/organizations/${mind.id}`, admin, { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) });
    expect((await s.call('/api/me', await token({ tid: MINDGATE }))).body.reason).toBe('organization_suspended');
    expect((await s.call('/api/me', await token({ tid: RANDOM }))).status).toBe(403);
    expect((await s.call('/api/admin/organizations', admin, { method: 'POST', body: JSON.stringify({ tenantId: RANDOM, name: 'Other Co' }) })).status).toBe(201);
    expect((await s.call('/api/me', await token({ tid: RANDOM }))).status).toBe(200);
  });
});

describe('guest policy allow', () => {
  let s: ReturnType<typeof start>;
  beforeAll(() => void (s = start({ GUEST_POLICY: 'allow' })));
  afterAll(() => s.close());
  it('lets guests straight in as Employee', async () => {
    const r = await s.call('/api/me', await token({ oid: 'bbbbbbbb-0000-0000-0000-00000000ee03', idp: 'google.com', acct: '1' }));
    expect(r.body.roles).toEqual(['Employee']);
  });
});

describe('open mode', () => {
  let s: ReturnType<typeof start>;
  beforeAll(() => void (s = start({ AUTH_MODE: 'open' })));
  afterAll(() => s.close());
  it('accepts personal Microsoft accounts straight away as Employees in one shared organization', async () => {
    const tid = '9188040d-6c67-4c5b-b112-36a304b66dad';
    const a = await s.call('/api/me', await token({ tid, oid: 'bbbbbbbb-0000-0000-0000-00000000f001', idp: 'live.com' }));
    expect(a.status).toBe(200);
    expect(a.body.roles).toEqual(['Employee']);
    expect(a.body.organization.name).toBe('Personal Microsoft accounts');
    const b = await s.call('/api/me', await token({ tid, oid: 'bbbbbbbb-0000-0000-0000-00000000f002' }));
    expect(b.body.organization.id).toBe(a.body.organization.id);
    expect(b.body.user.id).not.toBe(a.body.user.id);
  });

  it('accepts any tenant and registers it', async () => {
    expect((await s.call('/api/me', await token({ tid: RANDOM }))).status).toBe(200);
    expect(s.store.orgByTenant(RANDOM)?.status).toBe('approved');
  });
});

describe('config', () => {
  it('requires the API client id and a known mode', () => {
    expect(() => loadConfig({})).toThrow(/API_CLIENT_ID/);
    expect(() => loadConfig({ API_CLIENT_ID: 'x', AUTH_MODE: 'nope' })).toThrow(/AUTH_MODE/);
    expect(() => loadConfig({ API_CLIENT_ID: 'x', GUEST_POLICY: 'nope' })).toThrow(/GUEST_POLICY/);
  });
});
