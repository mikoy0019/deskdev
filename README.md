# DeskDev Studio

One repo for NixGen's public website and **DeskDev**, the team's
client-operations workspace (projects, tasks, clients, CRM tables, calendar,
meetings, EOD reports, Growth leads, showcase, courses, chat, channels,
vault, notifications), plus their Supabase backend, the n8n automations and
the VSL video.

> **Location:** keep this repo at `C:\Dev\deskdev-studio`, a path with no
> spaces or apostrophes. The Expo app's native Android build (CMake/ninja)
> fails from any path that has them.

Agents and new contributors: read [`AGENTS.md`](AGENTS.md) first (where the
env file lives, what never to run, who owns which folder).
How the pieces connect: [`docs/SYSTEM_MAP.md`](docs/SYSTEM_MAP.md).

## What's where

| Folder | What | Docs |
|---|---|---|
| `site/` | **One app:** the NixGen site at `/` and DeskDev at `/workspace` (or the root of `workspace.` in production). Next.js App Router, built with the OpenNext Cloudflare adapter → one Cloudflare Worker, `nixgen-site`. DeskDev is the SPA in `site/src/deskdev` (React 19, react-router, Tailwind 4, Zustand). | `site/README.md` |
| `supabase/` | Migrations (the ledger), Edge Functions, push and vault runbooks | `supabase/README.md` |
| `automation/` | n8n workflows (git JSON) and the Render host for n8n | `automation/README.md`, `automation/RENDER.md` |
| `workers/` | `n8n-keepalive`: cron Worker that keeps n8n awake and probes the stack | `workers/n8n-keepalive/wrangler.jsonc` |
| `scripts/` | repo tooling: `n8n.mjs`, `render-n8n.mjs`, `check-migrations.mjs`, `check-shared-drift.mjs`, `vault-recover.mjs`, `backup/` (encrypted database backups), and `lib/env.mjs` (the env loader) | headers of each script |
| `video/` | Remotion project for the homepage VSL | `video/SCENES.md` |
| `mobile/` | Expo SDK 56 app (parked; its `src/lib` mirrors `site/src/deskdev/lib`) | `mobile/README.md` |
| `docs/deskdev/` | DeskDev design + data-layer contracts: `FOUNDATION.md`, `FOUNDATION-THEME.md`, `DESIGN.md`, `LANGUAGE.md` | |
| `docs/runbooks/` | owner runbooks: operations (health, logs, rollback, alerts), backup and restore, auth settings, data requests, the DNS cutover | `OPERATIONS.md`, `BACKUP-RESTORE.md`, `AUTH.md`, `DATA-REQUESTS.md`, `DNS-CUTOVER.md` |
| `web/` | gitignored; only the legacy env file is left there until it moves (see below) | |

## Run it locally

```bash
cd site
cp .env.example .env.local        # optional: Supabase URL + anon key (see the file)
npm install --legacy-peer-deps
npm run dev
#   site:    http://localhost:6969
#   DeskDev: http://localhost:6969/workspace
#   split hosts, if NEXT_PUBLIC_SITE_URL/APP_URL are set: http://workspace.localhost:6969
```

With `NEXT_PUBLIC_SUPABASE_*` unset, DeskDev runs in **local mode**: data in
localStorage, demo accounts `admin@deskdev.local` / `admin` and
`member@deskdev.local` / `member`. Set them to use the live project
(`rgasjotvqwkjbeivlhvn`).

| From `site/` | |
|---|---|
| `npm test` | unit tests (Vitest, `src/**/*.test.ts`) |
| `npm run test:e2e` | Playwright, against a local-mode build on :4173 |
| `npm run typecheck` / `npm run lint` | |
| `npm run build` / `npm run deploy` | the Worker; deploying is an owner step (`site/README.md` → Deploy) |

From the repo root:

```bash
node scripts/check-migrations.mjs        # the migration ledger rules (CI: repo-ci.yml)
node --test 'scripts/**/*.test.mjs'      # repo tooling tests
node scripts/check-shared-drift.mjs      # site/src/deskdev/lib vs mobile/src/lib
node scripts/n8n.mjs check               # n8n workflow rules (offline)
```

Mobile (parked, still built by CI):

```bash
cd mobile && npm install
npx expo prebuild --platform android     # regenerates mobile/android (gitignored)
npx expo run:android
```

## Secrets: the one env file

Every tooling secret lives in **`.env.local` at the repo root** (gitignored).
[`.env.example`](.env.example) lists every name, grouped by what reads it.
`scripts/lib/env.mjs` loads it; until the owner moves the file, the loader
falls back to the legacy `web/.env.local` and `automation/.env.local` and
says so on stderr. `DESKDEV_ENV_FILE=<path>` points it anywhere else.

The site keeps its own two files: `site/.env.local` (public `NEXT_PUBLIC_*`
build values) and `site/.dev.vars` (the Worker's local secrets). See
[`site/.env.example`](site/.env.example). Production secrets live in the
platforms: Worker secrets, Supabase function secrets and Vault, n8n
credentials, Render env.

## Database changes

Never `supabase db push`. Migrations are applied by hand, one file at a time,
in ledger order: [`supabase/README.md`](supabase/README.md).

## Remotes

`origin` (`nixgensolutions-collab/deskdev-studio`) is canonical. The
`mikoy0019` remote is legacy and due to be retired.
