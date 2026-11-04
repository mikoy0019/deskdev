# DeskDev Studio: n8n automations

Thirteen workflows, version-controlled in [`n8n/`](n8n/) and run by NixGen's self-hosted n8n on
Render, **https://nixgen-n8n-8gp7.onrender.com** (Render service `nixgen-n8n`). The JSON here is the
source of truth; [`scripts/n8n.mjs`](../scripts/n8n.mjs) keeps the live instance in line with it.
The host itself (Render service, database, keep-alive) is documented in [`RENDER.md`](RENDER.md).

> **Status, 2026-10-02.** DeskDev moved to Supabase project `rgasjotvqwkjbeivlhvn`, and every
> workflow here points at it. The new n8n instance is being brought up. The **old** instance,
> `https://nixgen-n8n.onrender.com` (n8n 2.28.5, on a Render account the new tooling cannot
> reach), still answers. Switch its `[deskdev]` workflows off **before** activating the new
> ones, or every digest goes out twice. Its copies of `task-assigned-email` and `lead-nudge`
> also still link to the retired `deskdev-studio.pages.dev` host, a name anyone can now register,
> so switching them off is a security fix too, not just de-duplication.

Emails link into DeskDev at **https://workspace.nixgensolutions.com** (`/tasks`, `/growth/leads`).
Those links only work once `nixgensolutions.com` is on Cloudflare and the site Worker serves
the `workspace` custom domain.

## How it fits together

```
DeskDev database (Supabase rgasjotvqwkjbeivlhvn)
  INSERT on clients / tasks / task_activity / notifications / eod_reports / lead_activity
    └─ trigger → n8n_post(hook, payload) ──► POST <n8n_base_url>/webhook/<hook>     x-webhook-secret
  new non-spam lead (intake_site_lead, 034)
    └─ trigger (035) → n8n_post('deskdev-lead-intake', {lead_id}) ──► auto-reply + team email + Sheets
  email queued in DeskDev (emails, 049; email_retry for a failed one)
    └─ trigger → n8n_post('deskdev-email-send', {email_id}) ──► Gmail send / reply → emails.status
Gmail inbox, polled every 5 min (email-inbound) ──► rpc email_ingest (049): matched to a lead,
    client or project by thread or sender, else nothing stored
nixgen-site  /api/contact ──► rpc intake_site_lead (anon key + LEAD_INTAKE_SECRET); never n8n
vault-reset  edge function ─────────────────► POST …/webhook/deskdev-vault-reset-code x-webhook-secret

n8n schedules (07:00 / 08:00 / Mon 08:00 / 18:30, Asia/Manila)
  └─ Supabase REST with the service role ──► Gmail / Google Sheets
       └─ last step: "Log run" ──► automation_runs (status ok)
any failed execution ──► [deskdev] error-handler ──► automation_runs (status error)
                                                └─► email, at most once per job per hour
automation_health (view) ──► DeskDev Settings → Integrations (admins)

keep-alive: Cloudflare Worker nixgen-n8n-keepalive (*/10) + pg_cron job n8n-keepalive (*/10)
```

Five rules hold it together. Each one exists because its absence has cost real time:

1. **Judge n8n by `automation_runs`, never by `/healthz`.** `/healthz` says the process is up. It
   does not say the 08:00 digest went out. Every scheduled workflow logs an `ok` row, and every
   failure logs an `error` row, so "late" and "failing" show up in the app.
2. **Every webhook requires the shared secret.** The Webhook nodes use Header Auth
   (`x-webhook-secret`); n8n answers 403 without it. Before this, any caller who knew a URL could
   trigger the assignment emails or insert leads with the service role.
3. **No `$env` in workflows.** n8n 2.x blocks it by default, and a blocked `{{ $env.X }}` does
   not fail loudly: it resolves to `[ERROR: access to env vars denied]` and the request goes out
   with that text in it. Secrets are credentials; everything else is a literal.
4. **The git JSON is instance-independent.** Credential ids are placeholders that
   `scripts/n8n.mjs push` resolves on the target instance, so a rebuild is a push, not a
   by-hand re-wiring of every node.
5. **Activation is a human click.** The script creates and updates workflows; it never switches
   one on or off.

## Workflows

