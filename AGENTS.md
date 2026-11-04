# AGENTS.md

Rules for any agent (or person) working in this repo. Short on purpose; the
linked docs hold the detail. `site/AGENTS.md` adds the Next.js-specific rules
for `site/`.

## Never

- **Never `git clean -x` / `-fdx`**, and never delete ignored files you did not
  create. The secrets file and work in progress are ignored or untracked; a
  clean destroys them with no undo.
- **Never `supabase db push`** (or `db reset --linked`). The live project has no
  `schema_migrations` table; push would re-run every migration over live data.
  Apply files by hand in ledger order: `supabase/README.md`.
- **Never edit an applied migration.** Fix forward with the next number.
- **Never print, copy or commit env values.** Key names are fine. Agents are
  blocked from moving or rewriting `.env*` files; ask the owner.
- **Never give the site Worker the service-role key.** Anon reads go through
  column grants + RLS; privileged work goes through secret-gated RPCs
  (`intake_site_lead`, `intake_subscriber`) or Edge Functions.
- **Never deploy, set remote secrets or write to remote services** (Workers,
  Supabase, Render, n8n, Google) without the owner's explicit go-ahead. Before
  any production deploy: e2e video proof, then the 13-layer gate.
- Never rewrite git history or archive a folder without the owner.

## The env file

- **One secrets file: `.env.local` at the repo root.** `.env.example` next to
  it lists every name, grouped by consumer.
- Scripts load it through `scripts/lib/env.mjs` (`loadEnv()`), never by
  parsing a path themselves. Order, first file wins per key: `./.env.local`,
  then the legacy `web/.env.local` and `automation/.env.local` (with a warning).
  `DESKDEV_ENV_FILE` (or `N8N_ENV_FILE`) replaces the chain with one file.
- `writeEnvKey()` only edits a file that exists; nothing creates an env file.
- The site has its own two: `site/.env.local` (public `NEXT_PUBLIC_*` only) and
  `site/.dev.vars` (local Worker secrets). See `site/.env.example`.
- Until the owner moves `web/.env.local` to the root, the legacy fallbacks
  stay. After the move they are removed from `env.mjs` (plan Topic E4).

## Ports and processes

| What | Where |
|---|---|
| Site + DeskDev dev server | `cd site && npm run dev` → http://localhost:6969 (DeskDev at `/workspace`; split hosts at `workspace.localhost:6969`) |
| Playwright e2e | builds in local mode, previews on :4173 |

Other sessions often have dev servers running. Do not kill processes you did
not start; use your own port or config if you need a second server. On
Windows, deleting `node_modules` fails while a process holds a lock.

## Who owns what

| Folder | Governing doc | Notes |
|---|---|---|
| `site/` | `site/README.md`, `site/AGENTS.md` | one app: site at `/`, DeskDev SPA in `site/src/deskdev` |
| `site/src/deskdev/lib` | `docs/deskdev/FOUNDATION.md` | mirrored byte-for-byte in `mobile/src/lib`; `node scripts/check-shared-drift.mjs` must pass |
| `supabase/` | `supabase/README.md` | the migration ledger, Vault secrets, Edge Functions |
| `automation/` | `automation/README.md`, `RENDER.md` | n8n workflows as git JSON; `node scripts/n8n.mjs check` must pass |
| `workers/` | each `wrangler.jsonc` | the watchdog / keep-alive Worker |
| `scripts/` | header of each script | repo tooling; pure Node, no dependencies |
| `video/` | `video/SCENES.md` | Remotion VSL |
| `mobile/` | `mobile/README.md` | parked Expo app, still in CI |
| `docs/deskdev/` | | DeskDev contracts: FOUNDATION, FOUNDATION-THEME, DESIGN, LANGUAGE |

## Database rules (every new migration)

1. Next free number, a row in the `supabase/README.md` ledger, idempotent SQL.
2. Every new foreign key to `profiles` is `ON DELETE SET NULL`.
3. Every new function: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon`, then
   explicit grants; `SECURITY DEFINER` always with `SET search_path`.
4. Notifications pass 030's guard: in user-fired triggers `actor_id =
   auth.uid()` and a type on the allow-list (extended in 033).
5. RLS on every table, in the same file that creates it.
6. Test on a throwaway database (PGlite or `supabase start`), never the live one.
   `supabase/tests` applies every migration to PGlite and holds the database
   tests (the sign-up guard, row-level security): add yours there.

`node scripts/check-migrations.mjs` checks 1, 2, 3 and 5 (CI: `repo-ci.yml`).

## Code conventions

- DeskDev (`site/src/deskdev`): 2-space indent, no semicolons, single quotes.
  Zustand v5: a selector returning a new array or object needs `useShallow`,
  or it re-renders forever.
- Site (`site/src/app`, `site/src/components`, `site/src/lib`): follow the
  surrounding file (it uses semicolons).
- Repo scripts: ES modules, no dependencies, tests with `node:test`.
- Comments explain why, not what.
- Vitest only picks up `site/src/**/*.test.ts`. Deno is not installed locally:
  keep Edge Function logic in pure modules with tests that run under Vitest or
  Node.

## Checks before you hand work back

```bash
cd site && npx tsc --noEmit -p tsconfig.json && npm test
node scripts/check-migrations.mjs
node --test 'scripts/**/*.test.mjs'
(cd supabase/tests && npm ci && npm test)
node scripts/check-shared-drift.mjs
node scripts/n8n.mjs check
```

## Content

- Prices, stats, phone numbers and other user-visible marketing claims are
  the owner's call: do not change them.
- Site copy, auto-replies and emails never reveal where the team is located.
