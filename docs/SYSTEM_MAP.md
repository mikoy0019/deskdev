# System map: DeskDev Studio

How DeskDev and the NixGen site are put together: users, apps, backend,
automations and the Google integration. As of 2026-10-03; the website ↔ DeskDev
rows (forms, booking, email) were updated 2026-10-06.

Status words: **working** (exercised end to end) · **partial** (runs, with a named gap) ·
**blocked** (built, waiting on a decision, credential, migration or deploy) · **not booted** /
**not verified** (built and configured, never seen running end to end) · **planned**.

## Users

| Role | Reaches | Gate |
|---|---|---|
| Admin | everything, including Settings → Workspace / Users / Data / Integrations, showcase publishing and the audit log | `profiles.role = 'admin'` and not deactivated; `is_admin()` in RLS |
| Member | features granted per feature as none / view / edit (`profiles.permissions`): projects, tasks, clients, crm, calendar, meetings, growth, courses, showcase | `has_perm(feature, level)` in RLS; new sign-ups are always members (024); a deactivated profile passes nothing (032) |
| Website visitor | the NixGen site; the contact form (a Growth Hub lead) and newsletter box (a subscriber); the booking page `/book`; a customer form link `/f/<token>`; published showcase items | `/api/contact` → `intake_site_lead` (034), `/api/subscribe` → `intake_subscriber` (039), `/f/<token>` → `form_link_read` / `form_link_submit` (047): secret-gated RPCs, the Worker secret `LEAD_INTAKE_SECRET` = Vault `lead_intake_secret`; `/book` → the `google-calendar` function with `BOOKING_API_SECRET`; anon column grants on `showcase_items` |
| Schedulers | n8n schedules, pg_cron | n8n uses the service role; pg_cron runs as postgres |

## Frontend

| App | Stack | Where | Status |
|---|---|---|---|
| NixGen site + DeskDev | Next.js 16 App Router, built with the OpenNext Cloudflare adapter → Cloudflare Worker `nixgen-site` (config `site/wrangler.jsonc`, page cache in R2 per `site/open-next.config.ts`) (account `5c6c…6a46`). Until the DNS cutover it is served at `https://nixgen-site.nixgensolutions.workers.dev`, DeskDev at `/workspace`, search engines told to stay out; after it (the `routes` in `site/wrangler.jsonc`) the hosts are `nixgensolutions.com` + `workspace.nixgensolutions.com` | `site/`; DeskDev is the SPA in `site/src/deskdev`, mounted at `/workspace` | not verified: not deployed yet (2026-10-04); on 2026-10-02 `nixgensolutions.com` still served the WordPress site. Health, logs, rollback, alerts: [`runbooks/OPERATIONS.md`](runbooks/OPERATIONS.md) |
| Mobile | Expo SDK 56, expo-router | `mobile/` | parked (local mode + Supabase work; the PWA covers phones) |

DeskDev routes: `/` (home), `/projects`, `/tasks`, `/clients`, `/crm`, `/calendar`, `/meetings`,
`/growth` (leads, outbound), `/courses`, `/messages`, `/channels`, `/notifications`,
`/vault`, `/settings` (profile, appearance, notifications, integrations, workspace, users, data).
Planned with the Round 2 screens: `/showcase` (the library behind `/portfolio`) and the Growth lead drawer.

## Backend

