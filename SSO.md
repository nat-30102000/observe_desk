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

## Part 1. Register the one app (it is both the React client and the API)

Portal: <https://entra.microsoft.com>. Make sure the top-right directory is your home tenant.

1. **Entra ID > App registrations > New registration**.
2. Name: `observe-auth`.
3. Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts**.
4. Redirect URI: platform **Single-page application (SPA)**, value `http://localhost:5174`. Click **Register**.
5. On the Overview page copy:
   - **Application (client) ID** -> this is `API_CLIENT_ID` (call it **APP-ID** below).
   - **Directory (tenant) ID** -> this is your home **TENANT-ID**.
6. Left menu **Expose an API**:
   1. Next to *Application ID URI* click **Add**, keep the default `api://<APP-ID>`, **Save**.
   2. **Add a scope** with exactly these values, then **Add scope**:
      - Scope name: `access_as_user`
      - Who can consent: **Admins and users**
      - Admin consent display name: `Access observe-auth`
      - Admin consent description: `Allows the app to call the API as the signed-in user`
      - User consent display name / description: same texts
      - State: **Enabled**
7. Left menu **Manifest**. Make the API issue v2.0 tokens (the API rejects v1 tokens):
   - In the *Microsoft Graph App Manifest* editor set `"api": { "requestedAccessTokenVersion": 2, ... }` (keep the other `api` properties as they are).
   - If you see the older *AAD Graph* manifest instead, set `"accessTokenAcceptedVersion": 2`.
   - **Save**.
8. Left menu **Token configuration > Add optional claim > Access** -> tick `acct` -> **Add** (accept the prompt about Graph permissions if shown). `acct` is `1` for guests and lets the API tell self-signed-up guests (Gmail users) from your own employees.

## Part 2. Let the app call its own API (no second registration)

1. In the same `observe-auth` app: **API permissions > Add a permission > My APIs > observe-auth > Delegated permissions** -> tick `access_as_user` -> **Add permissions**.
2. Click **Grant admin consent for <your tenant>** and confirm. (Users of your own tenant then never see a consent prompt.)
3. For production later: **Authentication > Single-page application > Add URI** with your real URL.

The React app requests the scope `api://<APP-ID>/access_as_user`, so the access token's audience is this same app, which is what the Node API checks.

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
API_CLIENT_ID=<APP-ID>
AUTH_MODE=restricted
SEED_TENANTS=<TENANT-ID>=Technorucs,<MINDGATE-TENANT-ID>=Mindgate
BOOTSTRAP_ADMINS=<TENANT-ID>:<MY-OID>
GUEST_POLICY=pending
CORS_ORIGIN=http://localhost:5174
DATA_FILE=./data.json
PORT=3001
```

- All ids are lower-case GUIDs. `SEED_TENANTS` is `tenantId=Display Name`, comma separated.
- `BOOTSTRAP_ADMINS` makes you `SuperAdmin` + `Admin` the first time you sign in (and promotes you if you signed in earlier).
- `GUEST_POLICY=pending` (default): people who sign themselves up (Gmail etc.) are created in your database as **pending** and see "An administrator needs to approve your account" until an Admin sets them `active`. `allow` lets guests straight in as Employee.
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
VITE_CLIENT_ID=<APP-ID>
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

## Open to every Microsoft account (work, school and personal), no invite, no approval

Use this when anyone with a Microsoft account may sign in straight away.

**API `.env`**
```
AUTH_MODE=open
```
Any Entra tenant is accepted and registered on its first sign-in, and every user becomes an Employee at once. All personal accounts (outlook.com, hotmail.com, live.com) share Microsoft's one personal-account tenant, so they appear together as one organization called "Personal Microsoft accounts". Each person is still their own user, and an Admin can suspend any of them.

**Web `.env.local`**
```
VITE_AUTHORITY=https://login.microsoftonline.com/common
```
`/common` is what lets personal and work accounts from any company reach the sign-in page. A tenant-specific authority would block them.

**Entra (the one app registration)**: Part 1 step 3 must be *any organizational directory and personal Microsoft accounts*, and `requestedAccessTokenVersion` must be `2` (Part 1 step 7). Without both, personal accounts get an error.

**The part you cannot control: consent in other companies.** The first time someone from another company signs in, Microsoft asks them to consent to your app. If their company's admin has restricted user consent, they see "Need admin approval" and no code on your side can bypass it. By default Microsoft lets users consent only to apps from a **verified publisher**. To avoid most of these prompts, complete **Publisher verification** (Entra > your app > Branding & properties > Publisher verification, which needs a Microsoft Cloud Partner Program ID). Personal accounts consent for themselves and are not affected.

**Combining this with Gmail (Part 6):** open mode plus `/common` works for Microsoft accounts. Gmail users sign up as guests of your tenant, and the guest policy still applies to them (`GUEST_POLICY=pending` or `allow`). Whether the Gmail self-service sign-up appears under `/common` or only under your tenant-specific authority is the untested point from Part 6.

---

> **Why two buttons.** On the shared `/common` sign-in page, typing a Gmail address gives "We couldn't find an account with that username": Microsoft only looks for a Microsoft account with that address and never offers Google. Gmail sign-in and sign-up only works through your own tenant, so the app shows a second button, **Continue with Gmail**, when `VITE_TENANT_ID` is set. It signs in with `https://login.microsoftonline.com/<TENANT-ID>`, where the Google provider and the self-service user flow live. The first button stays on `/common` for work, school and personal Microsoft accounts.

