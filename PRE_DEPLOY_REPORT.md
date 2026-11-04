# Pre-Deploy Report — deskdev-studio

Date: 2026-10-08 (afternoon, Manila)
Commit: 020a715 (`master`: the merge of feat/revisions-2-10)
Gate: **BLOCKED** (layers 1, 4, 5, 7, 11, 12, 13: the same open lines as the 4b25595d deploy, none added by this change)
Deploy: on the owner's go-ahead of 2026-10-08 ("All the way": merge, migrations 054–060, gate, deploy), the same rule as the last three deploys: ship if the gate is blocked only on the known lines. Before it: version `4b25595d-8799-4c7d-8983-7b1f276152af`

What this deploy is, revisions 2–10 of the "DeskDev Revisions - Mikmik" list:
- **2:** tasks take collaborators besides the assignee; cards show the project and everyone on the task (migration 054).
- **3:** "Move to" on kanban cards is a themed menu, not the native select.
- **4:** the CRM sheet: drag or keyboard column widths, insert a column left or right, Person and Formula column types (057).
- **5:** a course topic can be a written note (055).
- **6:** a vault account for each admin: each admin unlocks with their own password; invite codes; access removed on demotion or deactivation (060).
- **7:** who is online, at the bottom of the right rail (056: presence on a private Realtime channel).
- **8:** Meeting Recordings, filed by client, project and category, played in DeskDev (058).
- **9:** Whiteboard, on Excalidraw 0.18 with self-hosted fonts; a save that would overwrite someone else's newer save asks first (059).
- **10:** the DeskDev Assistant: answers from the workspace's own data by rules (no paid AI service, nothing leaves DeskDev), and changes tasks or clients only after a Confirm.
- Also: the lint fixes that turned Site CI green again, and a popover-in-modal stacking fix found by PROVE (d9ca721).

