import type { Config } from './config.js';
import type { Organization, Role, Store, User } from './store.js';
import type { Principal } from './verify.js';

export type DenyReason = 'organization_not_approved' | 'organization_suspended' | 'user_suspended' | 'user_deleted' | 'no_membership' | 'no_role';

export interface AccessContext {
  user: User;
  organization: Organization;
  roles: Role[];
  permissions: string[];
}

const PERMISSIONS: Record<Role, string[]> = {
  Employee: ['profile:read'],
  Admin: ['profile:read', 'users:manage'],
  SuperAdmin: ['profile:read', 'users:manage', 'orgs:manage'],
};

export const permissionsFor = (roles: Role[]): string[] => [...new Set(roles.flatMap((r) => PERMISSIONS[r]))];

/** Who is this, which organization, is it approved, is the user active, and what may they do. */
export function authorize(p: Principal, store: Store, config: Config): { ok: true; ctx: AccessContext } | { ok: false; reason: DenyReason } {
  let org = store.orgByTenant(p.tenantId);
  if (!org) {
    if (config.mode !== 'open') return { ok: false, reason: 'organization_not_approved' };
    org = store.createOrg(p.tenantId, p.tenantId);
  }
  if (org.status !== 'approved') return { ok: false, reason: 'organization_suspended' };

  const provider = p.idp ?? 'microsoft';
  let user = (() => {
    const id = store.identity(p.issuer, p.subject);
    return id ? store.user(id.userId) : undefined;
  })();
  if (!user) {
    // First sign-in from an approved organization: provision. Identities are never merged by e-mail address,
    // because the e-mail claim is not verified; the same person from Microsoft and Google is two identities.
    const admin = config.bootstrapAdmins.includes(`${p.tenantId}:${p.subject}`);
    user = store.provision({
      name: p.name ?? p.email ?? 'New user',
      email: p.email,
      provider,
      issuer: p.issuer,
      subject: p.subject,
      organizationId: org.id,
      roles: admin ? ['SuperAdmin', 'Admin'] : ['Employee'],
    });
  }
  // Listed bootstrap admins are promoted even if they signed in before being listed.
  if (config.bootstrapAdmins.includes(`${p.tenantId}:${p.subject}`)) (['SuperAdmin', 'Admin'] as const).forEach((r) => store.addRole(user!.id, r));
  if (user.status === 'suspended') return { ok: false, reason: 'user_suspended' };
  if (user.status === 'deleted') return { ok: false, reason: 'user_deleted' };
  if (store.membership(user.id, org.id)?.status !== 'active') return { ok: false, reason: 'no_membership' };
  const roles = store.rolesOf(user.id);
  if (roles.length === 0) return { ok: false, reason: 'no_role' };
  return { ok: true, ctx: { user, organization: org, roles, permissions: permissionsFor(roles) } };
}
