import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { authorize, type AccessContext } from './authz.js';
import type { Config } from './config.js';
import type { Store } from './store.js';
import type { Principal } from './verify.js';

interface Authed extends Request {
  principal?: Principal;
  access?: AccessContext;
}

export function createApp(deps: { config: Config; store: Store; verify: (token: string) => Promise<Principal> }): express.Express {
  const { config, store, verify } = deps;
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => void res.json({ ok: true }));

  // 401: the token is missing or not valid.
  const requireAuth = async (req: Authed, res: Response, next: NextFunction) => {
    const m = /^Bearer (.+)$/i.exec(req.header('authorization') ?? '');
    if (!m) return void res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized', message: 'Missing bearer token' });
    try {
      req.principal = await verify(m[1]!);
      next();
    } catch (e) {
      res.status(401).set('WWW-Authenticate', 'Bearer error="invalid_token"').json({ error: 'unauthorized', message: e instanceof Error ? e.message : 'Invalid token' });
    }
  };
  // 403: the token is valid but this user is not allowed in.
  const requireAccess = (req: Authed, res: Response, next: NextFunction) => {
    const r = authorize(req.principal!, store, config);
    if (!r.ok) return void res.status(403).json({ error: 'forbidden', reason: r.reason });
    req.access = r.ctx;
    next();
  };
  const need = (permission: string) => (req: Authed, res: Response, next: NextFunction) =>
    req.access!.permissions.includes(permission) ? next() : void res.status(403).json({ error: 'forbidden', reason: 'missing_permission', permission });

  const api = express.Router();
  api.use(requireAuth, requireAccess);

  api.get('/me', (req: Authed, res) => {
    const { user, organization, roles, permissions } = req.access!;
    res.json({ user: { id: user.id, name: user.name, email: user.email }, organization: { id: organization.id, name: organization.name }, roles, permissions, idp: req.principal!.idp ?? 'microsoft' });
  });

  api.get('/admin/users', need('users:manage'), (req: Authed, res) => void res.json(store.usersInOrg(req.access!.organization.id)));
  api.patch('/admin/users/:id', need('users:manage'), (req: Authed, res) => {
    const target = store.usersInOrg(req.access!.organization.id).find((u) => u.id === req.params.id);
    if (!target) return void res.status(404).json({ error: 'not_found' });
    const { status, role } = req.body ?? {};
    if (target.id === req.access!.user.id && status && status !== 'active') return void res.status(400).json({ error: 'bad_request', message: 'You cannot suspend yourself.' });
    if (status !== undefined) {
      if (!['pending', 'active', 'suspended', 'deleted'].includes(status)) return void res.status(400).json({ error: 'bad_request', message: 'Unknown status' });
      store.setUserStatus(target.id, status);
    }
    if (role !== undefined) {
      if (!['Admin', 'Employee'].includes(role)) return void res.status(400).json({ error: 'bad_request', message: 'Unknown role' });
      if (target.roles.includes('SuperAdmin') && !req.access!.roles.includes('SuperAdmin')) return void res.status(403).json({ error: 'forbidden', reason: 'missing_permission' });
      store.setUserRole(target.id, role);
    }
    res.json(store.usersInOrg(req.access!.organization.id).find((u) => u.id === target.id));
  });

  api.get('/admin/organizations', need('orgs:manage'), (_req, res) => void res.json(store.listOrgs()));
  api.post('/admin/organizations', need('orgs:manage'), (req, res) => {
    const tenantId = String(req.body?.tenantId ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    if (!/^[0-9a-f-]{36}$/.test(tenantId) || !name) return void res.status(400).json({ error: 'bad_request', message: 'tenantId (a GUID) and name are required' });
    if (store.orgByTenant(tenantId)) return void res.status(409).json({ error: 'conflict', message: 'That tenant is already registered' });
    res.status(201).json(store.createOrg(tenantId, name));
  });
  api.patch('/admin/organizations/:id', need('orgs:manage'), (req, res) => {
    const status = req.body?.status;
    if (status !== 'approved' && status !== 'suspended') return void res.status(400).json({ error: 'bad_request', message: 'status must be approved or suspended' });
    const org = store.setOrgStatus(String(req.params.id), status);
    org ? res.json(org) : res.status(404).json({ error: 'not_found' });
  });

  app.use('/api', api);
  return app;
}
