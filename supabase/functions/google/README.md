# google Edge Function

Google services for DeskDev. The server, never the browser, holds every Google grant and talks
to Google. A connection has a **purpose** instead of a hardcoded scope list
(`../_shared/google_policy.ts`):

| Purpose | Who | Scopes | Stored in |
|---|---|---|---|
| `personal` | any signed-in person | `openid email drive.file` | `google_connections`, one row per person (027) |
| `workspace` | **admins only** | `openid email calendar.app.created drive.file` | `google_workspace_link`, one row for the company account (040) |

Both scopes are **non-sensitive**: `drive.file` reaches only files this app created, and
`calendar.app.created` only calendars this app created. No restricted Gmail or Drive scope is ever
requested, so the consent screen needs no security assessment (CASA). Gmail and Sheets automation
runs in n8n under a separate Google Cloud project (see the runbook below).

Code:

| File | What |
|---|---|
| `index.ts` | the function: browser legs and signed-in actions |
| `cors.ts` | CORS allow-list (byte-identical copy in `admin-users/` and `vault-reset/`) |
| `../_shared/google_policy.ts` | purposes, consent URL, returnTo allow-list, flow cookie, public error sentences (pure) |
| `../_shared/google_crypto.ts` | keyring, sealed tokens v1/v2, signed state, sealed blobs, PKCE (pure, WebCrypto only) |
| `../_shared/google_grants.ts` | reading/writing grants, refresh, revoke, offboarding hook, key rotation, audit (Deno) |
| `site/src/app/api/google/[leg]/route.ts` | the apex OAuth proxy on `nixgensolutions.com/api/google/*` |

The pure modules and the proxy are tested by the site's Vitest suite:
`site/src/app/api/google/googleShared.test.ts` and `site/src/app/api/google/[leg]/route.test.ts`.

## The connect flow

```
DeskDev ──POST /api/google/connect (session token)──▶ apex route ──connect via=proxy──▶ function
        ◀── 303 to Google + Set-Cookie dd_google_flow (nonce + PKCE verifier, sealed) ──┘
Google ──GET /api/google/callback?code&state (cookie)──▶ apex route ──proxy_callback (cookie in header)──▶ function
        ◀── 302 to DeskDev ?google=pending&grant=… (or ?google=error&reason=…), cookie cleared
DeskDev ──finish {grant} (session token)──▶ function: stored only if the session is the user who pressed Connect
```

- **Apex proxy.** With `GOOGLE_REDIRECT_BASE=https://nixgensolutions.com/api/google`, Google's
  redirect URI is on a domain the consent screen verifies (not `*.supabase.co`), and the flow
  cookie is first-party: `Path=/api/google; HttpOnly; Secure; SameSite=Lax`.
- **Same-response binding.** `connect` is served by the route that checked the session: the
  function verifies the caller's token, signs the state, creates the PKCE verifier, and returns
  the consent URL **and** the sealed cookie value; the route sets the cookie in that same
  response. No bearer "start" link exists in this path, so a forwarded link has nothing to hand on.
- **PKCE (S256).** The verifier exists only in that sealed cookie and on the server; an
  intercepted `code` is useless without the browser that started the flow.
- **The callback stores nothing.** It seals the grant (user id, purpose, Google email, scopes,
  refresh token, 10-minute expiry) and sends it back to DeskDev. `finish` stores it only when the
  caller's session is the user the state was signed for, and a `workspace` grant only for an admin.
- **Legacy start link.** `connect` without `via:'proxy'` still answers `{ url: <base>/start?state=… }`
  for the current client (`site/src/deskdev/lib/google.ts`). That link is a bearer link (whoever
  opens it gets the cookie), which is why `finish`, not the cookie, is the real binding: a
  forwarded link ends in a 403 on `finish` and nothing is stored or revoked. A `workspace`
  (calendar) connect never gets a start link: it answers 400 unless it comes through the proxy
  (`via:'proxy'`), so the company grant only ever starts with same-response binding.

## Actions

Browser legs (no Supabase JWT):

| Call | Result |
|---|---|
| `GET /google/start?state=…` | sets the flow cookie (function path), 302 to Google |
| `GET /google/callback?code&state` | 302 back into DeskDev (`?google=pending&grant=…` or `?google=error&reason=…`) |
| `POST {action:'proxy_start', state}` | the same as JSON `LegResult`, for the apex route |
| `POST {action:'proxy_callback', query}` + `x-deskdev-google-flow` header | the same as JSON `LegResult` |

Signed-in actions (`Authorization: Bearer <DeskDev access token>`):

