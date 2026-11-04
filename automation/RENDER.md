# n8n on Render

DeskDev's automations run on a self-hosted n8n. This file covers the host: where it runs, where
its data lives, how it boots, and how to keep it awake. The workflows themselves, and
`scripts/n8n.mjs`, are covered in [`README.md`](README.md).

## What runs where

| Piece | Where | Notes |
|---|---|---|
| n8n | Render web service `nixgen-n8n` (`srv-davbequgekts73ddg8lg`), **https://nixgen-n8n-8gp7.onrender.com** | Render account nixgensolutions@gmail.com, workspace `tea-davb8fc9v7es73f4okk0`. Free plan, Singapore, one instance, no auto-deploy |
| Image | `docker.io/n8nio/n8n:2.41.5`, pinned in `scripts/render-n8n.mjs` (`IMAGE`) | Never `latest`. n8n ships breaking changes in minors and refuses to start on a database migrated by a newer version |
| n8n's data | Its own Supabase project **`nixgen-n8n`** (`isinzodyagsbqevpeure`), schema `n8n`, user `postgres` | Workflows, credentials (encrypted with `N8N_ENCRYPTION_KEY`), failed executions. A restart or a wiped container loses nothing |
| DB connection | Session-mode pooler `aws-0-ap-southeast-1.pooler.supabase.com:5432`, TLS verified against [`supabase-root-ca-2021.crt`](supabase-root-ca-2021.crt) | Render has no IPv6 egress and `db.<ref>.supabase.co` is IPv6-only, so the pooler is the only path. The CA is pinned; verification is never turned off |
| DeskDev's app data | Supabase project `rgasjotvqwkjbeivlhvn` | n8n reaches it over HTTPS with the `Supabase — DeskDev` credential, never as a database client |
| Keep-alive | pg_cron `n8n-keepalive` in the app project, plus the optional Worker `workers/n8n-keepalive` | See below |

`scripts/render-n8n.mjs` is the only thing that changes the service:

```bash
node scripts/render-n8n.mjs status                 # service, URL, image, health check, latest deploy
node scripts/render-n8n.mjs apply [--no-deploy]    # create the service, or bring env vars, image and
                                                   # health check in line, then redeploy
node scripts/render-n8n.mjs migrate [--n8n=PATH]   # run n8n's DB migrations from this machine
```

`apply` is idempotent: when nothing differs it says so and does not deploy. It writes the service
URL back to `N8N_BASE_URL` in the first env file that exists (`.env.local` at the repo root; never a new file).

### Why n8n has its own Supabase project

The first attempt put n8n's tables in a schema `n8n` inside DeskDev's app database, as a
restricted role. It never came up: the container sat at 0% CPU with no open port and no log line
until Render gave up.

For any schema other than `public`, n8n's TypeORM runs `CREATE SCHEMA IF NOT EXISTS` on every
boot. Postgres checks the database-level `CREATE` privilege **before** it checks whether the
schema exists, so a role without that privilege gets "permission denied" even when the schema is
already there. TypeORM then leaks the pooled client, and n8n waits on it forever.

Granting that role `CREATE` on the app database would fix the boot but let it create schemas
named after other roles (which `"$user"` in their search paths would pick up). So n8n got a
project of its own, where it connects as `postgres` and owns everything. Schema `n8n` rather than
`public`, because Supabase exposes `public` through the project's Data API and grants `anon` /
`authenticated` on new tables there by default.

A side benefit: n8n's execution history can never eat into the app database's 500 MB.

### Settings worth knowing

All set by `apply`; see `envVars()` in the script for the full list and the reasons.

