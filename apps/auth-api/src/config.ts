export type AuthMode = 'restricted' | 'open';

export interface Config {
  port: number;
  /** Application (client) id of the API app registration; the access token's `aud`. */
  audiences: string[];
  /** restricted: only approved organizations may sign in. open: any Entra tenant may, and is auto-approved. */
  mode: AuthMode;
  /** `tenantId:objectId` pairs that become SuperAdmin on first sign-in. */
  bootstrapAdmins: string[];
  /** `tenantId=Name` pairs created as approved organizations at start-up. */
  seedTenants: Array<{ tenantId: string; name: string }>;
  corsOrigin: string;
  dataFile?: string;
}

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const clientId = env.API_CLIENT_ID?.trim();
  if (!clientId) throw new Error('API_CLIENT_ID is required (the application id of the API app registration).');
  const mode = (env.AUTH_MODE ?? 'restricted') as AuthMode;
  if (mode !== 'restricted' && mode !== 'open') throw new Error('AUTH_MODE must be "restricted" or "open".');
  return {
    port: Number(env.PORT ?? 3001),
    audiences: [clientId, `api://${clientId}`],
    mode,
    bootstrapAdmins: list(env.BOOTSTRAP_ADMINS).map((s) => s.toLowerCase()),
    seedTenants: list(env.SEED_TENANTS).map((pair) => {
      const [tenantId, ...name] = pair.split('=');
      return { tenantId: tenantId!.trim().toLowerCase(), name: name.join('=').trim() || tenantId!.trim() };
    }),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5174',
    dataFile: env.DATA_FILE || undefined,
  };
}