| Action | Who | Result |
|---|---|---|
| `status` | anyone | `{ configured, connected, email, connectedAt, driveGranted, purpose, isAdmin, exportAllowed, proxied, workspace }` (`workspace` is filled for admins only) |
| `connect {returnTo, purpose?, via?}` | anyone; `workspace` admins only, and only with `via:'proxy'` | `{ url }`, or with `via:'proxy'` `{ url, flow, maxAge }` |
| `finish {grant}` | the user who pressed Connect | `{ ok, email, purpose }` |
| `disconnect {purpose?}` | anyone; `workspace` admins only | `{ ok }`: removes the grant, then revokes it at Google |
| `export {tabs?}` | **admins only** | `{ url, title, tabs, skipped }`: a new spreadsheet in the admin's Drive → *DeskDev Exports* |
| `revoke_user {userId}` | **admins only** | `{ ok, removed, revokedAtGoogle, skipped? }`: offboarding |
| `rotate_tokens` | **admins only** | `{ ok, key, resealed, current, failed, workspace }`: re-seals every token with the current key |

"Admin" means `profiles.role = 'admin'` and `deactivated_at` is null (032): an access token issued
before a deactivation stays valid for up to an hour, and that gap is closed here.

Export tabs: `clients`, `projects`, `tasks`, `time_entries`, `leads`, `eod_reports` (any subset).
Rows are read with the **caller's** JWT, so RLS decides what lands in the sheet. Up to 5,000 rows
per tab; values are written `RAW`, so `=IMPORTXML(…)` stays text. **Every export writes one
`audit_log` row (`google.export`) before any data leaves; if that row cannot be written, the
export is refused (503).**

### Audit rows

| action | entity | written by |
|---|---|---|
| `google.export` | `google_export` | `export` (before the sheet is created) |
| `google.revoked` | `profile` (entity_id = the user) | `revoke_user` |
| `google.keys_rotated` | `google_keys` (entity_id = the current kid) | `rotate_tokens` |
| `google.workspace_connected` | `google_workspace_link` (entity_id `workspace`) | `finish` of a `workspace` grant |
| `google.workspace_disconnected` | `google_workspace_link` (entity_id `workspace`) | `disconnect {purpose:'workspace'}` |
| `google.workspace_revoked` | `google_workspace_link` | 040's trigger, when Google refused the grant (status `revoked`, token still stored) |

### The workspace link row

The function writes 040's `google_workspace_link` singleton directly with the service role
(`storeWorkspaceGrant` / `clearWorkspaceGrant` in `../_shared/google_grants.ts`); 040's triggers on
the row own the side effects, whoever writes it:

- `finish` upserts it: `status 'active'`, the v2-sealed token, a fresh `connected_at`. A different
  Google account drops the old calendar id and re-queues every synced event; any (re)connect kicks
  the sync worker.
