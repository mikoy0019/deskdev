# DeskDev Studio — Supabase backend

Backend for DeskDev (web at `/workspace` in `site/`, and the Expo app in
`mobile/`). Everything lives in the default **public** schema of one
dedicated project: **`rgasjotvqwkjbeivlhvn`**. n8n keeps its own data in a
separate project (`isinzodyagsbqevpeure`, see `automation/RENDER.md`); never
point these migrations at it, or at any shared database.

## The raw-SQL rule

The remote project has **no `schema_migrations` table**: every file was
applied by hand. So:

- **Never run `supabase db push`** (or `db reset --linked`). It would treat the
  project as empty and re-run `001` onwards over live data.
- Apply one file at a time, in ledger order, and record it in the table below:
  ```bash
  supabase db query --linked -f supabase/migrations/032_account_lifecycle.sql
  ```
  (or paste the file into Dashboard → SQL Editor).
- **Never edit a file that is applied.** Fix forward with the next number.
- Numbers are never reused or renumbered. The two `008_` files predate this
  rule; they apply in name order (`008_n8n_webhooks`, then `008_vault`).
- `node scripts/check-migrations.mjs` (CI: `repo-ci.yml`) enforces the ledger:
  unique numbers with no gaps, every file listed here, RLS on every table, and
  for `032+`: `REVOKE ... FROM PUBLIC, anon` on every new function, a pinned
  `search_path` on every `SECURITY DEFINER`, and an `ON DELETE` rule on every
  new foreign key to `profiles`. It also prints the functions anon can call.
- Test new SQL on a throwaway database first (PGlite or a local
  `supabase start`), never on the live project. Until a staging project
  exists, every remote apply touches real client, lead and Vault data.

## Ledger

Status as of 2026-10-13: **001–062 applied** on `rgasjotvqwkjbeivlhvn`
(001–028 on 2026-10-02, 029–041 on 2026-10-04, 042 on 2026-10-05, 043–052 on 2026-10-07, 053–060 on 2026-10-08, 061–062 on 2026-10-13; one transaction per file).
Vault holds `lead_intake_secret` (generated in the database). Web Push and
the Google plumbing were set up on 2026-10-04 with
`node scripts/setup-integrations.mjs`: push delivery is on (proven with a real
browser), and the token sealing key, `APP_ORIGINS` and the calendar secret and
URL row are in place. Google connect itself stays off until the owner's OAuth
client is in the secrets file (`functions/google/README.md`, Runbook).