| Piece | Where | What it does |
|---|---|---|
| Supabase Postgres + RLS | project `rgasjotvqwkjbeivlhvn`: migrations `001`–`028` applied 2026-10-02, `029`–`042` by 2026-10-05; `043`–`049` are **files only** (check the ledger before relying on one) | the only store; every table has RLS. Ledger and the raw-SQL rule: `supabase/README.md` |
| Realtime | publication `supabase_realtime` | live tasks, chat, channels, notifications |
| Edge function `admin-users` | `supabase/functions/admin-users` | user lifecycle (admin only): create, update, deactivate, delete |
| Edge function `vault-reset` | `supabase/functions/vault-reset` | vault reset approval code, mailed through n8n |
| Edge function `send-push` | `supabase/functions/send-push` | Web Push delivery (029) — blocked: not deployed, VAPID + Vault secrets not set |
| Edge function `google` | `supabase/functions/google` | per-person Google OAuth + Sheets export, and the company account (purpose `workspace`) — blocked: OAuth client and secrets not set, not deployed |
| Edge function `google-calendar` | `supabase/functions/google-calendar` | team calendar sync worker + ICS feeds (040), and the booking page's `slots` / `book` (048) — planned: needs the company grant; booking also needs 048 and `BOOKING_API_SECRET` (`--no-verify-jwt`, secrets in its README) |
| Site route `/api/contact` | `site/src/app/api/contact/route.ts` + `src/lib/guard.ts` | origin / size / honeypot / Turnstile / throttle key, spam signals, attribution and source, then `intake_site_lead()` with the anon key + `LEAD_INTAKE_SECRET`; failures of Turnstile quarantine, never reject. Blocked until 034 is applied and the secret is set |
| Site route `/api/subscribe` | `site/src/app/api/subscribe/route.ts` | newsletter box → `intake_subscriber()` (039) |
| Site routes `/api/booking/slots`, `/api/booking` | `site/src/app/api/booking` + `src/lib/booking.ts` | the `/book` page → the `google-calendar` function's `slots` / `book` with `BOOKING_API_SECRET` (server to server) |
| Site page `/f/<token>` + route `/api/forms/<token>` | `site/src/app/(site)/f`, `site/src/app/api/forms/[token]` | a customer form link: `form_link_read` / `form_link_submit` (047) with the anon key + `LEAD_INTAKE_SECRET`; only the template's customer fields reach the browser |
| Site route `/api/client-errors` | `site/src/app/api/client-errors` | scrubbed client error reports → Worker logs |
| Site route `/api/google/*` | `site/src/app/api/google/[leg]` | relays the Google connect legs to the `google` function |
| One door to n8n | `n8n_post(hook, payload)` (026, host from Vault since 028) | every database → n8n webhook, signed |
| pg_cron | live: `purge-expired-chat` (hourly), `purge-automation-runs` (03:15), `n8n-keepalive` (10 min). With 035/039/040: `lead-sla-sweep` (5 min), `lead-followups-due` (hourly, digest per owner), `purge-lead-intake-attempts` (03:25), `data-retention` (03:45: spam 30 d, lost-lead PII 24 mo, notifications 90 d), `google-calendar-retry` (2 min). With 041: `showcase-link-check` (15 min). With 048/049: `purge-booking-attempts` (03:35), `email-send-sweep` (5 min: re-kicks queued mail, fails stuck mail) | retention, SLA, sweeps and keep-alive |

The site Worker holds **no** service-role key: anon reads go through column
grants and RLS, privileged work through secret-gated RPCs or Edge Functions.
Every app env (`site/.env.local`, `mobile/.env`) targets `rgasjotvqwkjbeivlhvn`.
n8n keeps its own data in a separate project, `isinzodyagsbqevpeure` (see below).

## Database: tables beyond the core