## Part 6. Gmail without manual invitations (Google + self-service sign-up)

Goal: a person types their Gmail address on the Microsoft sign-in page, signs in with Google, and a guest account is created for them automatically. No admin invites them. Microsoft documents this as Google federation plus a *self-service sign-up user flow* in a workforce tenant. Do Part 5 first.

### 6a. Google Cloud (the OAuth client)

1. <https://console.developers.google.com>, create a project (e.g. `Entra B2B`).
2. **APIs & Services > OAuth consent screen**: User type **External**; set app name, support email, developer email. Under *Authorized domains* add `microsoftonline.com`. Save.
3. On the consent screen click **Publish app** (otherwise only listed test users can sign in).
4. **Credentials > Create credentials > OAuth client ID > Web application**. Under *Authorized redirect URIs* add all three:
   - `https://login.microsoftonline.com`
   - `https://login.microsoftonline.com/te/<TENANT-ID>/oauth2/authresp`
   - `https://login.microsoftonline.com/te/<tenant-name>.onmicrosoft.com/oauth2/authresp`
5. **Create**; copy the **Client ID** and **Client secret**.

### 6b. Entra: Google as an identity provider

1. Sign in as at least *External Identity Provider Administrator*.
2. **Entra ID > External Identities > All identity providers**, **Google** row > **Configure**, paste Client ID and secret, **Save**.

### 6c. Entra: turn on self-service sign-up

1. **Entra ID > External Identities > External collaboration settings**: set **Enable guest self-service sign up via user flows** to **Yes**, **Save**. (Needs at least *User Administrator*.)
2. **Entra ID > External Identities > User flows > New user flow**:
   - Name: `observe-signup` (Entra prefixes it with `B2X_1_`).
   - Identity providers: tick **Google** (and optionally *Email one-time passcode* for people without a Google or Microsoft account).
   - User attributes: **Display Name** is enough. Attributes are only collected the first time.
   - **Create**.
3. Open the new flow > **Applications > Add application** > pick **observe-auth** > **Select**.

### 6d. Point the React app at your tenant

User flows run in your tenant, so the Gmail path signs in through your tenant. In `apps/auth-web/.env.local` add (keep `VITE_AUTHORITY` on `/common`):

```
VITE_TENANT_ID=<TENANT-ID>
```

This shows a second button, **Continue with Gmail**. Restart `npm run dev -w @observe/auth-web`.

### 6e. Test with a Gmail address that nobody invited