| File | Trigger | What it does | Logs runs |
|---|---|---|---|
| `overdue-tasks.json` | Daily 08:00 | Emails the overdue (not done, not archived, past due) tasks | yes |
| `weekly-time-summary.json` | Monday 08:00 | The previous 7 full days (Monday to Sunday) of `time_entries`, by person and client | yes |
| `daily-activity-digest.json` | Daily 18:30 | Tasks completed + hours logged today (inactive; `enabled = false` in `automation_jobs`) | yes |
| `job-postings-finder.json` | Daily 07:00 | Adzuna + onlinejobs.ph → `job_postings` (deduped on URL), digest email, **Job Postings** tab. An Adzuna failure logs the run as `error`; a failed upsert fails the run | yes |
| `lead-nudge.json` | Daily 08:00 | **Retired, keep inactive.** Replaced by `lead_followups_due()` (migration 035), the in-app daily digest per owner. Kept so it can return as an email channel: if switched on it mails each owner their own never-replied / follow-up-overdue / going-cold leads (threshold `growth_stale_days`), and unowned leads to the admins | yes (paused) |
| `new-client-alert.json` | `POST /webhook/deskdev-new-client` | Email when a client is created | errors only |
| `log-to-sheets.json` | `POST /webhook/deskdev-log` | Activity, completions, notifications, EOD reports, lead events (**Lead Activity** tab) → the **Deskdev Log Activities** sheet | errors only |
| `task-assigned-email.json` | `POST /webhook/deskdev-task-assigned` | Emails the assignee, logs to **Assignments** (also on reassignment) | errors only |
| `inbound-lead.json` | `POST /webhook/deskdev-lead-intake` (`{ lead_id }`, from the database) | Side effects of a lead the database already recorded: the prospect's auto-reply (only while Settings → Growth → auto-reply is on) + `auto_reply_sent` activity, the team email, the **Inbound Leads** row | every run (`ok` / `skipped` / `error`) |
| `vault-reset-code.json` | `POST /webhook/deskdev-vault-reset-code` | Emails the reset approval code to the vault owner, read from `vault_settings` (a caller-supplied `to` that differs is rejected) | errors only |
| `email-send.json` | `POST /webhook/deskdev-email-send` (`{ email_id }`, from the database) | Sends an email a teammate wrote in DeskDev (`emails`, migration 049) from the Gmail account: a reply in the customer's thread when it answers their message, else a new message; marks it `sent` (with the Gmail ids) or `failed` (with a short reason) | every run (`ok` / `skipped` / `error`) |
| `email-inbound.json` | Gmail Trigger, every 5 min, plus an hourly probe | New inbox mail (not our own) → `email_ingest`, which keeps only mail from leads, clients and threads DeskDev knows; the hourly probe proves the Gmail credential works | every poll that found mail + one ok an hour (`automation_jobs`: registered paused by 049) |
| `error-handler.json` | any failed `[deskdev]` execution | `error` row in `automation_runs` + an alert to nixgensolutions@gmail.com | n/a |

All times are Asia/Manila (each workflow pins `settings.timezone`).

### Who gets which email

No workflow names a person. Each one reads `profiles` (the **Recipients** node, service role)
at run time, skips anyone with `deactivated_at` set (migration 032) or without a usable email,
and falls back to the company inbox, nixgensolutions@gmail.com, only when nobody qualifies.
`check` fails on a Gmail node whose `sendTo` is a literal.

| Workflow | Recipients |
|---|---|
| `overdue-tasks`, `weekly-time-summary`, `daily-activity-digest` | admins |
| `new-client-alert` | admins + `clients: edit` |
| `job-postings-finder` | admins + `growth: edit` |
| `inbound-lead` (team email) | the lead's owner + every `growth: edit` member and admin while `workspace_settings.growth_notify_all` is on (the default); owner only when it is off; admins when nobody else qualifies |
| `inbound-lead` (auto-reply) | the prospect, see below |
| `lead-nudge` (retired) | each lead's owner; admins for unowned leads or an owner who left |
| `task-assigned-email` | the assignee (unchanged) |
| `vault-reset-code` | the vault owner from `vault_settings` (unchanged) |
| `email-send` | the recipients a teammate typed in DeskDev, on a lead, client or project they can edit (RLS on `emails`); never a literal |
| `error-handler` | the company inbox, a literal on purpose: it must work while the database is the thing that is failing |

