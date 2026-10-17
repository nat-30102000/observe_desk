export type AuthMode = 'restricted' | 'open';
export type GuestPolicy = 'pending' | 'allow';

export interface Config {
  port: number;
  /** Application (client) id of the API app registration; the access token's `aud`. */
  audiences: string[];
  /** restricted: only approved organizations may sign in. open: any Entra tenant may, and is auto-approved. */
  mode: AuthMode;
  /** pending: guests (e.g. Gmail users who signed themselves up) wait for an admin to activate them. allow: they get in as Employee. */
  guestPolicy: GuestPolicy;
  /** `tenantId:objectId` pairs that become SuperAdmin on first sign-in. */
  bootstrapAdmins: string[];
  /** `tenantId=Name` pairs created as approved organizations at start-up. */
  seedTenants: Array<{ tenantId: string; name: string }>;
  corsOrigin: string;
  /** Set when a client secret is given: lets the API invite Gmail users as guests before they sign in. */
  invite?: { tenantId: string; clientId: string; clientSecret: string; redirectUrl: string; domains: string[]; perHour: number };
  dataFile?: string;
}

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const clientId = env.API_CLIENT_ID?.trim();
  if (!clientId) throw new Error('API_CLIENT_ID is required (the application id of the API app registration).');
  const mode = (env.AUTH_MODE ?? 'restricted') as AuthMode;
  if (mode !== 'restricted' && mode !== 'open') throw new Error('AUTH_MODE must be "restricted" or "open".');
  const guestPolicy = (env.GUEST_POLICY ?? 'pending') as GuestPolicy;
  if (guestPolicy !== 'pending' && guestPolicy !== 'allow') throw new Error('GUEST_POLICY must be "pending" or "allow".');
  return {
    guestPolicy,
    port: Number(env.PORT ?? 3001),
    audiences: [clientId, `api://${clientId}`],
    mode,
    bootstrapAdmins: list(env.BOOTSTRAP_ADMINS).map((s) => s.toLowerCase()),
    seedTenants: list(env.SEED_TENANTS).map((pair) => {
      const [tenantId, ...name] = pair.split('=');
      return { tenantId: tenantId!.trim().toLowerCase(), name: name.join('=').trim() || tenantId!.trim() };
    }),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5174',
    invite: env.INVITE_CLIENT_SECRET
      ? (() => {
          if (!env.TENANT_ID) throw new Error('TENANT_ID is required when INVITE_CLIENT_SECRET is set.');
          return {
            tenantId: env.TENANT_ID.trim().toLowerCase(),
            clientId,
            clientSecret: env.INVITE_CLIENT_SECRET,
            redirectUrl: env.WEB_URL ?? env.CORS_ORIGIN ?? 'http://localhost:5174',
            domains: list(env.INVITE_DOMAINS ?? 'gmail.com,googlemail.com').map((d) => d.toLowerCase()),
            perHour: Number(env.INVITES_PER_HOUR ?? 30),
          };
        })()
      : undefined,
    dataFile: env.DATA_FILE || undefined,
  };
}
