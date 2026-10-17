# Microsoft / Google sign-in: exact setup steps

Code: `apps/auth-web` (React + MSAL, port 5174) and `apps/auth-api` (Node, port 3001).

```
React (MSAL) -> Microsoft Entra -> (Google, for invited Gmail guests) -> Entra
      |                                                                   |
      +------- Bearer access token -> Node API validates it <-------------+
                  401 token invalid | 403 not allowed (with reason) | 200
```

You do Parts 1 to 5 yourself in a browser (I cannot create accounts or app registrations for you). Each part says what to copy and where it goes. Do them in order. **Part 6 (Google) is optional; get Microsoft working first.**

You need: a Microsoft Entra tenant where you are at least *Application Administrator* (this is the "home" tenant, e.g. Technorucs), Node 22, and this repo on the `claude/microsoft-google-sso` branch.

---

## Part 1. Register the API app

Portal: <https://entra.microsoft.com>. Make sure the top-right directory is your home tenant.

1. **Entra ID > App registrations > New registration**.
2. Name: `observe-auth-api`.
3. Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts**.
4. Redirect URI: leave empty. Click **Register**.
5. On the Overview page copy:
   - **Application (client) ID** -> this is `API_CLIENT_ID` (call it **API-ID** below).
   - **Directory (tenant) ID** -> this is your home **TENANT-ID**.
6. Left menu **Expose an API**:
   1. Next to *Application ID URI* click **Add**, keep the default `api://<API-ID>`, **Save**.
   2. **Add a scope** with exactly these values, then **Add scope**:
      - Scope name: `access_as_user`
      - Who can consent: **Admins and users**
      - Admin consent display name: `Access observe-auth-api`
      - Admin consent description: `Allows the app to call the API as the signed-in user`
      - User consent display name / description: same texts
      - State: **Enabled**
7. Left menu **Manifest**. Make the API issue v2.0 tokens (the API rejects v1 tokens):
   - In the *Microsoft Graph App Manifest* editor set `"api": { "requestedAccessTokenVersion": 2, ... }` (keep the other `api` properties as they are).
   - If you see the older *AAD Graph* manifest instead, set `"accessTokenAcceptedVersion": 2`.
   - **Save**.

## Part 2. Register the React (SPA) app

1. **App registrations > New registration**.
2. Name: `observe-auth-web`.
3. Supported account types: the same multitenant + personal option as Part 1.
4. Redirect URI: platform **Single-page application (SPA)**, value `http://localhost:5174`. **Register**.
5. Copy **Application (client) ID** -> `VITE_CLIENT_ID` (call it **SPA-ID**).
6. **API permissions > Add a permission > My APIs > observe-auth-api > Delegated permissions** -> tick `access_as_user` -> **Add permissions**.
7. Click **Grant admin consent for <your tenant>** and confirm. (Users of your own tenant then never see a consent prompt.)
8. Optional but tidy: in the **API app** (`observe-auth-api`) go to **Expose an API > Add a client application**, paste **SPA-ID**, tick `access_as_user`, **Add application**.
9. Later, for production, add your real URL under **Authentication > Single-page application > Add URI**.

## Part 3. Find the ids the API needs

1. **TENANT-ID**: copied in Part 1 step 5.
2. **Your object id**: **Entra ID > Users > (your user) > Overview > Object ID** -> call it **MY-OID**.
3. For each other approved company (e.g. Mindgate) ask their admin for their **Tenant ID** (Entra ID > Overview). You only need this in `restricted` mode.

## Part 4. Configure and run the API

```bash
cd apps/auth-api
cp .env.example .env
```

Edit `apps/auth-api/.env`:

```
API_CLIENT_ID=<API-ID>
AUTH_MODE=restricted
SEED_TENANTS=<TENANT-ID>=Technorucs,<MINDGATE-TENANT-ID>=Mindgate
BOOTSTRAP_ADMINS=<TENANT-ID>:<MY-OID>
CORS_ORIGIN=http://localhost:5174
DATA_FILE=./data.json
PORT=3001
```

- All ids are lower-case GUIDs. `SEED_TENANTS` is `tenantId=Display Name`, comma separated.
- `BOOTSTRAP_ADMINS` makes you `SuperAdmin` + `Admin` the first time you sign in (and promotes you if you signed in earlier).
- Use `AUTH_MODE=open` only if any company may sign in; tenants then get approved automatically.

```bash
# from the repo root, once
npm install
npm run dev -w @observe/auth-api
```

Check it: `curl http://localhost:3001/health` returns `{"ok":true}`, and `curl -i http://localhost:3001/api/me` returns `401`.

## Part 5. Configure and run the React app

```bash
cd apps/auth-web
cp .env.example .env.local
```

Edit `apps/auth-web/.env.local`:

```
VITE_CLIENT_ID=<SPA-ID>
VITE_API_CLIENT_ID=<API-ID>
VITE_AUTHORITY=https://login.microsoftonline.com/common
VITE_API_URL=http://localhost:3001
```

```bash
# from the repo root, in a second terminal
npm run dev -w @observe/auth-web
```

Open <http://localhost:5174> and test in this order:

| # | Test | Expected |
|---|------|----------|
| 1 | Click **Continue with Microsoft**, sign in with your Technorucs account | "Hello, <you>", roles `SuperAdmin, Admin`, organization Technorucs |
| 2 | Sign in as a normal Technorucs user (second browser profile) | roles `Employee` |
| 3 | Sign in as a user from a tenant NOT in `SEED_TENANTS` | "Access denied: your organization has not been approved" |
| 4 | Sign in as a Mindgate user (tenant listed in `SEED_TENANTS`) | Works as Employee. First time they may see a consent prompt (see Troubleshooting) |