### The lead-intake workflow (`inbound-lead.json`)

The website never calls n8n. `/api/contact` calls `intake_site_lead` (migration 034), which
stores, dedupes, scores and assigns the lead and notifies the team in-app in one transaction.
Migration 035's trigger then posts only `{ lead_id }` to `deskdev-lead-intake`, and this
workflow reads everything else back with the service role:

```
Trigger → Parse (uuid or fail) → Lead → Settings (workspace_settings) → Recipients → Prior auto-reply → Plan
Plan → Process? ─ no ─► Log skipped (automation_runs status 'skipped': spam, import, closed, not found)
              └ yes ─► Auto-reply? ─ yes ─► Send auto-reply → Record auto-reply (lead_activity 'auto_reply_sent')
                                    └──────────────────────────► Team email → Sheet row → Append: Inbound Leads → Log run
```

- **Auto-reply** goes out only when `growth_auto_reply` is on (off by default), the lead came from
  a site form (`source = 'website'`, not `form = 'email'`), has one valid address, was submitted
  in the last 24 hours, and has no `auto_reply_sent` row yet. It never echoes the prospect's
  message or links (the form accepts any address, so an echo would be a relay), greets by first
  name only when it looks like a name, adds the booking link only when `growth_booking_url` is
  `https`, keeps the public "within 12 hours" promise, and never names DeskDev or the team's
  location. It is sent as "NixGen Solutions" from the connected Gmail account, so replies land there.
- **Team email**: every value is HTML-escaped; it carries the message, score, budget, services,
  timeline, attribution, the SLA deadline in the business-hours timezone, and a link to
  `https://workspace.nixgensolutions.com/growth/leads?lead=<id>`.
- **Sheets**: the `Inbound Leads` header is unchanged. `Notes` now holds services, budget,
  timeline, score, form and the lead id; the prospect's message stays in the database.
- **Imports** (`form = 'import'`) are skipped entirely, so a CSV of old enquiries sends nothing.

### Email from DeskDev (`email-send.json`, `email-inbound.json`)

DeskDev never talks to Gmail. A teammate writes an email on a lead, client or project; the app
inserts an `emails` row (`status 'queued'`), and migration 049's trigger posts only
`{ email_id }` to `deskdev-email-send`. The same Gmail account that sends every other DeskDev
email sends these, so a free Gmail account is enough and the app needs no Gmail permission.

```
Trigger → Parse (uuid or fail) → Claim (PATCH status=eq.queued → 'sending', return=representation)
  → Original (the email it answers) → Settings (workspace_settings) → Plan
Plan → Send? ─ yes ─► Reply? ─ yes ─► Reply in thread ─┐
             │                └ no ──► Send new ───────┴► Sent? ─ yes ─► Mark sent → Log run
             │                                                └ no ──► Failure → Mark failed → Log failed
             └ no ──► Fail? ─ yes (no valid recipient) ─► Failure
                            └ no (nothing to claim) ────► Log skipped
```

- **Never twice.** Claim flips the row from `queued` to `sending` and returns it only if it was
  still queued. A retried webhook, a replay or a second run gets nothing back and stops as
  `skipped`. `email_retry` (049) puts a failed email back to `queued` and posts again.
- **Never stuck.** Once claimed, every path ends in `sent` (with `gmail_message_id`,
  `gmail_thread_id`, `sent_at`, and `from_email` = `workspace_settings.email_from_address` when
  set) or `failed` (a one-line reason with addresses replaced by `[address]`). Both Gmail steps
  continue on error so a refusal is routed to **Failure** instead of ending the run. Only a crash
  inside n8n between Claim and those writes (the error handler logs it) could leave a row in
  `sending`.
- **Threads.** A reply to a message the customer sent (`in_reply_to` → an inbound email with a
  Gmail id, and the customer still among the recipients) uses Gmail's *reply* operation, so it
  lands in their thread; anyone else the teammate addressed is copied. A follow-up to our own
  email goes out as a new message.
- **Content.** The plain-text body becomes escaped paragraphs; `email_signature` sits under a
  rule; the sender name is `email_from_name` (Settings).