| # | File | What it adds | Status |
|---|---|---|---|
| 001 | `001_profiles_roles.sql` | profiles, sign-up trigger, `is_admin()` / `has_perm()`, shared `updated_at` | applied |
| 002 | `002_clients.sql` | client_categories, clients | applied |
| 003 | `003_projects_tasks.sql` | project_categories, projects, tasks, task_activity, time_entries | applied |
| 004 | `004_crm.sql` | crm_tables, crm_columns, crm_rows | applied |
| 005 | `005_calendar_meetings.sql` | events (kind: event / meeting) | applied |
| 006 | `006_notifications.sql` | notifications + realtime | applied |
| 007 | `007_realtime.sql` | realtime + replica identity full on every data table | applied |
| 008 | `008_n8n_webhooks.sql` | pg_net webhook to n8n (new client) | applied |
| 008 | `008_vault.sql` | vault_meta / vault_folders / vault_items (admins only, ciphertext) | applied |
| 009 | `009_n8n_task_automations.sql` | task / activity / notification webhooks to n8n | applied |
| 010 | `010_eod_reports.sql` | eod_reports | applied |
| 011 | `011_campaigns.sql` | campaigns (`growth` permission) | applied |
| 012 | `012_leads.sql` | leads | applied |
| 013 | `013_job_postings.sql` | job_postings (n8n job finder) | applied |
| 014 | `014_lead_activity.sql` | lead_activity, speed-to-lead and loss-reason columns | applied |
| 015 | `015_task_subtasks.sql` | tasks.parent_task_id | applied |
| 016 | `016_courses.sql` | courses, course_modules, course_topics | applied |
| 017 | `017_course_topic_thumbnail.sql` | cached SOP video poster | applied |
| 018 | `018_fix_profile_privileges_service_role.sql` | admin-users can change role / permissions | applied |
| 019 | `019_chat.sql` | conversations, messages, conversation_reads | applied |
| 020 | `020_chat_retention.sql` | 24 h chat purge (pg_cron) | applied |
| 021 | `021_vault_non_destructive_reset.sql` | a vault reset archives instead of deleting | applied |
| 022 | `022_vault_reset_approval.sql` | vault_settings + owner-approved resets | applied |
| 023 | `023_channels.sql` | channel_categories, channels, messages, reactions, reads | applied |
| 024 | `024_hardening.sql` | RLS review of 001–023; sign-up ignores role metadata | applied |
| 025 | `025_channel_spaces.sql` | channels belong to the studio or one client | applied |
| 026 | `026_automation_runs.sql` | automation_jobs / runs / health, `n8n_post()` (secret in Vault) | applied |
| 027 | `027_google_connections.sql` | google_connections (service role only) | applied |
| 028 | `028_n8n_base_url.sql` | n8n host in Vault + keep-alive ping | applied |
| 029 | `029_push_subscriptions.sql` | Web Push subscriptions + delivery triggers (`PUSH.md`) | applied (2026-10-04) |
| 030 | `030_security_hardening.sql` | RLS review of 001–029: notification insert guard, vault needs aal2 | applied (2026-10-04) |
| 031 | `031_vault_meta_aal2.sql` | vault_meta reads / inserts need aal2 too | applied (2026-10-04) |
| 032 | `032_account_lifecycle.sql` | `profiles.deactivated_at/by`, profile FKs become ON DELETE SET NULL, `audit_log` + triggers | applied (2026-10-04) |
| 033 | `033_notification_vocabulary_settings.sql` | lead / showcase notification types, push category `leads`, `workspace_settings` singleton | applied (2026-10-04) |
| 034 | `034_lead_intake.sql` | lead intake columns + scoring, `intake_site_lead()` (the secret-gated anon entry point) | applied (2026-10-04) |
| 035 | `035_lead_automation.sql` | SLA sweep, follow-up digest, filtered n8n lead triggers (cron) | applied (2026-10-04) |
| 036 | `036_convert_lead.sql` | `convert_lead()`: client + project + starter tasks in one transaction | applied (2026-10-04) |
| 037 | `037_showcase.sql` | showcase_items (anon reads published rows), publish guard, `showcase` bucket, project trigger | applied (2026-10-04) |
| 038 | `038_showcase_seed.sql` | the 88 current `/portfolio` entries | applied (2026-10-04) |
| 039 | `039_subscribers_retention.sql` | site_subscribers + `intake_subscriber()`; retention crons | applied (2026-10-04) |
| 040 | `040_google_workspace_calendar.sql` | team calendar sync outbox, event attendees, personal ICS feeds | applied (2026-10-04) |
| 041 | `041_showcase_link_checker.sql` | showcase link checker (pg_net + cron), check history, dead product demos become private links | applied (2026-10-04) |
| 042 | `042_signup_guard.sql` | `signup_allowlist` + the `signup_guard` trigger on `auth.users`: an account only comes into being through `admin-users` or an operator (see First admin). Deploy `admin-users` right after it, then prove the guard (First admin, *Prove the guard on the project*) | applied (2026-10-05), guard proven (2026-10-05) |
| 043 | `043_active_accounts_only.sql` | Active-account restrictions, channel membership and API grants (existing work) | applied (2026-10-07) |
| 044 | `044_project_engagements.sql` | Admin-only project agreements, delivery approvals, invoice and receipt ledger; audited versioned saves | applied (2026-10-07) |
| 045 | `045_lead_nudge_retired.sql` | pauses the retired `lead-nudge` job's `automation_jobs` row, so health stops reporting it stale | applied (2026-10-07) |
| 046 | `046_project_phases_forms.sql` | `projects.phase` (onboarding → development → launched) + `form_responses` (discovery / onboarding answers per lead, project or client) | applied (2026-10-07) |
| 047 | `047_form_links.sql` | customer quick-form links: hashed share token on `form_responses`, `form_link_read()` / `form_link_submit()` (secret-gated anon entry points, `lead_intake_secret`) | applied (2026-10-07) |
| 048 | `048_booking.sql` | the booking page: `workspace_settings.booking_*`, `events.lead_id` / `booked_via`, `booking_attempts`, `booking_record()` (service role, called by the `google-calendar` function) | applied (2026-10-07) |
| 049 | `049_emails.sql` | `emails` queued through n8n's Gmail (`deskdev-email-send`), replies matched back by `email_ingest()`, retry + 5-minute sweep, `workspace_settings.email_*` | applied (2026-10-07) |
| 050 | `050_push_devices.sql` | `push_devices`: Expo push tokens of the phone app, registered through `upsert_push_device()` / `delete_push_device()`; send-push delivers to them (`supabase/PUSH.md`). | applied (2026-10-07) |
| 051 | `051_chat_retention_week.sql` | chat is kept for a week: `chat_retention()` becomes 7 days, so the hourly purge (020) and the unread badge (029) follow; the app's `CHAT_RETENTION_HOURS` matches | applied (2026-10-07) |
| 052 | `052_profile_pictures.sql` | pictures: `profiles.avatar_key` (an admin's own) and `clients.avatar_key`, admin-only (guard triggers), the public `avatars` bucket with admin-only writes under `profiles/<id>/` and `clients/<id>/` | applied (2026-10-07) |
| 053 | `053_cube_operations.sql` | Cube operations: admin-owned department work queues (5 admin-only tables), evidence-backed project intake and contract references, routing history; `cube_tick()` on a pg_cron job every minute; no external sends | applied (2026-10-08) |
| 054 | `054_task_collaborators.sql` | `tasks.collaborator_ids` (revision 2): people working on a task besides its assignee; a guard trigger dedupes, drops the assignee and unknown ids, caps at 20 | applied (2026-10-08) |
| 055 | `055_course_topic_notes.sql` | `course_topics.notes` (revision 5): a written note on a topic, besides or instead of its SOP video; plain text up to 100,000 characters | applied (2026-10-08) |
| 056 | `056_presence_channel.sql` | who is online (revision 7): RLS on `realtime.messages` lets active signed-in accounts read and publish presence on the private topic `deskdev-presence`, nothing else; skipped where Realtime's schema is absent | applied (2026-10-08) |
| 057 | `057_crm_columns_people_formulas.sql` | the CRM sheet (revision 4): column types `person` and `formula`, `crm_columns.width` (80–800 px, set by dragging) and `crm_columns.formula` (up to 2,000 characters, worked out in the app) | applied (2026-10-08) |
| 058 | `058_meeting_recordings.sql` | Meeting Recordings (revision 8): `meeting_recordings` (an https link, title, date, notes; filed by client, project and category) and `recording_folders` (a client's own categories); meetings:view reads, meetings:edit writes; realtime | applied (2026-10-08) |
| 059 | `059_whiteboards.sql` | Whiteboard (revision 9): `whiteboards` (an Excalidraw scene as jsonb, up to 5 MB; `version` rises on each save so an out-of-date save is refused) and `whiteboard_folders`; every active account reads and draws, the maker or an admin deletes | applied (2026-10-08) |
| 060 | `060_vault_accounts.sql` | a vault account per admin (revision 6): `vault_key_slots` wraps the generation's data key under one admin's own password, or under a one-time invite code; readable only by that admin at aal2; `vault_access_list()` / `vault_my_access()`; slots go when the admin role does; audited | applied (2026-10-08) |
| 061 | `061_whiteboard_revisions.sql` | task covers and comment mentions, same-conversation DM replies, OLJ application preparation, transactional channel post notifications | applied (2026-10-13) |
| 062 | `062_whiteboard_realtime.sql` | publish whiteboard saves to permitted Realtime readers; existing grants and RLS retained | applied (2026-10-13) |

When you apply a file, change its status here to `applied (YYYY-MM-DD)` in
the same commit. A new migration takes the next free number and gets its row
here in the same change (the check fails otherwise).

### Fresh install (a new or staging project)

Apply every file in name order. The loop stops at the first error:

```bash
for f in supabase/migrations/*.sql; do
  echo "== $f"; supabase db query --linked -f "$f" || break
done
# or, with a connection string:
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

The old one-paste `setup.sql` (001–008) is gone: it drifted from the files.

## Vault secrets

Secrets the database itself reads live in Supabase Vault, never in git. Each
migration applies cleanly without them and the feature stays off (or fails
closed) until they exist. Create them in the SQL editor, as postgres:
`SELECT vault.create_secret('<value>', '<name>');`
The four `deskdev_push_*` and `deskdev_google_calendar_*` rows are the
exception: `scripts/setup-integrations.mjs` creates them (the secret is
generated inside the database and never leaves through SQL text).

| Vault name | Read by | Pairs with |
|---|---|---|
| `n8n_webhook_secret` | `n8n_post()` (026) | n8n credential *DeskDev Webhook Secret* (`N8N_WEBHOOK_SECRET`) |
| `n8n_base_url` | `n8n_post()`, keep-alive (028) | the n8n host |
| `deskdev_push_function_url`, `deskdev_push_secret` | push triggers (029) | `send-push` secret `PUSH_WEBHOOK_SECRET` (`PUSH.md`) |
| `lead_intake_secret` | `intake_site_lead()` (034), `intake_subscriber()` (039) | site Worker secret `LEAD_INTAKE_SECRET` (same value) |
| `deskdev_google_calendar_url`, `deskdev_google_calendar_secret` | `google_calendar_kick()` (040) | `google-calendar` secret `GOOGLE_CALENDAR_WEBHOOK_SECRET` |

## Edge Functions

| Function | Does | Secrets beyond the injected `SUPABASE_*` | Runbook |
|---|---|---|---|
| `admin-users` | create / update / deactivate / delete users (admins) | `APP_ORIGINS` | `functions/admin-users/README.md` |
| `vault-reset` | owner-approved vault reset code, mailed through n8n | `N8N_VAULT_RESET_WEBHOOK`, `N8N_WEBHOOK_SECRET`, `APP_ORIGINS` | header of `functions/vault-reset/index.ts` |
| `send-push` | Web Push delivery | `PUSH_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `PUSH.md` |
| `google` | per-person Google OAuth + Sheets export | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_KEYS` + `GOOGLE_TOKEN_KEY_ID` (or the older single `GOOGLE_TOKEN_KEY`), `GOOGLE_REDIRECT_BASE`, `APP_ORIGINS` | `functions/google/README.md` |
| `google-calendar` | team calendar sync worker + ICS feeds (040) | the Google secrets above + `GOOGLE_CALENDAR_WEBHOOK_SECRET` | `functions/google-calendar/README.md` |

Deploying a function and setting its secrets are owner steps
(`supabase functions deploy <name>`, `supabase secrets set ...`). Local values
for these live in the repo's one env file (see `AGENTS.md`), never in git.
For `send-push`, `google` and `google-calendar`, set the secrets with
`node scripts/setup-integrations.mjs` (`--dry-run` shows what it would change):
it keeps a key that is in use, saves a new key in the env file before sending
it, and switches a feature on only after the function has proven it works.

## First admin

Nobody signs themselves up. Two locks keep it that way:

- **The dashboard switch**: Authentication → Sign In / Providers → *Allow new
  users to sign up* is **off**. It is a setting, and on 2026-10-04 it was
  found on. How to check it without creating anything:
  `docs/runbooks/AUTH.md` section 1.
- **The database (042)**: a trigger on `auth.users` refuses every new account
  that Supabase Auth inserts unless its address is on
  `public.signup_allowlist` at that moment. The entry lasts ten minutes and is
  used up by the account. The `admin-users` function writes it for the
  people an admin adds; nothing else can (RLS on, no policy, no grants to
  `anon` or `authenticated`). This lock holds whatever the switch says.

So the first user of a new project needs one extra statement. Since 024 the
sign-up trigger ignores any `role` in the metadata and always creates a
`member`, hence the promotion:

1. SQL editor, allow the address:
   ```sql
   INSERT INTO public.signup_allowlist (email) VALUES ('you@example.com');
   ```
2. Within ten minutes: Dashboard → Authentication → Add user (the same email,
   a password, auto-confirm). Without step 1 the dashboard reports a database
   error and creates nothing: "Add user" goes through Supabase Auth like any
   sign-up.
3. SQL editor:
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
   ```
4. From then on that admin manages everyone else in DeskDev → Settings →
   Users (the `admin-users` function). Offboarding is **Deactivate** (blocks
   login, keeps history); hard delete is for test accounts.

The guard, as postgres in the SQL editor:

```sql
-- Is it on? Expect on_auth_user_created and signup_guard, both 'O'.
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;

-- Emergency off (admins cannot add users and the cause is the guard).
-- It removes the trigger together with its function:
DROP FUNCTION public.signup_guard() CASCADE;
```

Back on: apply `042_signup_guard.sql` again (it is re-runnable). While it is
off, the dashboard switch is the only lock, so check it first. Rows typed
straight into `auth.users` by an operator session (`postgres`) pass the
guard; a restore with `scripts/backup/restore.mjs` does not fire triggers at
all. Tests: `supabase/tests/signup-guard.test.mjs`.

### Prove the guard on the project

The trigger being there is not the proof. The guard lets a session through
when it logged in as `postgres` or `supabase_admin`, so it only holds if
Supabase Auth logs in under another name. The tests run on PGlite, where
"Supabase Auth" is a role the harness sets (`supabase_auth_admin`); only the
hosted project can show which name the real one uses. Do this once per
project, right after applying 042, and again after a restore into a new
project:

1. SQL editor, read-only. Who is connected:
   ```sql
   SELECT DISTINCT usename, application_name FROM pg_stat_activity;
   ```
   Expect Supabase Auth under `supabase_auth_admin`. `postgres` and
   `supabase_admin` are in the list too, and that is normal: the SQL editor
   you are typing in, the cron jobs, Supabase's own services. What must not be
   there is Auth under one of those two names. No `supabase_auth_admin` row
   means Auth has no connection open right now: sign in to DeskDev once and
   run the query again. This step says what to expect; step 2 is the proof.
2. Dashboard → Authentication → Users → Add user, with a throwaway address
   that is **not** on the allow-list (for example `guard-probe@example.com`)
   and any password. Expect a database error and no account:
   ```sql
   SELECT count(*) FROM auth.users WHERE email = 'guard-probe@example.com';  -- expect 0
   ```
   "Add user" goes through Supabase Auth's admin API, which the sign-up
   switch does not cover, so only the guard can have refused it. Dashboard →
   Logs → Postgres (or Auth) names the reason:
   `signup_guard: sign-ups are closed`.
3. Write the date into the ledger row above:
   `applied (YYYY-MM-DD), guard proven (YYYY-MM-DD)`.

If step 2 creates the account, the guard did not see Auth's session. Delete
the account at once on the same screen (it already has a member profile),
run the "Is it on?" query above, keep the sign-up switch off (it is then the
only lock) and do not mark 042 as proven. The fix is the next migration, not
an edit of 042.

The local demo accounts (`admin@deskdev.local`, `member@deskdev.local`) exist
only in local mode, never in Supabase.

## Client configuration

Only the URL and the **anon** key ever reach a client:

```
# site/.env.local   (site Team login + DeskDev at /workspace)
NEXT_PUBLIC_SUPABASE_URL=https://rgasjotvqwkjbeivlhvn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

# mobile/.env       (Expo)
EXPO_PUBLIC_SUPABASE_URL=https://rgasjotvqwkjbeivlhvn.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

With both unset, each app runs in local mode (per-device demo data, no sync).
The `service_role` key never goes into a client or into the site Worker:
anon reads go through column grants and RLS, privileged work goes through
secret-gated RPCs or Edge Functions.

## Permissions model

- Roles: `admin`, `member` (`profiles.role`). A deactivated profile
  (`deactivated_at`, 032) passes nothing.
- `profiles.permissions` is a JSONB map of feature → `none | view | edit`
  (`view` is satisfied by `edit`). Features: `projects`, `tasks`, `clients`,
  `crm`, `calendar`, `meetings`, `growth`, `courses`, `showcase`.
- Admins implicitly pass everything, plus Settings. Showcase publishing is
  admin-only even with `showcase:edit` (037's guard trigger), and so is
  recording a client's showcase consent (`clients.showcase_consent`). With
  auto-publish on, an item goes live only through
  `showcase_record_link_check()` (service role, the link checker), never from
  the project trigger.
- Home, Notifications, Chat and Channels are open to every signed-in profile;
  RLS still scopes each row (a chat is visible only to its participants).
- Role / permission changes are blocked for non-admins by a trigger on
  `profiles`, and every change lands in `audit_log` (032).

## Notes

- **Vault (008, 021, 022, 030, 031):** zero-knowledge; the server stores only
  ciphertext. Opening it needs a TOTP factor (aal2, enforced in RLS since 030)
  plus a master password that never leaves the device. A reset archives and
  needs the owner's approval (`vault-reset`); recovery: `VAULT-RECOVERY.md`.
- **Realtime** respects RLS: each client only receives rows it may read.
- **Cron jobs** (pg_cron, all idempotent): chat purge (020), automation-run
  purge and n8n keep-alive (026/028), lead SLA sweep / follow-ups / intake
  attempts purge (035), retention (039), Google sync retry (040).