Manage users and organizations with the API (replace `$TOKEN` with an access token; in the browser dev tools run `JSON.stringify(Object.values(sessionStorage))` and take the entry whose `credentialType` is `AccessToken`):

```bash
curl -H "Authorization: Bearer $TOKEN" localhost:3001/api/admin/users
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
     -d '{"status":"suspended"}' localhost:3001/api/admin/users/<user-id>
curl -X POST  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
     -d '{"tenantId":"<guid>","name":"New Co"}' localhost:3001/api/admin/organizations
```

---

## Part 6. Add Google (optional, after Part 5 works)

Google only works for **Gmail users you have invited as guests** to your Entra tenant. It is not a button that lets any Gmail address in.

### 6a. Google Cloud (the OAuth client)

1. <https://console.developers.google.com>, create a project (e.g. `Entra B2B`).
2. **APIs & Services > OAuth consent screen**: User type **External**, set app name, support email, developer email. Under *Authorized domains* add `microsoftonline.com`. Save.
3. On the consent screen **Publish app** (otherwise only listed test users can sign in).
4. **Credentials > Create credentials > OAuth client ID > Web application**. Under *Authorized redirect URIs* add all three:
   - `https://login.microsoftonline.com`
   - `https://login.microsoftonline.com/te/<TENANT-ID>/oauth2/authresp`
   - `https://login.microsoftonline.com/te/<tenant-name>.onmicrosoft.com/oauth2/authresp`
5. **Create**, copy the **Client ID** and **Client secret**.

### 6b. Entra

1. Sign in as at least *External Identity Provider Administrator*.
2. **Entra ID > External Identities > All identity providers**, on the **Google** row click **Configure**, paste the Client ID and secret, **Save**.
3. **Users > Invite external user**, enter the person's Gmail address, send. The person must open the invitation and redeem it with that Google account.

### 6c. What the Gmail user does

1. Open the React app, click **Continue with Microsoft**.
2. On the Microsoft page choose **Sign-in options > Sign in to an organization**, type your organization name (or domain, e.g. `technorucs.onmicrosoft.com`), then sign in with Google. (Entering the Gmail address directly on the first screen does not find the guest; this extra step is how Entra's common endpoint works.)
3. The app shows **Signed in with: Google**. The tenant is yours, so the organization must already be approved (it is, if it is in `SEED_TENANTS`).

---

## How access is decided (per request)

1. Token valid? Signature, RS256, issuer `https://login.microsoftonline.com/<tid>/v2.0`, audience `<API-ID>` or `api://<API-ID>`, `ver` 2.0, not expired, scope `access_as_user`. Otherwise **401**.
2. Organization for the token's tenant approved? Not found -> `organization_not_approved` (restricted mode); suspended -> `organization_suspended`. **403**.
3. First sign-in from an approved organization creates the user as `Employee`.
4. User suspended / deleted / not an active member / no role -> `user_suspended`, `user_deleted`, `no_membership`, `no_role`. **403**.
5. Permission check on the route: `Employee` = profile; `Admin` adds `users:manage` (own organization only); `SuperAdmin` adds `orgs:manage`.

Identities are never merged by e-mail: the same person via Microsoft and via Google becomes two users.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser: `AADSTS50011 redirect URI mismatch` | Part 2 step 4: redirect must be platform **SPA**, exactly `http://localhost:5174` |
| Browser: `AADSTS700016 application not found` | `VITE_CLIENT_ID` wrong, or the account type is not multitenant (Part 2 step 3) |
| `AADSTS65001` / "Need admin approval" when a Mindgate user signs in | Their tenant blocks user consent. Their admin opens `https://login.microsoftonline.com/<their-tenant-id>/adminconsent?client_id=<SPA-ID>` and accepts. Apps from unverified publishers often need this |
| API returns 401 "unexpected audience" | `API_CLIENT_ID` is not the **API** app's id, or `VITE_API_CLIENT_ID` is wrong |
| API returns 401 "Only v2.0 access tokens are accepted" | Part 1 step 7 not saved |
| API returns 401 "missing the access_as_user scope" | Part 2 step 6 not done, or scope name misspelled |
| Browser console CORS error | `CORS_ORIGIN` must equal the web origin exactly |
| You are `Employee` instead of `SuperAdmin` | `BOOTSTRAP_ADMINS` needs `tenantId:objectId` (your **user** object id, not the app's); restart the API and refresh |
| Gmail user: "account not found" | Not invited/redeemed, Google not configured, or they skipped *Sign in to an organization* |

## Edge cases to test (Phase 4)

Unapproved organization, suspended user, deleted employee, expired token, invalid token, wrong audience, missing role, same e-mail from Microsoft and Google, organization removed. All except the live-Entra ones are covered by `npm test -w @observe/auth-api`.

## Not done

- Store is a JSON file; `apps/auth-api/src/store.ts` is the one place to replace with SQL.
- No admin screen yet (API calls only).
- No production hosting or HTTPS config. Before deploying, add the real SPA URL (Part 2 step 9) and set `CORS_ORIGIN`.
- Nothing here has been run against real Entra or Google; the automated tests use a locally generated signing key.