`email-inbound` polls the inbox every 5 minutes (`in:inbox -from:me`, read or unread) and posts
each new message to `rpc/email_ingest`. The database matches it by Gmail thread, then by an open
lead's address, then by a client's address, and stores **nothing** for anyone else, so personal
mail never enters DeskDev. The quoted history under a reply ("On … wrote:") is cut before
sending; the full message stays in Gmail. Runs log counts only (seen / matched / duplicates /
ignored / skipped / failed), never addresses or text. A Gmail Trigger only runs when mail
arrives, so the workflow also has an **Hourly** probe that lists one inbox message (proving the
credential still works) and logs an ok row; without it a quiet inbox would read as *Late*.

To switch it on: activate both workflows in n8n, set `automation_jobs.enabled = true` for
`email-inbound` (049 registers it paused), and fill in the email settings in DeskDev (from name,
signature, and the Gmail address, which is also how our own copies are skipped). The **Gmail
account** credential must be allowed to read mail: n8n's Gmail OAuth2 credential requests full
Gmail access by default, and the Google OAuth app behind it must be in *Production*, because a
*Testing* app's tokens expire after 7 days.

## The shared webhook secret: one value, five places

| Where | Name | How it is set |
|---|---|---|
| Supabase Vault (read by the DB triggers) | `n8n_webhook_secret` | SQL editor: `select vault.create_secret('<value>', 'n8n_webhook_secret');` |
| n8n credential (Header Auth, header `x-webhook-secret`) | `DeskDev Webhook Secret` | `scripts/n8n.mjs push` creates it from `N8N_WEBHOOK_SECRET` |
| `vault-reset` edge function | `N8N_WEBHOOK_SECRET` | `supabase secrets set N8N_WEBHOOK_SECRET=…` |
| nixgen-site Worker | `N8N_WEBHOOK_SECRET` | **Not used.** `/api/contact` writes through a database function and the site never calls n8n, so the Worker does not hold this secret (its three secrets: `site/README.md`, Deploy) |
| Local tooling | `N8N_WEBHOOK_SECRET` | the single env file, `.env.local` at the repo root (legacy `web/.env.local` still read; gitignored) |