- Successful executions are not stored (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`); DeskDev's
  `automation_runs` already records them. Failures are kept for 7 days.
- `NODE_OPTIONS=--max-old-space-size=350`: 512 MB has to hold three Node processes (n8n, task
  broker, JS runner). Above roughly 400 MB the kernel OOM-kills the container.
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` (the 2.x default, written down). Workflows never read
  `$env`, and `scripts/n8n.mjs check` fails CI if one does.
- `PORT=5678` alongside `N8N_PORT=5678`: Render routes to `$PORT`, n8n listens on `N8N_PORT`.
- **No Render health check.** Render allows only a few seconds, and a first boot spends minutes
  loading nodes and migrating, so Render would kill it mid-boot, in a loop that looks like an n8n
  crash. Liveness is the keep-alive's job.

## Env vars

All in `.env.local` at the repo root, the single env file (read through `scripts/lib/env.mjs`; the legacy
`web/.env.local` is still read as a fallback until it is moved). Catalogue: `.env.example`. Names only; never paste values into docs, chat or
commits.

| Name | Used by | What |
|---|---|---|
| `RENDER_API_KEY` (or `RENDER_API_TOKEN`) | render-n8n | Render → Account settings → API keys, on the nixgensolutions@gmail.com account |
| `N8N_ENCRYPTION_KEY` | render-n8n → service | Encrypts n8n's stored credentials. Changing it orphans every credential |
| `N8N_SUPABASE_REF` | render-n8n → service | `isinzodyagsbqevpeure`, the n8n project (not the app project) |
| `N8N_DB_PASSWORD` | render-n8n → service | That project's database password |
| `N8N_BASE_URL` | both scripts | Written by `apply` |
| `N8N_OWNER_EMAIL`, `N8N_OWNER_PASSWORD` | owner claim | The n8n owner login (nixgensolutions@gmail.com). A login: keep it in a password manager, not the env file |
| `N8N_API_KEY` | n8n.mjs | n8n → Settings → n8n API. Tied to the instance that issued it |
| `SUPABASE_SERVICE_ROLE_KEY`, `N8N_WEBHOOK_SECRET`, `ADZUNA_APP_KEY` | n8n.mjs, first push | Become the three credentials the repo owns |

What the service itself receives (set by `apply`, derived from the above): `PORT`, `N8N_PORT`,
`N8N_HOST`, `N8N_PROTOCOL`, `N8N_PROXY_HOPS`, `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`,
`GENERIC_TIMEZONE`, `TZ`, `N8N_ENCRYPTION_KEY`, `DB_TYPE`, `DB_POSTGRESDB_HOST`,
`DB_POSTGRESDB_PORT`, `DB_POSTGRESDB_DATABASE`, `DB_POSTGRESDB_USER`, `DB_POSTGRESDB_PASSWORD`,
`DB_POSTGRESDB_SCHEMA`, `DB_POSTGRESDB_POOL_SIZE`, `DB_POSTGRESDB_SSL_ENABLED`,
`DB_POSTGRESDB_SSL_CA`, `DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED`, `EXECUTIONS_DATA_*`,
`NODE_OPTIONS`, `N8N_BLOCK_ENV_ACCESS_IN_NODE`, `N8N_PUBLIC_API_DISABLED`, and the
`N8N_*_ENABLED` switches that turn off n8n.io telemetry, templates and banners.

## Boot and owner claim

A free-plan deploy takes about 2 minutes to go live and about 3.5 minutes until n8n logs
"Editor is now accessible". A cold wake after sleep takes 30 to 60 seconds.

**Claim the owner the moment a fresh instance answers.** An n8n with no owner shows a setup page,
and whoever submits it first owns the instance. So, right after the first `apply`:

1. Poll `<N8N_BASE_URL>/healthz` until it returns 200.
2. Open `<N8N_BASE_URL>/setup` (or `POST /rest/owner/setup`) and create the owner with
   `N8N_OWNER_EMAIL` / `N8N_OWNER_PASSWORD`. `GET /rest/settings` shows
   `userManagement.showSetupOnFirstLoad: false` once it is done.
3. Log in, Settings → n8n API → create a key, and store it as `N8N_API_KEY` in the root `.env.local`.
4. `node scripts/n8n.mjs push` (dry run) proves the key works.

The current instance was claimed for nixgensolutions@gmail.com on 2026-10-02 and has its API key.

Expected noise in a healthy boot log: "No open ports detected" while n8n loads, "Python 3 is
missing", a list of deprecations, and, on a cold start, one or two "Task runner connection
attempt failed: invalid or expired grant token" before "Registered runner JS Task Runner". If the
runner never registers, raise `N8N_RUNNERS_GRANT_TOKEN_TTL` in `envVars()` and `apply`.

## Upgrading n8n

1. Read n8n's release notes between the pinned version and the target.
2. Change `IMAGE` in `scripts/render-n8n.mjs`.
3. `node scripts/render-n8n.mjs migrate`: runs the new version's migrations from this machine
   against the n8n project (fetches that exact n8n version with `npx`, or pass `--n8n=path`). On
   512 MB the free instance can die partway through a migration, so it never does them itself.
4. `node scripts/render-n8n.mjs apply`, then `status` until the deploy is `live`.
5. `node scripts/n8n.mjs status` to confirm the workflows survived.

There is no downgrade: once migrated, the database refuses older versions.

## Keep-alive

Render stops a free web service after about 15 minutes without inbound traffic, and a stopped
n8n runs no schedules, so the morning digests would silently never fire.

- **pg_cron `n8n-keepalive`** in the app project (migration `028_n8n_base_url.sql`) calls
  `public.n8n_keepalive()` every 10 minutes, which GETs `<n8n_base_url()>/healthz`. The host comes
  from the Vault secret `n8n_base_url`, falling back to the constant in 028. To stop it:
  `SELECT cron.unschedule('n8n-keepalive');`.
- **Worker `nixgen-n8n-keepalive`** (`workers/n8n-keepalive`, optional): the same ping from
  Cloudflare every 10 minutes, with one retry to ride out a cold start. It keeps n8n awake even
  if the app's Supabase project is paused. Deploy with `npx wrangler deploy` from
  `workers/n8n-keepalive`; its target is `N8N_HEALTH_URL` in `wrangler.jsonc`.

A 200 from `/healthz` only means the process is up. Whether the automations ran is answered by
`automation_health` (DeskDev → Settings → Integrations), never by the keep-alive.

**Moving the host** (a new Render URL): `apply` updates `N8N_BASE_URL`; then update the Vault
secret in the app project (SQL editor, as postgres):
`SELECT vault.update_secret(id, 'https://<new host>') FROM vault.secrets WHERE name = 'n8n_base_url';`,
and `N8N_HEALTH_URL` in `workers/n8n-keepalive/wrangler.jsonc`.

## Logs

- Dashboard: Render → `nixgen-n8n` → Logs (and Events for deploys).
- API, with `RENDER_API_KEY` exported:

  ```bash
  curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
    "https://api.render.com/v1/logs?ownerId=tea-davb8fc9v7es73f4okk0&resource=srv-davbequgekts73ddg8lg&direction=backward&limit=100"
  ```

  Add `startTime` / `endTime` (ISO 8601) for a window. Deploy status:
  `GET https://api.render.com/v1/services/srv-davbequgekts73ddg8lg/deploys?limit=5`, or just
  `node scripts/render-n8n.mjs status`.
- n8n's own record of failed executions: n8n UI → Executions (kept 7 days).

## First rollout: the owner's manual steps

1. **Google OAuth client.** In Google Cloud (nixgensolutions@gmail.com), enable the Gmail API and
   the Google Sheets API, and create an OAuth client (Web application) with the authorized
   redirect URI `https://nixgen-n8n-8gp7.onrender.com/rest/oauth2-credential/callback`
   (in general, `<N8N_BASE_URL>/rest/oauth2-credential/callback`).
2. **Two credentials in the n8n UI**, logged in as the owner, named exactly:
   - `Gmail account` (Gmail OAuth2 API)
   - `Google Sheets account` (Google Sheets OAuth2 API); the Google account must be able to edit
     the **Deskdev Log Activities** sheet.

   Paste the client id and secret, click *Sign in with Google*, and accept the consent.
3. Optionally set a fresh `ADZUNA_APP_KEY` in the root `.env.local`; without it `push` skips
   `job-postings-finder`.
4. `node scripts/n8n.mjs push` (dry run), read the credentials table, then
   `node scripts/n8n.mjs push --apply`. It creates `Supabase — DeskDev` and
   `DeskDev Webhook Secret` from env, then the error handler, then every workflow, inactive.
5. `node scripts/n8n.mjs status`: every workflow should read *in sync*.
6. Switch the old instance's `[deskdev]` workflows off, then activate the new ones in the n8n UI.
   Activation is always a human click.
7. Run each scheduled workflow once by hand, and check DeskDev → Settings → Integrations for an
   *ok* row.