**Database:** 054–060 were applied by hand before this gate (owner's go-ahead), one file at a time, each exit 0. Read-only probe before: none of their objects existed, 053 was live, `realtime.messages` and `realtime.topic()` present. Probe after:
- the 5 new tables have RLS, with 5–6 policies each;
- anon can call none of the new functions and read none of the new tables;
- the vault access functions are executable by signed-in accounts only (each checks admin at aal2);
- the presence policies `deskdev_presence_read` / `_track` exist;
- recordings are in the Realtime publication; whiteboards and vault slots are not, by design.

**A defect found on the way, kept out of GitHub:** the first push of the merge was refused by GitHub. Commit 0ae9c8c had also taken in `site/.cloudflare/`: 1,063 local build files from the old vinext setup, including a 1.78 GB trace database. With the owner's OK, the 14 unpushed commits were replayed without those files (same code, messages and dates; backups `backup/revisions-2-10-with-build-files`, `backup/master-merge-d34f059`), and the folder is ignored. The files held no secret value: the Worker config lists secret names only.

## PROVE

| Run | What | Result |
|---|---|---|
| `20261008-rev-160932` | full suite incl. the new `revisions.spec.ts` (8 flows), one host, local mode | 73/77 first pass, 77 videos. The 4 failures were page hangs with the PC at 80% CPU and 1.3 GB free |
| `-rerun` | chat, cube, cube-operations on the same build, one worker | 9/9, filmed |
| `-split` | DeskDev on `workspace.localhost` | 5/5, filmed |

Before that, the new spec caught a real bug: the collaborator picker opened under the task modal (popovers z-40, modals z-50). Fixed in d9ca721, passing after a rebuild. Report: `site/e2e-artifacts/20261008-rev-160932/E2E_REPORT.md`.

`pre-deploy-check.sh` was not run: it only resolves apps under `C:/Dev/Projects/Web App Projects/` (pre_deploy_validator, known limitation). All 13 layers were evaluated directly against `MainFrame/System/strategy/fullstack_app_sop.md`.

| # | Layer | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Frontend Foundations | FAIL | Typecheck 0 errors; ESLint 0 errors; production build; PROVE above. Excalidraw loads only on the whiteboard pages (its own chunks, fonts self-hosted). Open: mobile Lighthouse ~50 on the domain, under 90 |
| 2 | API & Backend Logic | PASS | vitest 1,729 passed; the 7 known load time-outs (`errorPages`, `errorReporting`) pass alone 10/10; scripts 117/117; shared drift 23/23; n8n check 14 workflows. The Assistant is pure rules (`lib/assistant.ts`, 13 tests) |
| 3 | Database & Storage | PASS | 61 migration files, `check-migrations` ok; 152/152 database tests on PGlite with every migration to 060 (`revisions.test.mjs`, RLS suite with the 5 new tables); 054–060 applied live and probed (above). Whiteboard scenes capped at 5 MB, notes at 100,000 characters, formulas at 2,000 |
| 4 | Auth & Permissions | FAIL | New tables follow the feature permissions (`has_perm('meetings', …)` for recordings); vault slots need aal2 (restrictive policy) and each admin reads only their own; removal through the admin-checked `vault_remove_access()`. Open (owner): Google connect redirect not confirmed for the domain |
| 5 | Hosting & Deployment | FAIL | Both custom domains attached; built from a clean export (below). Open (owner): push-to-deploy pipeline off; Adzuna key rotation |
| 6 | Cloud & Compute | PASS | Last 24 h: 1,911 requests, 1,900 success, 11 client disconnects, 0 `exceededResources` (median 9 ms). Excalidraw runs in the browser only, not in the Worker |
| 7 | CI/CD & Version Control | FAIL | CI on 020a715 green: Site CI (red on master before this merge), Repo CI, Mobile CI. Open (owner): `master` cannot be protected on the current GitHub plan |
| 8 | Security & Row-Level Security | PASS | RLS in the same file for all 5 new tables, `active_account_only` on each (58 reachable tables in the RLS suite); every new function revoked from PUBLIC/anon (trigger functions from authenticated too), SECURITY DEFINER with pinned `search_path`; presence limited to active accounts on one private topic. The shipped build carries no secret (below) |
| 9 | Rate Limiting | PASS | Unchanged: database throttles on the forms, the Worker limiter on public POSTs. The new surfaces are signed-in only, behind RLS |
| 10 | Caching & CDN | PASS | Unchanged rules; DeskDev and `/api/health` `no-store`; Excalidraw fonts are static files under `/workspace/excalidraw/` |
| 11 | Load Balancing & Scaling | FAIL | Unchanged. Open: load test, connection alarm |
| 12 | Error Tracking & Logs | FAIL | Unchanged. Open: no alert on an error spike |
| 13 | Availability & Scalability | FAIL | Unchanged. Open: outside health watch, backups, restore and rollback drills |

Layers 1 and 8 were evaluated in full; neither is N/A. Layer 1 fails, and under the gate's rule a Layer 1 failure blocks the deploy.

### Build values check (the build that ships, from the clean export `C:\nxb\020a715`)

- Built with exactly five values: the public Supabase pair, the VAPID public key, `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL`. The export holds no env file.
- `next-env.mjs` exports empty objects.
- 23 non-public values from the env files checked against 2,186 built files. The only matches are public by design:
  - the Supabase URL and anon key (the legacy `VITE_*` copies equal the public pair);
  - the VAPID public key;
  - the company email, already in 10 committed site files, and its `mailto:` as the VAPID subject.
- The same scan finds the service-role key, the Cloudflare token and the n8n secrets in a build made inside D:, which shows it can find them.
- The workspace origin is in 31 files. The rewrite `/workspace/:path(.*)` is in 8 files, the old `/workspace/:path` in none. No `localhost:4173`.
- The 25 Excalidraw font files are in the assets.

## After the deploy (2026-10-08, 17:10 Manila)

What went out, in order:
1. **Push:** `master` 020a715 to GitHub (the merge plus 14 commits). CI green: Site, Repo, Mobile. "Site deploy" skipped (switched off).
2. **Migrations 054–060**, applied with `supabase db query --linked -f`, one file at a time, and probed (above).
3. **Deploy:** `opennextjs-cloudflare deploy` of the clean build of 020a715, from `C:\nxb\020a715`. Version `58c2cda5-1b5a-468d-a4b2-1da8512ca692`, 2,934 KiB gzip. No `routes` in `wrangler.jsonc`, so both custom domains stay.

| Check | Result |
|---|---|
| `/api/health?deep=1` on both hosts | 200, version `58c2cda5…`, database ok |
| https://workspace.nixgensolutions.com | `/`, `/tasks`, `/recordings`, `/whiteboard`, `/assistant`, `/crm`, `/courses`, `/vault`, `/login` → 200; HSTS `includeSubDomains`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `no-store` |
| https://nixgensolutions.com | `/`, `/services`, `/templates` → 200; `/workspace/recordings?new=1` and `/workspace/whiteboard` → 307 to the subdomain, path and query intact |
| Excalidraw fonts | served at `/workspace/excalidraw/…` on both hosts (`font/woff2`), the path `assetUrl` gives the editor |
| The new tables and functions with the anon key | `recording_folders`, `meeting_recordings`, `whiteboard_folders`, `whiteboards`, `vault_key_slots`, `tasks.collaborator_ids`, and the RPCs `vault_access_list`, `vault_my_access`, `vault_remove_access`: all 401 (`42501`) |
| Live sign-in path, filmed (`site/e2e-artifacts/20261008-rev-live/`) | Team login, an email link signed out and an old `/workspace` link all reach the sign-in with state; no page or console errors; only the two hosts and Cloudflare's analytics contacted |

A side note on that video: the live-check helper built its folder from a URL path, so the spaces in the repo path became `%20`. It wrote this video and the one from the 4b25595d deploy into a stray `D:\Development\Nixgen%20Solutions%20Development\…` tree. Both videos were moved into `site/e2e-artifacts/` (`20261008-live/`, `20261008-rev-live/`), the stray tree removed, and the helper fixed (`fileURLToPath`).

Not checked live, and why:
- The new screens with a signed-in account: they are proven in local mode (PROVE), and the database side is proven above.
- Presence (056) between two signed-in people: it needs two live sessions. First thing to look at when the team signs in: the right rail's "N active now".
- Vault accounts (060) in the browser: they need an admin with MFA. The database tests cover them.

## The previous report (deploy 4b25595d, 2026-10-08 09:07)

Date: 2026-10-08 (08:30–09:10 Manila)
Commit: 215f5ef (`master`: the merge of merge-site-web 9d2bf6a, the project stage rule 451280f, spec fixes)
Gate: **BLOCKED** (layers 1, 4, 5, 7, 11, 12, 13: the same open lines as the 6397770e deploy, none added by this change)
Deploy: on the owner's go-ahead of 2026-10-08 ("merge and deploy all the changes of deskdev"; ship if the gate is blocked only on the known lines, stop on anything new). Before it: version `6397770e-61a1-40b1-ad12-7af69f3825bd`

What this deploy is:
- **Cube:** the decision inbox (00a415a); department operations backed by the database (migration 053); the Workflow Studio, ad opportunities and reference pages.
- **Hardening from 2026-10-06:**
  - confirmed saves (a refused message leaves the thread, your own profile save waits for the database);
  - form checks for clients, projects and tasks;
  - message drafts that survive a reload;
  - deactivated accounts locked out of chats and channels.
- **Revision item 1:** a project is Done exactly when it launches (451280f).
- **Not in it, on the owner's choice:**
  - the branch's data-URL profile pictures (master's live 052 pictures stay; backup branch `backup/merge-site-web-wip-2026-10-08`);
  - the "Portfolio Library" redesign of /templates (parked on `wip/portfolio-library`).