**Rotating it.** Header Auth holds one value, so a rotation has a short gap. Change the n8n
credential and the senders (the Vault row, the vault-reset function and, until it is deleted,
the site Worker's copy) together. A database trigger that fires during the gap gets a
403, and pg_net does not retry, so do it at a quiet hour.

**The host** follows the same pattern: the Vault row `n8n_base_url` (migration
`028_n8n_base_url.sql`), `N8N_BASE_URL` on the site Worker (optional, and unused once `/api/contact` calls the RPC),
and `N8N_VAULT_RESET_WEBHOOK` on the vault-reset function. Moving n8n is three settings, not a
code change.

## Run log and health

Migration [`026_automation_runs.sql`](../supabase/migrations/026_automation_runs.sql):

- `automation_jobs`: the scheduled jobs and their cadence (24 h, or 168 h for the weekly one,
  plus a grace period). `enabled = false` marks a job that is switched off in n8n, so it shows as
  *paused* rather than *late*.
- `automation_runs`: one row per scheduled run and per failure. Written only with the service
  role (n8n's Supabase credential); RLS lets admins read it, and nobody can insert from the app.
  Kept 90 days (pg_cron `purge-automation-runs`, 03:15 daily).
- `automation_health`: one row per job:

| Status | Meaning |
|---|---|
| `ok` | The last ok run is inside cadence + grace |
| `stale` (Late) | No ok run inside cadence + grace: n8n asleep, the workflow switched off in n8n, or a schedule that never fired |
| `failing` | The latest run failed (webhook workflows: any failure in the last 24 h) |
| `never` | Nothing logged yet (expected right after setup) |
| `paused` | `automation_jobs.enabled = false` |

DeskDev shows it under **Settings → Integrations → Automations** (admins only).

**Adding a scheduled workflow:** end it with a `Log run` node (copy one; `executeOnce`, placed
below the main row so that, with execution order v1, it runs after the main branch), add its
row to `automation_jobs` in a new migration, and run `node scripts/n8n.mjs check`. CI runs the
same check, and it fails when either half is missing.

## Day to day: `scripts/n8n.mjs`

```bash
node scripts/n8n.mjs check            # offline lint; CI runs it
node scripts/n8n.mjs status           # live vs git, node by node
node scripts/n8n.mjs push             # dry run: what would be created / updated, how each credential resolves
node scripts/n8n.mjs push --apply     # do it (workflows stay inactive / active as they are)
node scripts/n8n.mjs pull             # live → automation/n8n/.live/ for a diff (pull --write overwrites git)
node scripts/n8n.mjs audit            # the whole shared instance: $env readers, node types in use
```

It reads the single env file every DeskDev secret lives in, `.env.local` at the repo root (then
the legacy `web/.env.local` and `automation/.env.local`, only for keys still missing, while those
files exist; or just the file named by `DESKDEV_ENV_FILE` / `N8N_ENV_FILE`; see
`scripts/lib/env.mjs`): `N8N_BASE_URL`, `N8N_API_KEY`, and, for a first push only,
`SUPABASE_SERVICE_ROLE_KEY`, `N8N_WEBHOOK_SECRET`, `ADZUNA_APP_KEY`.

What `check` enforces, so a regression fails CI instead of failing at 08:00:
no `$env`; every webhook on Header Auth with the shared credential; every credential reference a
placeholder; every Supabase call aimed at DeskDev's project; no `*.pages.dev` links; every
Google Sheets append writing `RAW`; Manila timezone and execution order v1; every workflow wired
to the error handler; every scheduled workflow logging its runs and registered in
`automation_jobs` (read from every migration's `INSERT INTO public.automation_jobs … ON
CONFLICT (job)`, not only 026); no Gmail node sending to a literal address (recipients come from `profiles`);
canonical formatting.

**Credentials.** Git carries these placeholders, and `push` resolves each one, in order: a
`--…-cred-id` flag, else the instance's credential list (by type and exact name), else, for the
three this repo owns, a new credential made from env.

| Placeholder | n8n credential (type) | Made by |
|---|---|---|
| `__SUPABASE_CRED__` | `Supabase — DeskDev` (supabaseApi) | push, from `SUPABASE_SERVICE_ROLE_KEY` |
| `__DESKDEV_WEBHOOK_CRED__` | `DeskDev Webhook Secret` (httpHeaderAuth) | push, from `N8N_WEBHOOK_SECRET` |
| `__ADZUNA_CRED__` | `Adzuna API key` (httpQueryAuth, `app_key`) | push, from `ADZUNA_APP_KEY` |
| `__GMAIL_CRED__` | `Gmail account` (gmailOAuth2) | you, in the n8n UI (browser consent) |
| `__GOOGLE_SHEETS_CRED__` | `Google Sheets account` (googleSheetsOAuth2Api) | you, in the n8n UI; the account must be able to edit the log sheet |

Until the two Google credentials exist, a new workflow is created with that reference empty (the
node shows *select credential*). An existing workflow keeps whatever the UI already has. A
missing Supabase, webhook or Adzuna credential skips the workflows that need it rather than
half-writing them.

**First rollout on a new instance:**

1. `push`, and read the credentials table it prints.
2. `push --apply`. This creates the error handler first, then everything else, inactive.
3. In the n8n UI, create **Gmail account** and **Google Sheets account** (exact names).
4. `push --apply` again to fill those references; `status` should show 13 *in sync*.
5. Switch the old instance's `[deskdev]` workflows off, then activate the new ones, except
   `lead-nudge` (retired; its in-app replacement runs in the database) and
   `daily-activity-digest` (paused in `automation_jobs`). Activate `inbound-lead` only after
   migrations 034 and 035 are applied: its trigger and the columns it reads arrive with them.
   Activate `email-send` and `email-inbound` only after migration 049 (the `emails` table, its
   trigger and `email_ingest`); see *Email from DeskDev* above for the rest.
6. Run each scheduled workflow once by hand, then check **Settings → Integrations**: an *ok*
   row is the proof, not the green tick in n8n.

The Gmail **Label** steps (overdue-tasks, weekly-time-summary, new-client-alert) add label
`Label_7494873874672194724`. Label ids belong to one Google account, so if Gmail is connected as
another account, re-pick the label in the UI. The step is set to continue on error, so a wrong
label never fails the digest.

## Reference

### The log spreadsheet

**Deskdev Log Activities**, id `1P_mAgFG6ZllXGCwhg7RuImESI-sfV9-lKLrFyD0uhNg` (owned by the
Google account behind the original Sheets credential; whoever connects **Google Sheets account**
needs edit access). The workflows append by header name, so row 1 must match exactly:

| Tab | Header row (row 1) |
|---|---|
| `Activity Log` | `Timestamp` `Date` `Time` `Action` `Task` `Actor` `ActorId` `TaskId` `ClientId` `Detail` |
| `Task Completions` | `Timestamp` `Date` `Time` `Task` `CompletedBy` `TaskId` `ClientId` |
| `Notifications` | `Timestamp` `Date` `Time` `Type` `Title` `Actor` `RecipientId` `Entity` `EntityId` |
| `Assignments` | `Timestamp` `Date` `Time` `Task` `TaskId` `Assignee` `Email` `Client` `Status` |
| `EOD Reports` | `Timestamp` `Date` `Time` `Client` `ReportDate` `Author` `Minutes` `Content` |
| `Job Postings` | `Timestamp` `Date` `Time` `Source` `Tag` `Title` `Company` `Location` `Remote` `Salary` `PostedAt` `URL` |
| `Inbound Leads` | `Timestamp` `Date` `Time` `Name` `Company` `Email` `Notes` |
| `Lead Activity` | `Timestamp` `Date` `Time` `Action` `Lead` `Actor` `ActorId` `LeadId` `Detail` |

Create the `Lead Activity` tab with that header row before pushing the updated `log-to-sheets`;
an append to a missing tab fails the run.

`Lead Activity` gets pipeline milestones only. Migration 035's trigger forwards `created`,
`stage_changed`, `contacted`, `won`, `lost`, `assigned`, `proposal_sent`, `meeting_booked` and
`converted`; the workflow's own allow-list is the second lock and also admits
`booking_link_sent`, `call_logged`, `followup_set`, `auto_reply_sent`, `spam_marked` and
`not_spam`, so widening the trigger later needs no workflow change. Notes,
`submitted`/`resubmitted` (the prospect's message), email bodies and the every-5-minutes
`sla_breached` rows never reach the sheet, and free-text keys (`message`, `body`, `email`,
`phone`, `attribution`, …) are dropped from `Detail`.

Every append writes with `cellFormat: RAW`, so a value is stored as typed text and never runs
as a formula (a contact-form name like `=HYPERLINK(…)`, a task or notification title). The
side effect: `Timestamp`, `Date` and `Time` land as text, not parsed dates. They are ISO-style
strings, so they still sort correctly.

The web app hard-deletes `task_activity` older than 48 h; `log-to-sheets` fires on INSERT, so the
sheet is the permanent archive of that activity.

### Growth Hub feeds

`job-postings-finder` queries Adzuna's **US** endpoint (Adzuna has no PH region; app id
`b1a35196` is a literal in the node, the key is the `Adzuna API key` credential) and scrapes
onlinejobs.ph best-effort (if its markup changes it silently yields nothing while Adzuna keeps
working). Edit `what_or` and the country code in the **Adzuna** node to taste.

> **Rotate the Adzuna key.** An earlier version of this README carried `ADZUNA_APP_KEY` in plain
> text, so it is in git history. Issue a new key at developer.adzuna.com and put it in the
> `Adzuna API key` credential (or in `ADZUNA_APP_KEY` before the first push).

`inbound-lead` no longer inserts anything: the database is the system of record (see **The
lead-intake workflow** above), and n8n being asleep or down loses no lead, only the auto-reply,
the team email and the sheet row for that lead (the team still gets the in-app notification and
push). Its run log shows each lead as `ok` or `skipped` with a reason.

### Calling a webhook by hand

```bash
curl -X POST https://nixgen-n8n-8gp7.onrender.com/webhook/deskdev-lead-intake \
  -H 'Content-Type: application/json' -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" \
  -d '{"lead_id":"<uuid of a test lead>"}'
```

Without the header it must answer 403; that is the check that the webhook is closed. With it,
the run log gets an `ok` row, or `skipped` with `lead_not_found` for an id that does not exist.
Use a lead with your own address: while auto-reply is on, the lead's email gets a real reply.
