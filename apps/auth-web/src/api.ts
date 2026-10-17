import { InteractionRequiredAuthError, type IPublicClientApplication } from '@azure/msal-browser';

export interface Me {
  user: { id: string; name: string; email?: string };
  organization: { id: string; name: string };
  roles: string[];
  permissions: string[];
  idp: string;
}

/** 401 = not signed in properly (token problem); 403 = signed in but not allowed (reason says why). */
export class ApiError extends Error {
  constructor(public status: number, public reason: string | undefined, message: string) {
    super(message);
  }
}

const REASONS: Record<string, string> = {
  organization_not_approved: 'Your organization has not been approved for this application yet.',
  organization_suspended: 'Your organization’s access has been suspended.',
  pending_approval: 'Your sign-up worked. An administrator needs to approve your account before you can use the application.',
  user_suspended: 'Your account has been suspended. Contact your administrator.',
  user_deleted: 'Your account has been removed.',
  no_membership: 'You are not a member of an approved organization.',
  no_role: 'No role has been assigned to your account.',
  missing_permission: 'Your role does not allow that.',
};

export const describeDenied = (reason?: string): string => (reason && REASONS[reason]) || 'You do not have access to this application.';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export async function getAccessToken(msal: IPublicClientApplication, scopes: string[]): Promise<string> {
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) throw new ApiError(401, undefined, 'Not signed in');
  try {
    return (await msal.acquireTokenSilent({ account, scopes })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ account, scopes });
    }
    throw e;
  }
}

export async function callApi<T>(msal: IPublicClientApplication, scopes: string[], path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(msal, scopes);
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers, authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, body.reason, res.status === 403 ? describeDenied(body.reason) : (body.message ?? `Request failed (${res.status})`));
  return body as T;
}
