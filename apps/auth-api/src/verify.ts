import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Principal {
  tenantId: string;
  /** Stable per-tenant user id (`oid`; falls back to `sub`). */
  subject: string;
  issuer: string;
  name?: string;
  email?: string;
  /** Identity provider that authenticated the user, when Entra reports one (e.g. google.com). */
  idp?: string;
}

export class AuthError extends Error {}

/** Keys for tokens from any Entra tenant (and personal Microsoft accounts). */
export const entraKeys = (): JWTVerifyGetKey => createRemoteJWKSet(new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'));

export const REQUIRED_SCOPE = 'access_as_user';

export function createVerifier(opts: { audiences: string[]; getKey: JWTVerifyGetKey }) {
  return async (token: string): Promise<Principal> => {
    let tid: unknown;
    try {
      tid = decodeJwt(token).tid;
    } catch {
      throw new AuthError('Malformed token');
    }
    if (typeof tid !== 'string' || !/^[0-9a-f-]{36}$/i.test(tid)) throw new AuthError('Token has no tenant');
    try {
      // The issuer is derived from the token's own tenant, then the signature and the issuer are both checked,
      // so a tenant id cannot be claimed without a matching Entra-signed token.
      const { payload } = await jwtVerify(token, opts.getKey, {
        algorithms: ['RS256'],
        audience: opts.audiences,
        issuer: `https://login.microsoftonline.com/${tid.toLowerCase()}/v2.0`,
      });
      if (payload.ver !== '2.0') throw new AuthError('Only v2.0 access tokens are accepted');
      const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ') : [];
      if (!scopes.includes(REQUIRED_SCOPE)) throw new AuthError(`Token is missing the ${REQUIRED_SCOPE} scope`);
      const subject = String(payload.oid ?? payload.sub ?? '');
      if (!subject) throw new AuthError('Token has no subject');
      return {
        tenantId: tid.toLowerCase(),
        subject: subject.toLowerCase(),
        issuer: payload.iss!,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        email: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
        idp: typeof payload.idp === 'string' ? payload.idp : undefined,
      };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError(e instanceof Error ? e.message : 'Invalid token');
    }
  };
}
