# Microsoft / Google sign-in (`apps/auth-web` + `apps/auth-api`)

One **Continue with Microsoft** button. Microsoft Entra authenticates the person (work, school, or a Google account federated into Entra); the API validates the access token and then decides, from its own data, whether that person may use the app.

```
React (MSAL)  ->  Microsoft Entra  ->  (Google, if federated)  ->  Entra
     |                                                                |
     +---------- Bearer access token  ->  Node API (jose) -----------+
                                            401 invalid token
                                            403 not allowed (reason)
                                            200 organization -> user -> role -> permission
```

## Run it

```bash
cp apps/auth-api/.env.example apps/auth-api/.env   # fill in, then export the vars (or use your process manager)
cp apps/auth-web/.env.example apps/auth-web/.env.local
npm run dev -w @observe/auth-api    # http://localhost:3001
npm run dev -w @observe/auth-web    # http://localhost:5174
npm test -w @observe/auth-api -w @observe/auth-web
```

## Entra setup (you do this once)

1. **API app registration** (`observe-auth-api`)
   - Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*.
   - Manifest: `"requestedAccessTokenVersion": 2` (the API only accepts v2.0 tokens).
   - Expose an API: Application ID URI `api://<api-client-id>`; add scope `access_as_user`.
2. **SPA app registration** (`observe-auth-web`)
   - Same supported account types. Platform *Single-page application*, redirect URI `http://localhost:5174` (add your production URL too).
   - API permissions: add `access_as_user` from the API app.
   - Add the SPA's client id to the API app under *Expose an API > Authorized client applications* so users in other tenants are not asked for admin consent.
3. Put the two client ids in the `.env` files. `VITE_AUTHORITY` stays `.../common`.
4. Find your own tenant id and object id (Entra > Users) and set `SEED_TENANTS` and `BOOTSTRAP_ADMINS` so the first sign-in is a SuperAdmin.

## Google

Google is not reached by typing a Gmail address into the Microsoft box on its own. Configure it in Entra as an external identity provider (External Identities > All identity providers > Google, with a Google OAuth client). Google users then sign in as guests of a tenant, so the token's `tid` is that tenant and `idp` is `google.com`. The app shows which provider was used; authorization is unchanged. Plan for this being a separate, testable phase.

## Authorization model

- `AUTH_MODE=restricted` (default): only organizations in the store may sign in (`SEED_TENANTS`, or a SuperAdmin adds them via `POST /api/admin/organizations`). Anyone else gets `403 organization_not_approved`.
- `AUTH_MODE=open`: any Entra tenant is accepted and auto-approved on first sign-in.
- First sign-in from an approved organization creates the user as **Employee**. Roles: `Employee`, `Admin` (manage users in their own organization), `SuperAdmin` (also manage organizations).
- Suspended/deleted users and suspended organizations are refused on the very next request, even with a still-valid token.
- Identities are **never merged by e-mail** (the e-mail claim is not verified): the same person via Microsoft and via Google is two users until someone links them deliberately.
- Identity key is issuer + `oid` (falls back to `sub`).

## What is checked on every token

Signature (Entra keys from `/common/discovery/v2.0/keys`), RS256 only, issuer equal to `https://login.microsoftonline.com/<tid>/v2.0` for the token's own tenant, audience equal to the API client id (or `api://<id>`), `ver` 2.0, expiry, and the `access_as_user` scope.

## Not done

- The store is a JSON file (`DATA_FILE`). `src/store.ts` is the single seam to swap for SQL.
- No admin UI yet; admin actions are API calls.
- Nothing here has been run against real Entra or Google: the tests use a locally generated signing key. Follow the phases: Microsoft tenant first, then a personal/guest Google account, then the edge-case list.