- `disconnect {purpose:'workspace'}` keeps the row (calendar id and history outlive a grant) with
  `status 'revoked'` and `refresh_token_enc = NULL`, then revokes the grant at Google (unless a
  person's own connection uses the same Google account). No admin notification: the admin did it.
- Google refusing the grant (`invalid_grant`, an unreadable token, a lost calendar scope) goes
  through 040's `google_workspace_mark_revoked()`: the token stays, the trigger tells every active
  admin once and writes `google.workspace_revoked`.

## Offboarding

`revokeGoogleForUser(admin, userId)` in `../_shared/google_grants.ts` is the hook. It deletes the
person's `google_connections` row first (so a failure at Google never leaves a usable grant), then
revokes the grant at Google, except when the company workspace link uses the same Google account
(Google revokes per account, so that would also kill the Team Calendar). It never throws for
missing keys or an unreadable token; deactivation must not fail because Google is not set up.

- `admin-users` must call it on `deactivate` and before `delete` (wired by the account-lifecycle work):
  ```ts
  import { revokeGoogleForUser } from "../_shared/google_grants.ts";
  // after the profile is marked deactivated / before the auth user is deleted:
  try {
    const google = await revokeGoogleForUser(adminClient, userId);
    if (google.removed) console.info("[admin-users] google grant removed", google);
  } catch (err) {
    console.error("[admin-users] google revoke failed", err); // never blocks the deactivation
  }
  ```
- An admin can also call `revoke_user {userId}` on this function (audited).
- The workspace link belongs to the company account, not a person, and is left alone. If the
  departing admin connected it with a personal Google account, reconnect it with the company one.

## Sealed tokens and key rotation

| Format | Key | Additional data |
|---|---|---|
| `v1.<iv>.<ct>` (027, still **read**) | HKDF(`GOOGLE_TOKEN_KEY`, `…/refresh-token/v1`) | user id |
| `v2.<kid>.<iv>.<ct>` (written now) | HKDF(keyring[kid], `…/refresh-token/v2`) | `v2\|<kid>\|user:<id>` or `v2\|<kid>\|workspace` |

The key id travels with the token, so adding a key does not log anyone out. States are
HMAC-signed `<kid>.<body>.<sig>`; the in-flight grant (`g2.`) and the flow cookie (`f1.`) are
AES-GCM blobs with their own derived keys.

Personal rows are written as v2. While `google_connections` still has 027's
`CHECK (refresh_token_enc LIKE 'v1.%')`, the insert is refused with 23514 and the row is written as
v1 instead (with `GOOGLE_TOKEN_KEY`), so deploying this function never depends on migration order.
Once that CHECK is widened to `~ '^v[0-9]+\.'`, the next use of each row re-seals it as v2.

**Rotating the key:**
1. Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. `GOOGLE_TOKEN_KEYS=k1:<old base64>,k2:<new base64>` and `GOOGLE_TOKEN_KEY_ID=k2`
   (keep `GOOGLE_TOKEN_KEY` set while any v1 row may exist; it is readable as `k0`).
3. As an admin, call `rotate_tokens` (or wait: each token is re-sealed on its next use).
4. When the result shows `failed: 0` and no v1 rows remain, remove the old key.

A missing, malformed or unknown key is a **configuration** error: every action answers 503 and no
row is touched. Only a token that really does not decrypt deletes a personal row (409 `{reauth}`),
and only Google's `invalid_grant` marks the workspace link `revoked`.

## Errors

Callers get a fixed sentence (`PUBLIC_ERRORS` in `google_policy.ts`); Google's and the database's
messages go to the function log only (`supabase functions logs google`). CORS answers only the
origins in `APP_ORIGINS` (plus loopback for local dev), and a POST from any other browser origin
gets 403 before anything runs. The apex proxy calls the function server-to-server with no Origin.

`?google=error&reason=` (the UI explains each one, `connectErrorMessage` in `lib/google.ts`):

| Reason | Cause |
|---|---|
| `denied` | Cancel on Google's screen |
| `scope` | a required permission was unticked (granular consent) |
| `browser` | the callback reached a browser without this flow's cookie (another browser, or cookies blocked) |
| `expired` | more than 10 minutes between Connect and the callback |
| `session` | connect: the DeskDev session was missing or expired |
| `forbidden` | connect: the purpose is admin-only |
| `exchange`, `no_refresh`, `email`, `config`, `google` | server side: check the function logs |

`finish` answers 403 for a grant started by another DeskDev account, 400 for a garbled or expired
one, and 503 when the secrets are misconfigured.

## Runbook (owner)

The same path as plain steps with copy buttons, for whoever holds the company Google account:
`docs/runbooks/google-setup.html` (open the file in a browser; it holds no secret).

### 1. Two Google Cloud projects

Create both under the **company** Google account (the projects and their consent screens belong
to whoever creates them).

| Project | Used by | Scopes | Consent screen |
|---|---|---|---|
| **DeskDev** | this function (later also Sign in with Google) | `openid`, `userinfo.email`, `drive.file`, `calendar.app.created` (non-sensitive only) | External, **In production** |
| **NixGen Ops** | n8n's Gmail and Sheets credentials | Gmail/Sheets as n8n needs them | External, **In production**, unverified (personal-use exemption, fewer than 100 users) |

Keeping them apart means the Gmail scopes never put the DeskDev app into verification, and a
verification on one never blocks the other. Never add a restricted Gmail or Drive scope to the
DeskDev project.

### 2. DeskDev project

1. *APIs & Services → Library*: enable **Google Drive API**, **Google Sheets API** and
   **Google Calendar API**.
2. *Google Auth Platform → Branding*: app name **DeskDev**, support email, home page
   `https://nixgensolutions.com`, privacy policy `https://nixgensolutions.com/privacy`, terms
   `https://nixgensolutions.com/terms` (the privacy page must carry Google's **Limited Use**
   disclosure). Authorized domain: `nixgensolutions.com` (verified in Search Console, step 4).
3. *Audience*: **External**. Press **Publish app** (In production). A project left in *Testing*
   silently expires every refresh token after 7 days. With only non-sensitive scopes, publishing
   needs no review.
4. *Data access*: add `openid`, `.../auth/userinfo.email`, `.../auth/drive.file` and
   `.../auth/calendar.app.created`.
5. *Clients → Create client → Web application*. Authorized redirect URIs, exactly:
   ```
   https://nixgensolutions.com/api/google/callback
   https://rgasjotvqwkjbeivlhvn.supabase.co/functions/v1/google/callback
   ```
   The first is the apex proxy (production). The second is the direct fallback, used while
   `GOOGLE_REDIRECT_BASE` is unset. Until the domain is attached, the site runs on its
   workers.dev address and `GOOGLE_REDIRECT_BASE` points there, so also add
   `https://nixgen-site.nixgensolutions.workers.dev/api/google/callback`. For local dev also add
   `http://localhost:6969/api/google/callback`. No JavaScript origins are needed. The data-access
   list also needs `.../auth/calendar.freebusy` (the booking page's free/busy check).

### 3. NixGen Ops project (n8n)

Create the project, enable the Gmail and Sheets APIs, set the consent screen to External, add the
scopes the n8n credentials need, and press **Publish app**. It stays *unverified*: Google shows an
"unverified app" warning to the company account the first time, which is expected. Then reconnect
the n8n Gmail and Sheets credentials so they get production refresh tokens (Testing-mode tokens
die after 7 days). See `automation/RENDER.md`.

### 4. Search Console domain verification (DNS)

Needs the zone on Cloudflare (`docs/runbooks/DNS-CUTOVER.md` when it exists).
1. search.google.com/search-console → *Add property* → **Domain** → `nixgensolutions.com`.
2. Copy the `google-site-verification=…` value and add it as a **TXT** record on the apex in
   Cloudflare DNS. Press *Verify* (can take a few minutes).
3. The same verification makes `nixgensolutions.com` an authorized domain for both consent screens.
4. Submit `https://nixgensolutions.com/sitemap.xml`.

### 5. Secrets

**The script does this step.** Put the client id and secret from step 2 in the secrets file
(`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`), then:

```bash
node scripts/setup-integrations.mjs --dry-run       # what would change; changes nothing
node scripts/setup-integrations.mjs --only google
```

Status on `rgasjotvqwkjbeivlhvn` (2026-10-07): the token sealing key, `APP_ORIGINS` (the three
production origins plus the workers.dev address), the calendar webhook secret and
`GOOGLE_REDIRECT_BASE=https://nixgen-site.nixgensolutions.workers.dev/api/google` are set, and
`google` / `google-calendar` run this branch's code. Only the OAuth client is missing, so `status`
still says `configured: false`. Flags for later: `--dev-origin` adds
`http://localhost:6969` to `APP_ORIGINS` for local testing, `--workers-dev-origin` adds the
production Worker's workers.dev address for the time before the domain is attached, and
`--prod-origins` takes both out again;
`--redirect-base https://nixgensolutions.com/api/google` sets `GOOGLE_REDIRECT_BASE` once the site
is live; `--replace-client` sends a new client over one the function already holds.

**Do not paste the command below on a project that is already set up.** It makes a NEW
`GOOGLE_TOKEN_KEYS`, and a new sealing key cannot read the connections the old one sealed. It is
kept as the reference for what the script sets:
```bash
supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID=<client id> \
  GOOGLE_OAUTH_CLIENT_SECRET=<client secret> \
  GOOGLE_TOKEN_KEYS=k1:$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  GOOGLE_TOKEN_KEY_ID=k1 \
  GOOGLE_REDIRECT_BASE=https://nixgensolutions.com/api/google \
  APP_ORIGINS=https://workspace.nixgensolutions.com,https://nixgensolutions.com,https://www.nixgensolutions.com
```

| Name | What |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | the DeskDev OAuth client. A new client secret works at once; grants survive |
| `GOOGLE_TOKEN_KEYS` | `kid:base64` list, each ≥ 32 random bytes |
| `GOOGLE_TOKEN_KEY_ID` | the kid new tokens are sealed with (default: the first entry) |
| `GOOGLE_TOKEN_KEY` | the original single key; keep it while v1 rows exist (readable as `k0`) |
| `GOOGLE_REDIRECT_BASE` | the apex proxy base; unset = the function serves the legs itself |
| `APP_ORIGINS` | origins DeskDev runs on: allowed `returnTo` and CORS. Add `http://localhost:6969` only on a dev project |
| `GOOGLE_FUNCTION_URL` | local dev only: the function's public URL when `SUPABASE_URL` is the internal kong address |

Site Worker (no privileged secret: the route calls the function with the public anon key and the
person's own token):

| Name | What |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | already set |
| `GOOGLE_FUNCTION_URL` (optional) | the function URL, for `supabase functions serve` |
| `GOOGLE_CONNECT_ORIGINS` (optional) | extra origins allowed to POST `/api/google/connect` (e.g. a workers.dev preview) |

### 6. Deploy and check

```bash
supabase functions deploy google --no-verify-jwt
```
`--no-verify-jwt` is required: Google's redirect carries no Supabase JWT, and every signed-in
action verifies the caller itself. Then DeskDev → Settings → Integrations → **Connect Google**:
you land back with *Google connected*. As an admin, **Export to Google Sheets** opens a new
spreadsheet inside *DeskDev Exports*, and `audit_log` has a `google.export` row.

Until step 5 is done, `status` says `configured: false` and `connect` answers 503.