1. Open <http://localhost:5174> in a private window, click **Continue with Microsoft**.
2. Type the Gmail address, choose Google, sign in. Accept the consent prompt. The guest account is created in your tenant.
3. Expected: the app shows "Your sign-up worked. An administrator needs to approve your account" (`pending_approval`).
4. Sign in as an Admin, list users (`GET /api/admin/users`), find the user with `"status":"pending"`, and activate:
   `PATCH /api/admin/users/<id>` with `{"status":"active"}`.
5. The Gmail user refreshes and sees "Signed in with: Google".

### 6f. What changes when people sign themselves up

- **Their token's tenant is yours.** A self-signed-up guest gets `tid` = your tenant, `acct` = 1, so the API puts them in *your* organization (e.g. Technorucs) as `pending`, not in any company of their own. That is why `GUEST_POLICY=pending` is the default: otherwise anyone with a Gmail account could create themselves an Employee account in your approved organization.
- **Other companies' employees** signing in through the common endpoint keep their own tenant and are routed by `tid` as before. If you use the tenant-specific authority in 6d, other companies' employees may also be treated as guests of your tenant and land in `pending`. Decide which you want: `/common` for "company tenants are approved separately", tenant-specific for "everyone external signs up to my tenant and I approve each person".
- **Not verified by me:** whether the Microsoft sign-in page offers the self-service sign-up journey under `/common` or only under a tenant-specific authority. Microsoft's docs describe the user flow per application and tenant; test both authorities in step 6e and keep the one that works for you.
- If the guest's token has no `acct` claim (step 8 of Part 1 missed), the API still treats a token whose `idp` is not your tenant (for example `google.com`) as a guest.

---

## Part 7. Invite Gmail users automatically (no "Create one", no admin step)

With this, a Gmail user types their address on **your** page, the API creates a guest account for them through Microsoft Graph, and they are sent to Microsoft with the address filled in, where Google signs them in. Finish Part 6 first (Google provider saved in Entra).

### 7a. Give the app permission to invite guests

1. entra.microsoft.com > **Entra ID > App registrations > observe-auth > API permissions**.
2. **Add a permission > Microsoft Graph > Application permissions** (not Delegated), search `User.Invite.All`, tick it, **Add permissions**.
3. Click **Grant admin consent for <tenant>** and confirm. The status must show a green tick "Granted".

### 7b. Create a client secret

1. Same app: **Certificates & secrets > Client secrets > New client secret**, any description, 12 or 24 months, **Add**.
2. Copy the **Value** immediately (the long string, not the "Secret ID"). It is shown once.

### 7c. API settings

Add to `apps/auth-api/.env`:

```
TENANT_ID=<TENANT-ID>
INVITE_CLIENT_SECRET=<the secret Value from 7b>
WEB_URL=http://localhost:5174
INVITE_DOMAINS=gmail.com,googlemail.com
INVITES_PER_HOUR=30
```

Restart the API. Without `INVITE_CLIENT_SECRET` the feature is off and `/auth/invite` returns 404, and the Gmail form still works through Microsoft's "Create one".

### 7d. Web settings

`apps/auth-web/.env.local` already needs `VITE_TENANT_ID=<TENANT-ID>` (Part 6d). The login page then shows an email field and **Continue with Gmail**.

### 7e. Test

1. Use a Gmail address that is not yet a guest. Delete any old guest first: Entra ID > Users > the guest > Delete.
2. Open the app, type the address under "or use a Gmail address", click **Continue with Gmail**.
3. Microsoft opens with the address pre-filled and goes to Google. Sign in and accept consent.
4. Check Entra ID > Users > filter User type = Guest: the user exists, Identities `google.com`.
5. The app shows the signed-in page, or "An administrator needs to approve your account" while `GUEST_POLICY=pending`.

### What the API does, and the safety limits

