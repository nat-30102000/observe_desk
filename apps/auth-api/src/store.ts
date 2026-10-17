import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export type Role = 'SuperAdmin' | 'Admin' | 'Employee';
export type OrgStatus = 'approved' | 'suspended';
export type UserStatus = 'pending' | 'active' | 'suspended' | 'deleted';

export interface Organization { id: string; name: string; tenantId: string; status: OrgStatus }
export interface User { id: string; name: string; email?: string; status: UserStatus; createdAt: string }
export interface ExternalIdentity { id: string; userId: string; provider: string; subject: string; issuer: string }
export interface Membership { userId: string; organizationId: string; status: 'active' | 'removed' }
export interface UserRole { userId: string; role: Role }

interface Db {
  organizations: Organization[];
  users: User[];
  identities: ExternalIdentity[];
  memberships: Membership[];
  roles: UserRole[];
}

/**
 * Small JSON-file backed store. Everything the authorization layer needs goes through these methods,
 * so replacing it with Postgres or SQL Server means re-implementing this one class.
 */
export class Store {
  private db: Db = { organizations: [], users: [], identities: [], memberships: [], roles: [] };

  constructor(private file?: string) {
    if (file && existsSync(file)) this.db = JSON.parse(readFileSync(file, 'utf8')) as Db;
  }

  private save(): void {
    if (!this.file) return;
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.db, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  orgByTenant(tenantId: string): Organization | undefined {
    return this.db.organizations.find((o) => o.tenantId === tenantId);
  }
  orgById(id: string): Organization | undefined {
    return this.db.organizations.find((o) => o.id === id);
  }
  listOrgs(): Organization[] {
    return [...this.db.organizations];
  }
  createOrg(tenantId: string, name: string, status: OrgStatus = 'approved'): Organization {
    const org = { id: randomUUID(), tenantId, name, status };
    this.db.organizations.push(org);
    this.save();
    return org;
  }
  setOrgStatus(id: string, status: OrgStatus): Organization | undefined {
    const o = this.orgById(id);
    if (o) { o.status = status; this.save(); }
    return o;
  }

  identity(issuer: string, subject: string): ExternalIdentity | undefined {
    return this.db.identities.find((i) => i.issuer === issuer && i.subject === subject);
  }
  user(id: string): User | undefined {
    return this.db.users.find((u) => u.id === id);
  }
  /** Creates the user, its external identity, an active membership and its roles in one step. */
  provision(p: { name: string; email?: string; provider: string; issuer: string; subject: string; organizationId: string; roles: Role[]; status?: UserStatus }): User {
    const user: User = { id: randomUUID(), name: p.name, email: p.email, status: p.status ?? 'active', createdAt: new Date().toISOString() };
    this.db.users.push(user);
    this.db.identities.push({ id: randomUUID(), userId: user.id, provider: p.provider, subject: p.subject, issuer: p.issuer });
    this.db.memberships.push({ userId: user.id, organizationId: p.organizationId, status: 'active' });
    p.roles.forEach((role) => this.db.roles.push({ userId: user.id, role }));
    this.save();
    return user;
  }
  membership(userId: string, organizationId: string): Membership | undefined {
    return this.db.memberships.find((m) => m.userId === userId && m.organizationId === organizationId);
  }
  rolesOf(userId: string): Role[] {
    return this.db.roles.filter((r) => r.userId === userId).map((r) => r.role);
  }
  usersInOrg(organizationId: string): Array<User & { roles: Role[] }> {
    return this.db.memberships
      .filter((m) => m.organizationId === organizationId && m.status === 'active')
      .map((m) => this.user(m.userId))
      .filter((u): u is User => !!u)
      .map((u) => ({ ...u, roles: this.rolesOf(u.id) }));
  }
  setUserStatus(userId: string, status: UserStatus): void {
    const u = this.user(userId);
    if (u) { u.status = status; this.save(); }
  }
  addRole(userId: string, role: Role): void {
    if (!this.rolesOf(userId).includes(role)) { this.db.roles.push({ userId, role }); this.save(); }
  }
  setUserRole(userId: string, role: 'Admin' | 'Employee'): void {
    // SuperAdmin is platform-level and never changed through the org admin API.
    this.db.roles = this.db.roles.filter((r) => r.userId !== userId || r.role === 'SuperAdmin');
    this.db.roles.push({ userId, role });
    this.save();
  }
}