- **Database:** migration 053 is applied by hand before the deploy, after the gate. It adds:
  - five admin-only tables (RLS, restrictive `active_account_only`);
  - admin-checked SECURITY DEFINER functions;
  - a pg_cron job, `cube-operations`, that runs `cube_tick()` every minute.

  Live probe before it, read-only: no `cube_*` objects, pg_cron installed, every existing job owned by `postgres` (the CLI's session user).

## A defect found by the gate, kept out of the deploy

The first production build ran in the D: checkout. That checkout became the only one today: the C: worktrees were removed on the owner's instruction. The build carried every value of `site/.env.local` in `.open-next/cloudflare/next-env.mjs`, including:
- the service-role key;
- the Cloudflare API token;
- the n8n and Google secrets.

Why: `@opennextjs/cloudflare` always compiles `.env`, `.env.production`, `.env.local` and `.env.production.local` into the Worker (`compile-env-files.js`, `extract-project-env-vars.js`). There is no switch.

How this deploy avoids it:
- The leaky build was deleted, never deployed.
- The shipped build comes from `git archive` of 215f5ef in a scratch folder with no env files. Only the three public values plus the two hosts are passed in.
- Its `next-env.mjs` exports empty objects.
- Every non-public value of both env files (18 checked) is absent from its 2,083 files. The only matches are values that are public by design: the company email (in 10 committed site files), the VAPID public key and its `mailto:` subject.

Earlier live builds (3fad0c6f, 6397770e) were built in the C: master worktree, which had no env files.

**Open:** every production build from D: must come from a clean export until a build-time guard exists (layer 8 note).

## PROVE

| Run | What | Result |
|---|---|---|
| `20261008-merge-083004` | full suite, one host, local mode | 64/66, 66 videos. The 2 failures were spec defects (a `getByLabel` that never matched, and failed the same on master in `20261008-item1-052702`; a bare `getByRole('alert')` that also hits Next's route announcer). Fixed in 215f5ef |
| `-rerun2` | cube, cube-operations, project-stage on the same build, one worker | 11/11, filmed |
| `20261008-merge-split` | DeskDev on `workspace.localhost` | 5/5, 5 videos |

Report: `site/e2e-artifacts/20261008-merge-083004/E2E_REPORT.md`.

`pre-deploy-check.sh` was not run: it only resolves apps under `C:/Dev/Projects/Web App Projects/` (pre_deploy_validator, known limitation). All 13 layers were evaluated directly against `MainFrame/System/strategy/fullstack_app_sop.md`.

| # | Layer | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Frontend Foundations | FAIL | Typecheck 0 errors; production build; PROVE above. Open: mobile Lighthouse ~50 on the domain, under 90 |
| 2 | API & Backend Logic | PASS | vitest 1,697 passed, 4 skipped, none failed (123 files); scripts 117/117; check-migrations, shared drift (23 files, now incl. entityValidation), n8n check |
| 3 | Database & Storage | PASS | 54 migration files, ledger ok; 139/139 database tests on PGlite with every migration to 053, incl. `cube-operations.test.mjs` (re-applied twice, grants, admin-only reads) |
| 4 | Auth & Permissions | FAIL | Cube writes only through admin-checked SECURITY DEFINER functions; members see no Cube queue (e2e + RLS tests). Open (owner): Google connect redirect not confirmed for the domain |
| 5 | Hosting & Deployment | FAIL | Both custom domains attached; live `?deep=1` 200 on 6397770e, database ok. Open (owner): push-to-deploy pipeline off; Adzuna key rotation |
| 6 | Cloud & Compute | PASS | Last 24 h: 2,182 requests, 2,176 success, 6 client disconnects, 0 `exceededResources` (median 7.2 ms). Cube adds one database job a minute, no Worker load |
| 7 | CI/CD & Version Control | FAIL | CI on every change. Open (owner): `master` cannot be protected on the current GitHub plan |
| 8 | Security & Row-Level Security | PASS | RLS on the 5 new tables in the same file; 53 tables reachable by a signed-in account all carry `active_account_only` (rls test); functions revoked from PUBLIC/anon with pinned `search_path`. The shipped build carries no secret (section above). Note: the build-from-D: hazard is open until guarded |
| 9 | Rate Limiting | PASS | Unchanged: database throttles on the forms, the Worker limiter on public POSTs |
| 10 | Caching & CDN | PASS | Unchanged rules; DeskDev and `/api/health` `no-store` |
| 11 | Load Balancing & Scaling | FAIL | Unchanged. Open: load test, connection alarm |
| 12 | Error Tracking & Logs | FAIL | Unchanged. Open: no alert on an error spike. Cube failures surface only as `cube_control.last_error` on the board |
| 13 | Availability & Scalability | FAIL | Unchanged. Open: outside health watch, backups, restore and rollback drills |

Layers 1 and 8 were evaluated in full; neither is N/A. Layer 1 fails, and under the gate's rule a Layer 1 failure blocks the deploy.

### Build values check (the build that ships, from the clean export)

- No secret value in any of the 2,083 files; `next-env.mjs` is empty.
- The workspace origin appears in 31 files.
- The rewrite `/workspace/:path(.*)` is in 8 files; the old `/workspace/:path` is in none.
- `workers.dev` appears in 2 files (OpenNext's skew-protection template, not switched on).
- No `localhost:4173`.

## After the deploy (2026-10-08, 09:07 Manila)

What went out, in order:
1. **Push:** `master` c87b3d6 to GitHub (10 commits). "Site deploy" is switched off (no `SITE_DEPLOY_ENABLED`).
2. **Migration 053**, applied with `supabase db query --linked -f`. It scheduled cron job 12, `cube-operations`, every minute, as `postgres`.
3. **Deploy:** `opennextjs-cloudflare deploy` of the clean build of 215f5ef. Version `4b25595d-8799-4c7d-8983-7b1f276152af`.

The build: an export in `C:
xbf5ef`, built and scanned there.
- The scratchpad path was too long for workerd's SQLite (`SQLITE_CANTOPEN` while filling the cache), and `subst` did not help.
- No `routes` in `wrangler.jsonc`, so both custom domains stay.

| Check | Result |
|---|---|
| `/api/health?deep=1` on both hosts | 200, version `4b25595d…`, database ok |
| https://workspace.nixgensolutions.com | `/`, `/cube`, `/projects/123`, `/login` → 200; HSTS `includeSubDomains`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `no-store` |
| https://nixgensolutions.com | `/`, `/templates`, `/services` → 200; `/workspace/cube?x=1` and `/workspace/tasks` → 307 to the subdomain, path and query intact |
| Live sign-in path, filmed (`site/e2e-artifacts/20261008-merge-live/`) | Team login, an email link signed out and an old `/workspace` link all reach the sign-in with state; no page or console errors; only the two hosts and Cloudflare's analytics contacted |
| 053 on the live database | 5 tables with RLS, 10 policies, 4 functions. The first ticks succeeded (`last_error` null) and opened 6 items: leadership 3, client ops 1, finance 1, people 1 |
| Cube API with the anon key | `cube_run`, `cube_tick` and `cube_work_items` all 401 (`42501`) |

Not checked live: the Cube screens with a signed-in admin. They are proven in local mode (PROVE), and the database side is proven above.

## The previous report (deploy 6397770e, 2026-10-08 04:32)

Date: 2026-10-08 (03:00–04:30 Manila)
Commit: 0decf03 (`master`) + the workspace-host rewrite fix (`site/next.config.ts`, `site/src/lib/nextConfig.test.ts`)
Gate: **BLOCKED** (layers 1, 4, 5, 7, 11, 12, 13: the same open lines as the 3fad0c6f deploy, none added by this change)
Deploy: only on the owner's explicit go-ahead with the gate blocked, as on 2026-10-05 and 2026-10-08 00:42. Before it: version `3fad0c6f-e64b-45f2-8ddd-a2eea60f1334`

What this deploy is: DeskDev moves to its own host, `https://workspace.nixgensolutions.com`.
- **On Cloudflare:** the subdomain was attached to the `nixgen-site` Worker as a custom domain on 2026-10-08 (API, owner's go-ahead). DNS and TLS are live; until this deploy it serves the site.
- **Build values:** `NEXT_PUBLIC_SITE_URL=https://nixgensolutions.com` and, new, `NEXT_PUBLIC_APP_URL=https://workspace.nixgensolutions.com`.
- **What the build then does:**
  - every page on the subdomain is DeskDev at its root;
  - the site's `/workspace/*` answers 307 to the subdomain, path and query intact;
  - the Team login, the session handoff (`/auth/callback`) and the reset-password link point at the subdomain.
- **Already pointing there:** the n8n email links (`/tasks`, `/growth/leads?lead=…`) and the watchdog's `WORKSPACE_URL`. Their links work only after this deploy.
- **Supabase Auth:** the owner set the Site URL and the redirect URLs for the subdomain (reported done 2026-10-08).

### The defect PROVE caught, fixed before the deploy

The first filmed run of the split (`20261008-split-032319`, on 0decf03 as committed) found:
- **HTTP 500 on DeskDev's host** for the root `/` and for every nested path (`/growth/leads`, `/projects/123`);
- single segments such as `/tasks` worked.

Cause and fix:
- OpenNext compiles a rewrite destination with `path-to-regexp` 6 and validation on. The destination `/workspace/:path` only takes one segment and rejects an empty one.
- Shipped as it was, `https://workspace.nixgensolutions.com/` itself, every project page reload and the lead-nudge email links would have answered 500.
- Fix: `destination: "/workspace/:path(.*)"`.
- A unit test now matches and compiles the rule the way the Worker does. It fails on the old rule with the Worker's error.
- The re-run `20261008-split-033854` passed 5 of 5.

### PROVE

| Run | What | Result |
|---|---|---|
| `20261008-025641` | full suite, one host, local mode (the fix is not reachable without a workspace host: `rewrites()` returns nothing) | 52/56 first pass, 54 videos. The 4 failures were time-outs: CPU at 100% and 0.5 GB of RAM free. The re-runs `-rerun` (3 of 4) and `-rerun2` (the last 2, one worker) pass on the same build, filmed. Report: `site/e2e-artifacts/20261008-025641/E2E_REPORT.md` |
| `20261008-split-033854` | the split, with `workspace.localhost` standing in for the subdomain | 5/5, 5 videos. Report: `site/e2e-artifacts/20261008-split-033854/E2E_REPORT.md` |

`pre-deploy-check.sh` was not run: it only resolves apps under `C:/Dev/Projects/Web App Projects/` (pre_deploy_validator, known limitation). All 13 layers were evaluated directly against `MainFrame/System/strategy/fullstack_app_sop.md`.

| # | Layer | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Frontend Foundations | FAIL | Typecheck 0 errors, production build, e2e above. Open: mobile Lighthouse ~50 on the domain (3fad0c6f), under 90 |
| 2 | API & Backend Logic | PASS | vitest: 1,645 passed, 4 skipped. The 8 that failed are time-outs on this loaded PC and pass alone with a longer limit: the error-page tests (own 30 s limit, ~60 s import) and a vault-crypto case. Includes the new rewrite test; 23/23 host, proxy and config tests. Scripts 117/117 |
| 3 | Database & Storage | PASS | 53 migration files, `check-migrations` ok; 124/124 database tests (PGlite); no database change in this deploy |
| 4 | Auth & Permissions | FAIL | Auth Site URL and redirects for the subdomain set by the owner (not readable from here). The Edge Functions `admin-users`, `vault-reset` and `google` answer the preflight from `https://workspace.nixgensolutions.com` with that origin. Open (owner): Google connect redirect (`GOOGLE_REDIRECT_BASE`, OAuth redirect URI) not confirmed for the domain |
| 5 | Hosting & Deployment | FAIL | `workspace.nixgensolutions.com` attached to `nixgen-site` (Cloudflare lists both custom domains); DNS answers from the zone's name servers and 1.1.1.1; TLS valid. Open (owner): push-to-deploy pipeline off; Adzuna key rotation |
| 6 | Cloud & Compute | PASS | Last 24 h: 1,801 requests, 1,796 success, 5 client disconnects, 0 `exceededResources` (median 6.9 ms) |
| 7 | CI/CD & Version Control | FAIL | CI on every change. Open (owner): `master` cannot be protected on the current GitHub plan |
| 8 | Security & Row-Level Security | PASS | 124 database tests (RLS per table and role). The subdomain already sends HSTS (`includeSubDomains`), `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Built files checked below |
| 9 | Rate Limiting | PASS | Unchanged: database throttles on the forms, the Worker limiter on public POSTs; tests pass |
| 10 | Caching & CDN | PASS | Unchanged rules; `/workspace` and `/api/health` `no-store` |
| 11 | Load Balancing & Scaling | FAIL | Unchanged. Open: load test, connection alarm |
| 12 | Error Tracking & Logs | FAIL | Unchanged. Open: no alert on an error spike |
| 13 | Availability & Scalability | FAIL | Unchanged. Open: outside health watch, backups, restore and rollback drills |

Layers 1 and 8 were evaluated in full; neither is N/A. Layer 1 fails, and under the gate's rule a Layer 1 failure blocks the deploy.

### Build values check (the production build that shipped)

- The service-role key appears in none of the 2,082 built files.
- The rewrite destination `/workspace/:path(.*)` is baked in, and the old `/workspace/:path` appears nowhere.
- The workspace origin appears in 31 files.
- `workers.dev` appears only in OpenNext's skew-protection template, which is not switched on.
- The public Supabase pair and VAPID key come from the same file as the live build.

Before the deploy, the same build was served locally and tested with the real Host headers:
- **The subdomain:** `/`, `/tasks`, `/growth/leads?lead=…`, `/projects/123`, `/login`, `/reset-password`, `/auth/callback` all return 200 and DeskDev.
- **The domain:** the site pages are 200, and every `/workspace/…` answers 307 to the subdomain with path and query intact.

### After the deploy (2026-10-08, 04:32 Manila)

What went out and how:
- **Commit:** `master` db6b263, pushed first. GitHub "Site deploy" skipped (switched off); no automatic Cloudflare deploy followed in the 6 minutes watched.
- **Deploy:** `opennextjs-cloudflare deploy` of the build checked above, version `6397770e-61a1-40b1-ad12-7af69f3825bd`.
- **Routes:** with no `routes` in `wrangler.jsonc`, Wrangler touches no custom domain, so both attached domains stay.

| Check | Result |
|---|---|
| `/api/health` on both hosts, `?deep=1` | 200, version `6397770e…`, database ok |
| https://workspace.nixgensolutions.com | `/`, `/tasks`, `/growth/leads?lead=…`, `/projects/123`, `/login`, `/reset-password` → 200, DeskDev; `/workspace/sw.js` served |
| https://nixgensolutions.com | `/`, `/services`, `/login`, `/robots.txt` → 200; `/workspace`, `/workspace/tasks?from=email`, `/workspace/growth/leads?lead=…` → 307 to the subdomain, path and query intact; Team login is `https://workspace.nixgensolutions.com/login` |
| Headers on both hosts | HSTS `includeSubDomains`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, nosniff, referrer and permissions policies; DeskDev pages `no-store` |
| Live sign-in path, filmed (`site/e2e-artifacts/20261008-live/`) | Team login → DeskDev → `nixgensolutions.com/login?state=…` with the form; an email link signed out → sign-in carrying `next=/growth/leads?lead=…`; an old `/workspace/tasks` link → the same. No page or console errors; only the two hosts (and Cloudflare's analytics) contacted |

After this deploy:
- Sessions and installed apps from `nixgensolutions.com/workspace` do not carry over: people sign in once on the subdomain and reinstall the app.
- Google connect still waits on its redirect settings (layer 4).
- `www.nixgensolutions.com` still has no DNS record (`docs/runbooks/DNS-CUTOVER.md` step 5.3).

## The previous report (deploy 3fad0c6f, 2026-10-08 00:42)

Date: 2026-10-07, re-run 2026-10-08
Commit: 6d228e5 (`master`: the integration branch, the custom-domain login fix, the mobile menu fix and the home page performance work)
Gate: **BLOCKED** (layers 1, 4, 5, 7, 11, 12, 13)
Deploy: goes out with the gate blocked, on the owner's instruction of 2026-10-08 ("Ship now, measure live": deploy, then measure the domain on PageSpeed Insights), as on 2026-10-05. Before it: version `e1032d0a-63bd-4c89-8bfc-4c0e732eb737` on https://nixgensolutions.com (apex attached) and the workers.dev address

What this deploy is: the same app that is live, rebuilt from `master` with the
domain's build values (`NEXT_PUBLIC_SITE_URL=https://nixgensolutions.com`,
`NEXT_PUBLIC_APP_URL` unset). It carries the fix for "signing in on nixgensolutions.com
lands on workers.dev". It also stops the domain being served `noindex` and moves the
canonical, `og:url` and form links from the workers.dev address to the domain. Since the
first run of this report it also carries:
- the mobile menu fix (29b8a50): the menu fits a phone, and links scroll below the bar,
  never under it;
- the home page performance work (6d228e5): stylesheet 315 → 130 KB, headline visible on
  first paint, no layout of the sections below the hero until they near the screen, no
  link prefetch.

`pre-deploy-check.sh` was not run: it only resolves apps under `C:/Dev/Projects/Web App
Projects/` (pre_deploy_validator, known limitation). All 13 layers were evaluated directly
against `MainFrame/System/strategy/fullstack_app_sop.md`. Each layer was re-checked against the
2026-10-05 report: its open lines were re-measured, and its met lines were re-run where a
command or a live probe exists.

PROVE stage before this gate: run `20261008-002018` on 6d228e5, **PASS**, 56 of 56 flows,
56 videos, no page or console error on the route smokes
(`site/e2e-artifacts/20261008-002018/E2E_REPORT.md`; the first run, `20261007-033146` on
0fecadc, passed the same 56).

| # | Layer | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Frontend Foundations | FAIL | Build and typecheck clean, accessibility 100, 56/56 e2e flows. Open: Lighthouse performance on the live domain was 44 on mobile and 83 on desktop before this deploy, under the required 90. The performance work did not reach 90 in local runs (see "Layer 1") |
| 2 | API & Backend Logic | PASS | vitest 1645 passed (route, guard and limiter tests included); 7 known timeouts under full-suite load pass 10/10 alone |
| 3 | Database & Storage | PASS | 53 migration files in the ledger, `check-migrations` ok; 043–052 applied to the live project (22a3e8a) |
| 4 | Auth & Permissions | FAIL | Server-side checks, sign-up guard and active-account policies are tested (124 database tests). Open (owner): Supabase Auth Site URL and redirect URLs for the domain are a dashboard setting no agent can read here |
| 5 | Hosting & Deployment | FAIL | Custom domain now attached with valid TLS (Google Trust Services, `nixgensolutions.com` + `*.nixgensolutions.com`, until 2027-01-04). Open (owner): push-to-deploy pipeline still off; the Adzuna key in git history not confirmed rotated |
| 6 | Cloud & Compute | PASS | Last 24 h on Cloudflare: 2,708 successful requests, 0 `exceededResources` (median 9.4 ms); 5 routes complete 3 of 3 times on the domain |
| 7 | CI/CD & Version Control | FAIL | CI builds, typechecks, lints and tests every change. Open (owner): `master` cannot be protected on the current GitHub plan (API answers 403) |
| 8 | Security & Row-Level Security | PASS | 124 database tests (RLS per table, per role) pass; tree scan finds only test fixtures and documented examples; the service-role key is in none of the 2,083 built files; HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'` on the live domain |
| 9 | Rate Limiting | PASS | Unchanged since 10-05: database throttles on the forms, the Worker limiter on public POSTs, `Retry-After` on 429; tests pass |
| 10 | Caching & CDN | PASS | Live: `/_next/static/*` `immutable`, one year, `CF-Cache-Status: HIT`; pages `s-maxage` with stale-while-revalidate; `/workspace` and `/api/health` `no-store` |
| 11 | Load Balancing & Scaling | FAIL | Stateless Worker, database over HTTPS only. Open: load test not yet run on the domain; no connection alarm |
| 12 | Error Tracking & Logs | FAIL | Errors captured front and back with request ids. Open: no alert on an error spike (the watchdog Worker and the ops-alert workflow are not switched on) |
| 13 | Availability & Scalability | FAIL | `/api/health` and `?deep=1` answer (database ok). Open: nothing outside watches it, nightly backups off, no restore drill, rollback not drilled (versions to drill with now exist) |

Layers 1 and 8 were evaluated in full; neither is N/A. Layer 1 fails, and under the gate's rule
a Layer 1 failure blocks the deploy without exception.

### What changed since the 2026-10-05 report

- **Closed:** Layer 6. The pages now render inside the plan's limits: no request stopped in
  the last day.
- **Closed:** the custom-domain line of Layer 5.
- **Measured for the first time on a deployed address:** Layer 1 performance. Edge
  compression did not lift it to 90.
- **Still open, unchanged:**
  - Layer 4: Auth redirect URLs.
  - Layer 5: automatic deploys, the Adzuna key.
  - Layer 7: branch protection.
  - Layers 11–13: load test, alarms, backups, drills.
- **Deploys since the last report:** two on 2026-10-06 (versions `698bd81a…`, `f06ec5de…`) and
  one secret change (`e1032d0a…`), none with a new gate report.

### Layer 1 — the performance line

Lighthouse 13 against https://nixgensolutions.com/ (one run each, live version `e1032d0a`):

| | Performance | Accessibility | LCP | TBT | CLS | FCP |
|---|---|---|---|---|---|---|
| Mobile | 44 | 100 | 6.4 s | 890 ms | 0 | 3.3 s |
| Desktop | 83 | 100 | 2.2 s | 30 ms | 0 | 1.0 s |

What holds it back on mobile is main-thread time (TBT 890 ms) and a late largest paint.

### The performance work (6d228e5) and what is left

Measured on the built Worker locally, behind a brotli proxy that stands in for the edge's
compression (Lighthouse 13, mobile). This PC was busy during the runs, and Lighthouse's own CPU
benchmark ranged from 1,324 to 2,518 between them, so the scores are noisy:

| Build | Runs | Median performance | LCP | TBT |
|---|---|---|---|---|
| Before (live code) | 3 | 59 | 4.8–6.0 s | 440–760 ms |
| CSS halved, headline visible on first paint | 3 | 60 | 5.1–5.9 s | 460–500 ms |
| + `content-visibility` below the hero | 3 | 56 | 5.1–5.6 s | 460–1,340 ms |
| + no link prefetch | 5 | 55 | 4.8–6.2 s | 680–2,090 ms |

What changed underneath, measured more steadily:
- Site stylesheet 315 → 130 KB.
- The largest paint now happens at first paint (it waited for the headline's entrance before).
- Layout during load 600 → 337 ms and style 522 → 196 ms (4x throttled trace).
- First-load requests 65 → 47; 13 page prefetches (70 KB) gone.

What keeps the score down: Lighthouse's mobile simulation counts every byte requested before
the largest paint, and the page still requests about 265 KB of JavaScript before it. That is
React (68 KB), the Next.js runtime, framer-motion (about 50–60 KB, behind the site's motion kit)
and the page's own components. The phone also hydrates a page of about 1,700 elements. Reaching
90 means rewriting the motion kit without framer-motion (CSS and IntersectionObserver) and trimming
what phones load (the desktop hero wall's markup, the video player until it is played). The owner
chose to ship this work first and decide on that rewrite from a PageSpeed Insights measurement
of the deployed domain.

### Build values check (the local production build, `6d228e5-muybngsr`)

The service-role key appears in none of the 2,082 built files.

- No `workers.dev` string anywhere in `.open-next`.
- `APP_URL` is `WORKSPACE_ORIGIN ?? "/workspace"`.
- The site origin is `https://nixgensolutions.com`, and the home page's canonical is
  `https://nixgensolutions.com`.
- `noindex` only on `/login` and the 404 page, both by design.
- The Supabase URL, anon key and VAPID key are the same values the live build carries (compared
  without printing them).

### After the deploy (2026-10-08, 00:42 Manila)

- **What went out:** `master` 3124471 (pushed first; CI green: Site, Repo, Automation, Mobile;
  Site deploy skipped while switched off). No automatic Cloudflare deploy followed the push in
  the 9 minutes watched. Deployed with `opennextjs-cloudflare deploy`: version
  `3fad0c6f-e64b-45f2-8ddd-a2eea60f1334`. With no `routes` in `wrangler.jsonc`, Wrangler touches
  no route or custom domain, so the dashboard-attached `nixgensolutions.com` stayed; workers.dev
  stays on.

| Check on https://nixgensolutions.com | Result |
|---|---|
| `/api/health`, `?deep=1` | 200, version `3fad0c6f…`, database ok |
| Search engines | no `X-Robots-Tag` on pages; `robots.txt` allows crawling, keeps `/workspace`, `/api`, `/f/` out, names `https://nixgensolutions.com/sitemap.xml`; canonical `https://nixgensolutions.com` |
| Sign-in | `/login`, `/workspace` and the header's Team login each go `…/workspace/login` → `…/login?state=…` on the domain, form shown, no request to workers.dev; Team login link is `/workspace/login`; the session handoff is the relative `/workspace/auth/callback` |
| Mobile menu | fits 390×664 and 360×740 without scrolling; no page errors |
| Pages | `/`, `/portfolio`, `/services`, `/about`, `/contact`, `/workspace/login` complete 2 of 2 times |
| Worker | 52 requests in the first 20 minutes, all successful, none stopped for resources |

Performance on the domain, Lighthouse 13 from this PC. PageSpeed Insights' keyless API was over
its daily quota. The PC ran at about half the speed of the baseline run (CPU benchmark 855–1,041
against 2,140), which inflates TBT:

| | Before (e1032d0a) | After (3fad0c6f) |
|---|---|---|
| Mobile performance | 44 | 50 (median of 3: 48, 50, 55) |
| Mobile LCP | 6.4 s | 3.9–4.7 s |
| Desktop performance | 83 | 86 |
| Desktop LCP | 2.2 s | 1.3 s |
| Accessibility | 100 | 100 |

Layer 1 stays open: mobile performance is under 90. A PageSpeed Insights run in the browser
(pagespeed.web.dev) gives the number on Google's hardware.

### Open lines, and who closes them

| Layer | Line | Who | How |
|---|---|---|---|
| 1 | Performance ≥ 90 on the landing page | Claude (owner decides) | Measure the deployed domain on PageSpeed Insights; if still under 90, rewrite the motion kit without framer-motion and trim what phones load |
| 4 | Auth Site URL `https://nixgensolutions.com/workspace`, redirect URL `https://nixgensolutions.com/workspace/**` | Owner | Supabase → Authentication → URL Configuration (`docs/runbooks/AUTH.md` §2) |
| 4 | Google connect from the domain | Owner | `GOOGLE_REDIRECT_BASE` → `https://nixgensolutions.com/api/google`, Google OAuth redirect URI `https://nixgensolutions.com/api/google/callback` |
| 5 | Automatic deploys; Adzuna key rotation | Owner | `docs/runbooks/DNS-CUTOVER.md` → Deploy pipeline; Adzuna dashboard |
| 7 | Protect `master` | Owner | GitHub paid plan or a public repo |
| 11 | Load test on the domain | Claude | `docs/runbooks/OPERATIONS.md` §5 against `https://nixgensolutions.com` |
| 11, 12, 13 | Alarms and an outside health watch | Claude + owner | Deploy the watchdog (`workers/n8n-keepalive`, settings to the domain) and switch on `[deskdev] ops-alert` |
| 13 | Backups, restore drill, rollback drill | Owner / Claude | `docs/runbooks/BACKUP-RESTORE.md`; rollback drill per `OPERATIONS.md` §4 |