| Table / view | Migration | Notes |
|---|---|---|
| `automation_jobs`, `automation_runs`, `automation_health` | 026 | scheduled jobs, one row per run and failure (90-day retention), per-job health (security_invoker) |
| `google_connections` | 027 | one Google grant per person; refresh token AES-GCM sealed; RLS on, no policies (function only) |
| `push_subscriptions` | 029 | Web Push endpoints per device |
| `audit_log` | 032 | who changed roles, permissions, deactivation, vault approvals, showcase publishing; admins read, only triggers / service role write |
| `workspace_settings` | 033 | one row: Growth SLA, business hours, owner pool, booking URL, auto-reply, stale days, targets, showcase auto-publish |
| `leads` (+ intake columns), `lead_intake_attempts` | 034 | scoring, SLA due time, spam quarantine, dedupe by `email_norm`; the throttle ledger |
| `showcase_items` + storage bucket `showcase` | 037, 038 | the public project library; anon sees `published` rows only, through a column list |
| `site_subscribers`, `site_subscriber_attempts` | 039 | newsletter sign-ups with consent time and unsubscribe record; their throttle ledger |
| `google_workspace_link`, `google_sync_outbox`, `event_attendees`, `calendar_feed_tokens` | 040 | company calendar grant, push queue, invitees, hashed personal feed tokens |
| `showcase_link_checks` | 041 | the link checker's history; dead product demos become private links |
| `signup_allowlist` | 042 | accounts come into being only through `admin-users` or an operator |
| `project_engagements` | 044 | admin-only agreements, delivery approvals, invoice and receipt ledger |
| `projects.phase`, `form_responses` (+ share link columns) | 046, 047 | onboarding → development → launched; discovery and onboarding answers per lead / project; a hashed 14-day customer link |
| `workspace_settings.booking_*`, `events.lead_id` / `booked_via`, `booking_attempts` | 048 | the booking page's switches, a meeting linked to its lead, the booking throttle ledger (7 days) |
| `emails`, `workspace_settings.email_*` | 049 | mail to and from leads and clients (queued for n8n's Gmail, replies matched back); the sender name, signature and address |

Vault secrets (never in git): `n8n_webhook_secret`, `n8n_base_url` (026, 028),
`deskdev_push_function_url`, `deskdev_push_secret` (029), `lead_intake_secret`
(034, 039), `deskdev_google_calendar_url`, `deskdev_google_calendar_secret` (040).

## Automation: n8n on Render

| Piece | Runs where | Status | Detail |
|---|---|---|---|
| n8n `nixgen-n8n` | Render free, https://nixgen-n8n-8gp7.onrender.com, n8n 2.41.5 (`scripts/render-n8n.mjs`, `automation/RENDER.md`) | not booted | data in its own Supabase project `isinzodyagsbqevpeure` (schema `n8n`, session pooler, CA pinned) |
| old n8n | https://nixgen-n8n.onrender.com, another Render account | running | still holds the live `[deskdev]` workflows; switch them off before activating the new ones (double emails, and an unauthenticated webhook) |
| Workflows | `automation/n8n/*.json`, pushed by `scripts/n8n.mjs` | partial | hardened and retargeted; not pushed yet. The lead side effects (auto-reply, team email, Sheets) move to a `deskdev-lead-intake` hook fired by 035 |
| Error handler | `[deskdev] error-handler` | partial | logs every failure; emails at most once per job per hour |
| Watchdog | Cloudflare Worker `nixgen-watchdog` (`workers/n8n-keepalive`, built, not deployed) + pg_cron `n8n-keepalive` (live) | partial | keeps n8n awake and probes the site, workspace, Supabase and n8n; alerts through n8n (Resend as fallback) |

Runbook: [`automation/README.md`](../automation/README.md). The five rules:
judge by `automation_runs` not `/healthz`; every webhook signed; no `$env`; instance-independent
git JSON; activation is a human click.

## Google Cloud services

| Service | Used? | How |
|---|---|---|
| OAuth 2.0 client (Cloud Console) | yes | the `google` function; scopes `openid email drive.file`; per person |
| Google Drive + Sheets API | yes | *DeskDev Exports* folder and export spreadsheets, values written `RAW` |
| Google Calendar | planned (040) | one shared "NixGen Team" calendar on the company account; DeskDev pushes events, Meet links and invites; personal ICS feeds need no Google scopes; the booking page reads free/busy (optional `calendar.freebusy`, 048) |
| Gmail | via n8n | the `Gmail account` credential sends every DeskDev email and reads the replies (049's `email-send` / `email-inbound`); never DeskDev's own OAuth app |
| Sheets (logging) | via n8n | the `Google Sheets account` credential appends to *Deskdev Log Activities* |

Runbooks: [`supabase/functions/google/README.md`](../supabase/functions/google/README.md),
[`supabase/functions/google-calendar/README.md`](../supabase/functions/google-calendar/README.md).

## External

| Service | Status | Detail |
|---|---|---|
| Cloudflare Workers | not verified | `nixgen-site` (previews: `nixgen-site-preview`) and `nixgen-watchdog` built, not deployed (2026-10-04). Runbooks: [`runbooks/OPERATIONS.md`](runbooks/OPERATIONS.md), [`runbooks/DNS-CUTOVER.md`](runbooks/DNS-CUTOVER.md) |
| Cloudflare Turnstile + Web Analytics | planned | site key / beacon token are public build values; the Turnstile secret is a Worker secret |
| Render | not booted | n8n host (see above) |
| Adzuna | partial | job search API for `job-postings-finder`; rotate the key (it was in an old README) |
| formsubmit.co | fallback | the contact form's email copy; kept only while intake proves itself, then removed |

## The flows, in one line each

- **Website lead:** contact form (+ first/last touch from `AttributionCapture`) → `/api/contact`
  (guard) → `intake_site_lead()` → `leads` row (dedupe, score, owner, SLA, source) + notification
  and push (`leads` category) to the owner → 035 trigger → n8n `deskdev-lead-intake` (auto-reply,
  team email, *Inbound Leads* tab). Spam and failed Turnstile are stored as quarantined, unseen.
  In DeskDev: CRM Leads, `?lead=<id>` opens the brief, attribution and score.
- **Subscriber:** footer Dispatch box → `/api/subscribe` → `intake_subscriber()` → CRM Leads → Site
  subscribers.
- **Lead SLA:** `lead-sla-sweep` every 5 min → `sla_breached` + owner ping → admins after the escalation window.
- **Win a lead:** Growth → Convert → `convert_lead()` → client + project + starter tasks, one transaction.
- **Showcase:** project marked done with a live URL → draft item + admin notification → an admin publishes
  → `/portfolio` reads `showcase_items` with the anon key (fallback: `site/src/content/showcase-fallback.ts`).
- **Client lifecycle:** lead → *Convert* (036) → client + project in **Onboarding** (046's default) →
  the onboarding form (`form_responses`, pre-filled from the enquiry; completing it writes contact,
  launch date, budget and portfolio consent onto the client/project) → *Proceed to development* →
  *Development done* + live URL → **Launched** (status done) → 037 drafts the portfolio entry →
  the developer fills it in (DeskDev → Portfolio) → an admin publishes → `/portfolio` within ~5 min.
- **Forms:** *discovery* (per lead, filled in during the meeting from the lead's profile) and
  *onboarding* (per project) live in `site/src/deskdev/lib/forms.ts`; answers in `form_responses`
  (046). *Send to customer* makes a 14-day link to `nixgensolutions.com/f/<token>` (only its sha256
  is stored, 047) → the site server reads it with `form_link_read` (anon key + `LEAD_INTAKE_SECRET`)
  and shows the customer fields only → `/api/forms/<token>` validates and calls `form_link_submit` →
  answers merge into the draft, the sender and the lead owner / project assignee get a
  `form_submitted` notification + push → the team reviews and completes the form (bound answers
  write back onto the lead, client or project).
- **Booking:** `nixgensolutions.com/book` → `/api/booking/slots` → edge function `google-calendar`
  `slots` (business hours − Google free/busy − DeskDev meetings) → customer picks a time →
  `/api/booking` → `book` → `booking_record` (048: lead found by email or created, meeting +
  attendees, `meeting_booked` activity stops the reply clock, notification to host + owner) → the
  meeting syncs to the company Team Calendar with a Meet link and a Google invite (040's outbox,
  drained inline and by the kick). The lead's profile lists it; *Send booking link* prefills the page.
- **Team Calendar sync:** any DeskDev meeting with *Sync to Google* → 040's outbox → the
  `google-calendar` worker (`drain`) → the company account's "NixGen Team" calendar (Settings →
  Integrations → Company calendar).
- **Email:** DeskDev composer (lead profile, client page, quick-form and booking dialogs) → `emails`
  row, queued (049) → `n8n_post('deskdev-email-send')` → n8n `email-send` claims it, sends from the
  *Gmail account* credential (a reply keeps the Gmail thread) → sent / failed back over realtime; a
  sent email to a lead stops its reply clock. A 5-minute sweep re-kicks lost sends and fails stuck
  ones. Inbound: n8n `email-inbound` (Gmail Trigger, every 5 min) → `email_ingest` → matched by
  thread, else an open lead's email, else a client's (strangers never stored) → the profile's thread
  + an `email_received` notification.
- **Team login:** site *Team login* → DeskDev `/login` (already signed in: straight in) → site
  `/login?state=…` → `/auth/callback#dd_at…&dd_state…` → signed in at `next`.
- **Task assigned:** task insert or reassignment → trigger → `n8n_post('deskdev-task-assigned')`
  → n8n looks up the assignee → Gmail → *Assignments* tab.
- **Activity log:** task_activity / notifications / eod_reports / lead_activity (pipeline events only)
  → `deskdev-log` → n8n → the matching Sheets tab.
- **Digests:** n8n schedule → Supabase REST (service role) → Gmail → `Log run` → `automation_runs`.
- **Failure:** any failed execution → error handler → `automation_runs` (error) → email (≤ 1/h/job)
  → Settings → Integrations shows *Failing*.
- **Export:** Settings → Connect Google (consent, browser-bound) → Export → the function reads with
  the user's JWT → new spreadsheet in their Drive.

## Source of truth

| Fact | Owner |
|---|---|
| Everything DeskDev knows (clients, tasks, leads, showcase…) | Supabase |
| What ran, and whether it failed | `automation_runs`: never n8n's execution list or `/healthz` |
| Schema | `supabase/migrations` in ledger order (`supabase/README.md`), applied by hand |
| Schedules and workflow definitions | git (`automation/n8n/*.json`); the instance is made to match with `scripts/n8n.mjs push` |
| Activity archive | the *Deskdev Log Activities* sheet (append-only copy) |
| Secrets | Vault (database), Supabase function secrets, Worker secrets, n8n credentials, and locally the one `.env.local` at the repo root (`AGENTS.md`): never git |
