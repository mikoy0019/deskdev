# Backup and restore

DeskDev's database (Supabase project `rgasjotvqwkjbeivlhvn`) is backed up every
night to Cloudflare R2, encrypted, outside Supabase. This is the copy that
survives a lost Supabase account, a deleted project or a bad migration that
Supabase's own backups can no longer undo.

| | |
|---|---|
| What | `supabase db dump`, Supabase's documented backup: roles, the schema of the project's own schemas (`public` and friends; Supabase-managed schemas come with any new project), and the data, including `auth.users` |
| When | 03:00 Asia/Manila (19:00 UTC), `.github/workflows/db-backup.yml` |
| Where | R2 bucket `nixgen-db-backups`, `nightly/YYYY/MM/DD/<stamp>/` |
| Encryption | [age](https://age-encryption.org), public key in CI, private key **offline only** |
| Kept | 35 days (bucket lifecycle rule) |
| RPO / RTO | up to 24 h of data / about 2 h to a working restore |
| Scripts | `scripts/backup/backup.mjs`, `scripts/backup/restore.mjs` (tests: `node --test scripts/backup/*.test.mjs`) |

**Not in the dump**, so not in this backup:
- **Storage files** (showcase screenshots, the `showcase` bucket). Only their
  `storage.objects` rows are dumped. Screenshots can be recaptured from the
  live sites (the showcase screenshot backfill); nothing else lives in
  Storage today.
- **Vault secret values** (`vault.secrets`) come back as ciphertext that only
  the original project can decrypt. A restore into another project must
  re-create them (step R5).
- **Edge function secrets, Worker secrets, n8n credentials**: they live in
  their own dashboards, never in the database.

Supabase's own backups still matter: on the Pro plan they give daily
snapshots and point-in-time recovery inside the same project, which is the
fastest fix for "undo the last few hours". Use this R2 copy when the project
itself is the problem, or for a drill.

---

## 1. One-time setup (owner)

### 1.1 Encryption keys

On your own computer (not a server, not CI):

```bash
# winget install FiloSottile.age   |   brew install age   |   apt install age
age-keygen -o nixgen-backup.key
# prints: Public key: age1...
```

- The file `nixgen-backup.key` is the **private key**. Store it in the
  password manager (as a secure note) **and** on one offline USB stick. It
  never goes into GitHub, R2, n8n, Supabase or this repository. Without it the
  backups cannot be read by anyone, including you.
- Make a second key the same way for a break-glass holder (a co-founder, a
  sealed envelope). Every backup is encrypted to every listed public key, so
  either key can restore.
- The two `age1…` public keys are not secrets.

### 1.2 R2 bucket and lifecycle

Cloudflare dashboard → R2 → **Create bucket** `nixgen-db-backups` (private,
location hint Asia-Pacific). Then, from any folder with Wrangler:

```bash
npx wrangler r2 bucket lifecycle add nixgen-db-backups expire-35d nightly/ --expire-days 35
npx wrangler r2 bucket lifecycle add nixgen-db-backups abort-uploads "" --abort-multipart-days 1
npx wrangler r2 bucket lifecycle list nixgen-db-backups
```

Optional but recommended: R2 → the bucket → Settings → **Bucket lock** rule on
prefix `nightly/` with a 7-day retention. Then even a leaked backup key cannot
delete the last week of backups.

### 1.3 R2 API tokens

R2 → **Manage API tokens** → Create:
1. `deskdev-backup-write`: **Object Read & Write**, *this bucket only*. Goes to
   GitHub (below). The script cannot change the lifecycle with it, by design.
2. `deskdev-backup-read`: **Object Read only**, this bucket only. Keep it in
   the password manager for restores.

### 1.4 Database connection string

Supabase dashboard → **Connect** → *Session pooler* (port 5432). Copy the URI
and put the database password into it. Use the pooler, not the direct
`db.<ref>.supabase.co` host: GitHub runners have no IPv6. When the database
password is rotated, update this secret the same day.

### 1.5 GitHub settings

Repository → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| secret | `SUPABASE_BACKUP_DB_URL` | the session pooler URI |
| secret | `R2_BACKUP_ACCESS_KEY_ID` | from token 1 |
| secret | `R2_BACKUP_SECRET_ACCESS_KEY` | from token 1 |
| secret | `N8N_WEBHOOK_SECRET` | optional: failure alert through n8n |
| variable | `BACKUP_AGE_RECIPIENTS` | both `age1…` public keys, space separated |
| variable | `R2_ACCOUNT_ID` | `5c6cabb0e7c2e306c3dd792599736a46` |
| variable | `R2_BACKUP_BUCKET` | `nixgen-db-backups` (the default) |
| variable | `N8N_ALERT_URL` | optional: `https://nixgen-n8n-8gp7.onrender.com/webhook/deskdev-ops-alert` |
| variable | `DB_BACKUP_ENABLED` | `true`, **last**, after the checks below |

### 1.6 Prove it, then switch it on

1. Actions → *Database backup* → **Run workflow** with *dry run* ticked. It
   runs the script tests, installs age, encrypts a synthetic dump to your keys
   and prints the R2 requests it would make. Nothing is read or uploaded.
2. Set `DB_BACKUP_ENABLED=true`, then **Run workflow** with *dry run*
   unticked. Check the run summary and R2: one folder under `nightly/` with
   `roles.sql.gz.age`, `schema.sql.gz.age`, `data.sql.gz.age` and
   `manifest.json`.
3. Do drill section 3 once against that first backup. A backup nobody has
   restored is a hope, not a backup.

---

## 2. Every night (automatic)

The workflow dumps, compresses, encrypts and uploads; the plaintext dump only
ever exists on the throwaway runner and is deleted as soon as it is encrypted.
`manifest.json` is written last, so a folder without one is an interrupted run
and is ignored by restores. The script also reads the bucket's lifecycle and
warns in the log if the 35-day rule is missing.

If a night fails, GitHub emails whoever last edited the workflow, and (when
`N8N_ALERT_URL` + `N8N_WEBHOOK_SECRET` are set) the ops inbox gets a
"[NixGen] Nightly database backup FAILED" email through n8n. Common causes:
the database password changed (update `SUPABASE_BACKUP_DB_URL`), the project
is paused, or the R2 token was rolled.

---

## 3. Quarterly restore drill (owner or an admin, about 45 minutes)

Restore into something that is **not** production: a scratch Supabase project
(the free org allows two active projects) or a local Postgres from
`supabase start`. `restore.mjs` refuses the production project.

```bash
# R5 below needs these too if the target is a new Supabase project.
export R2_ACCOUNT_ID=5c6cabb0e7c2e306c3dd792599736a46
export R2_ACCESS_KEY_ID=...        # deskdev-backup-read
export R2_SECRET_ACCESS_KEY=...
export BACKUP_AGE_IDENTITY_FILE=/path/to/nixgen-backup.key
export RESTORE_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'   # local supabase start

node scripts/backup/restore.mjs list
node scripts/backup/restore.mjs fetch --latest --out ./restore-drill
node scripts/backup/restore.mjs apply --dir ./restore-drill --dry-run   # shows the psql command
node scripts/backup/restore.mjs apply --dir ./restore-drill
```

`fetch` checks every file's size and SHA-256 against `manifest.json` before it
decrypts anything, so a corrupted or swapped file stops the restore. `apply`
loads roles, schema, then data in one transaction with
`session_replication_role = replica`, so triggers (notifications, n8n posts)
do not fire for restored rows; any error rolls the whole thing back.
The sign-up guard on `auth.users` (migration 042) does not block a restore
for the same reason, and an operator session as `postgres` is exempt from it
anyway.

Verify (psql or the scratch project's SQL editor):

```sql
SELECT count(*) AS users FROM auth.users;
SELECT count(*) AS profiles, count(*) FILTER (WHERE deactivated_at IS NULL) AS active FROM public.profiles;
SELECT count(*) AS clients FROM public.clients;
SELECT count(*) AS projects FROM public.projects;
SELECT count(*) AS leads, max(created_at) AS newest_lead FROM public.leads;
SELECT max(at) AS newest_audit FROM public.audit_log;
-- RLS survived the round trip (expect no rows):
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
-- Both triggers on auth.users are there and enabled (expect on_auth_user_created
-- and signup_guard, both 'O'; see R4a if one is missing):
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
```

Compare the counts with production's (same queries, read-only) allowing for a
day of changes, and confirm `newest_lead` is from the night of the backup.
Then **delete `./restore-drill`** (it is plaintext client data) and the
scratch database, and add a line to the drill log below.

### Drill log

| Date | Backup used | Target | Result | By |
|---|---|---|---|---|
| | | | | |

---

## 4. Real disaster recovery

Decide first which kind of disaster it is:

| Situation | Use |
|---|---|
| Bad change in the last days, project healthy | Supabase dashboard → Database → Backups / PITR (Pro), into a **new** project first if unsure |
| Vault "Reset & start over" undone | `supabase/VAULT-RECOVERY.md` (the R2 backups from before the reset work as its "backup") |
| Project deleted, account lost, Supabase region down | this runbook, into a new project |

Recovery into a new project:

- **R1.** Create the project (same region), note its ref, set a strong DB password.
- **R2.** `restore.mjs fetch --latest` (or `--run` a specific night from `list`).
- **R3.** `RESTORE_DATABASE_URL` = the new project's session pooler URI, then `restore.mjs apply`.
- **R4.** Check cron jobs: `SELECT jobname, schedule FROM cron.job;`. If any are
  missing, re-run the scheduling blocks of migrations 020, 024, 026, 028, 035, 039, 040 and 041
  (each is idempotent).
- **R4a.** Check the two triggers on `auth.users` (the query at the end of the
  section 3 verify block). Supabase restores changes to the `auth` schema,
  triggers included, separately from the rest, so in a new project they can be
  missing. Without `on_auth_user_created` a new user gets no profile; without
  `signup_guard` anyone can make an account if sign-ups are on. Re-create them
  by running the trigger block of `001_profiles_roles.sql` and the whole of
  `042_signup_guard.sql` (both are safe to run again).
- **R5.** Re-create the Vault secrets (values from the password manager / their
  dashboards): `n8n_webhook_secret`, `n8n_base_url`, `lead_intake_secret`,
  `deskdev_push_function_url`, `deskdev_push_secret`,
  `deskdev_google_calendar_url`, `deskdev_google_calendar_secret`.
- **R6.** Edge functions: deploy all of them to the new ref and set their secrets
  (`APP_ORIGINS`, `GOOGLE_*`, `VAPID_*`, `PUSH_WEBHOOK_SECRET`,
  `N8N_WEBHOOK_SECRET`, `N8N_VAULT_RESET_WEBHOOK`).
- **R7.** Auth settings: `docs/runbooks/AUTH.md` (Site URL, redirect URLs, SMTP,
  sign-ups off, MFA).
- **R8.** Point everything at the new ref: GitHub production variables
  `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` then redeploy the site; Worker secret
  `LEAD_INTAKE_SECRET` stays; n8n's "Supabase — DeskDev" credential; the
  watchdog's `SUPABASE_URL` var and `SUPABASE_ANON_KEY` secret; this workflow's
  `SUPABASE_BACKUP_DB_URL`.
- **R9.** Everyone signs in again (sessions do not survive a new project's JWT
  secret). Vault data comes back intact: it is encrypted client-side and the
  rows were restored as they were.

Restoring over the **live** project with these scripts is deliberately
awkward: `apply --allow-production` plus `RESTORE_CONFIRM=rgasjotvqwkjbeivlhvn`.
It replaces everything written since the backup. Only do it when the live data
is already lost.

### pg_dump fallback

`backup.mjs --tool pg_dump` writes one custom-format archive (`full.dump`)
instead of the three SQL files, for when the Supabase CLI is unavailable.
Restore it selectively with `pg_restore --data-only --schema=public …` into a
project that already has the schema (apply the migrations first).
`restore.mjs fetch` still verifies and decrypts it; `apply` points here.

## 5. Rotating things

- **age key lost or exposed:** make a new pair, replace `BACKUP_AGE_RECIPIENTS`,
  keep the old private key until the last backup made with it has expired (35 days).
- **R2 token:** roll it in R2, update the two GitHub secrets.
- **Database password:** update `SUPABASE_BACKUP_DB_URL` the same day, or the
  next night fails (and alerts).