- `POST /auth/invite` is public (the user is not signed in yet), so it is restricted: only `INVITE_DOMAINS` (Gmail by default), at most 5 requests per hour per client address and `INVITES_PER_HOUR` overall, and Graph error details are logged on the server only.
- It sends **no invitation e-mail** (`sendInvitationMessage: false`). The guest is redeemed when the person signs in with Google, which also proves they own the address.
- Anyone can create a guest object for a Gmail address by typing it, but only the real owner can sign in as it. Guest objects do not give access: `GUEST_POLICY=pending` still holds them until approved.
- The client secret can create guests in your tenant. Keep it only in the API `.env` or your host's secret store, never in the web app or git, and rotate it before it expires. It lives on the same app registration as the web client; if you want stricter separation, use a second registration only for the API and move `User.Invite.All` and the secret there.
- If the invite call fails (secret wrong or expired, permission not consented), the sign-in still continues and the user can use "Create one" as before. The reason appears in the API log as `invite failed:`.

---

## How access is decided (per request)

1. Token valid? Signature, RS256, issuer `https://login.microsoftonline.com/<tid>/v2.0`, audience `<APP-ID>` or `api://<APP-ID>`, `ver` 2.0, not expired, scope `access_as_user`. Otherwise **401**.
2. Organization for the token's tenant approved? Not found -> `organization_not_approved` (restricted mode); suspended -> `organization_suspended`. **403**.
3. First sign-in from an approved organization creates the user as `Employee`. Guests (`acct` = 1) are created as `pending` unless `GUEST_POLICY=allow`.
4. User suspended / deleted / not an active member / no role -> `pending_approval`, `user_suspended`, `user_deleted`, `no_membership`, `no_role`. **403**.
5. Permission check on the route: `Employee` = profile; `Admin` adds `users:manage` (own organization only); `SuperAdmin` adds `orgs:manage`.

Identities are never merged by e-mail: the same person via Microsoft and via Google becomes two users.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser: `AADSTS50011 redirect URI mismatch` | Part 1 step 4: redirect must be platform **SPA**, exactly `http://localhost:5174` |
| Browser: `AADSTS700016 application not found` | `VITE_CLIENT_ID` wrong, or the account type is not multitenant (Part 1 step 3) |
| `AADSTS65001` / "Need admin approval" when a Mindgate user signs in | Their tenant blocks user consent. Their admin opens `https://login.microsoftonline.com/<their-tenant-id>/adminconsent?client_id=<APP-ID>` and accepts. Apps from unverified publishers often need this |
| API returns 401 "unexpected audience" | `API_CLIENT_ID` or `VITE_CLIENT_ID` is not the app's id (both must be the same value) |
| API returns 401 "Only v2.0 access tokens are accepted" | Part 1 step 7 not saved |
| API returns 401 "missing the access_as_user scope" | Part 2 step 1 not done, or scope name misspelled |
| Browser console CORS error | `CORS_ORIGIN` must equal the web origin exactly |
| You are `Employee` instead of `SuperAdmin` | `BOOTSTRAP_ADMINS` needs `tenantId:objectId` (your **user** object id, not the app's); restart the API and refresh |
| Gmail user: "account not found" / no Google option | Google identity provider not saved (6b), self-service sign-up toggle off (6c step 1), the app is not added to the user flow (6c step 3), or `VITE_TENANT_ID` is not set so you are not using the Gmail button (6d) |
| API log `invite failed: Graph token request failed` | Wrong or expired secret (7b), or `TENANT_ID` wrong |
| API log `Graph invitation failed (403)` | `User.Invite.All` is a Delegated permission or admin consent not granted (7a) |
| Gmail user sees "approve your account" | Working as designed: activate them (6e step 4) or set `GUEST_POLICY=allow` |
| Gmail sign-in fails inside an embedded browser | Google blocks embedded web views; use a normal browser (the React app already does) |

## Edge cases to test (Phase 4)

Unapproved organization, suspended user, deleted employee, expired token, invalid token, wrong audience, missing role, same e-mail from Microsoft and Google, organization removed. All except the live-Entra ones are covered by `npm test -w @observe/auth-api`.

## Not done

- Store is a JSON file; `apps/auth-api/src/store.ts` is the one place to replace with SQL.
- No admin screen yet (API calls only).
- No production hosting or HTTPS config. Before deploying, add the real SPA URL (Part 2 step 3) and set `CORS_ORIGIN`.
- Nothing here has been run against real Entra or Google; the automated tests use a locally generated signing key.
