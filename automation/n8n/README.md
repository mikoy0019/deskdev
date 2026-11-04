# n8n workflows: deskdev

The `[deskdev]` workflows, exported in a canonical, instance-independent form. They run on
https://nixgen-n8n-8gp7.onrender.com; [`../README.md`](../README.md) is the runbook and
[`scripts/n8n.mjs`](../../scripts/n8n.mjs) moves them between git and the instance. Edit in the
n8n UI, then `node scripts/n8n.mjs pull` and compare, or edit here and `push`. Either way, run
`node scripts/n8n.mjs check` before committing.

## Files

| File | Trigger | Shape |
|---|---|---|
| `overdue-tasks.json` | schedule, daily 08:00 | Recipients → Fetch (Supabase) → Build → Email → Label → Log run |
| `weekly-time-summary.json` | schedule, Monday 08:00 | Recipients → Fetch → Build → Email → Label → Log run |
| `daily-activity-digest.json` | schedule, daily 18:30 | Recipients → Completed Today → Hours Today → Build Digest → Send Email → Log run |
| `job-postings-finder.json` | schedule, daily 07:00 | Adzuna → OnlineJobs.ph → Normalize → Upsert → New postings → Sheets + (Recipients → Build digest → Email digest); Log run off the upsert |
| `lead-nudge.json` | schedule, daily 08:00 (**retired, keep inactive**: `automation_jobs.enabled = false`, migration 045) | Recipients → Settings → Fetch open leads → Build nudge (one item per owner) → Email nudge; Log run off the fetch |
| `new-client-alert.json` | `POST /webhook/deskdev-new-client` | Recipients → Fetch → Build → Email → Label |
| `log-to-sheets.json` | `POST /webhook/deskdev-log` | Enrich actor → Normalize → Filter ×5 → Sheets append (one tab per `table`; lead events: pipeline milestones only, no free text) |
| `task-assigned-email.json` | `POST /webhook/deskdev-task-assigned` | Lookup assignee → Lookup client → Build email → Send → Assignment row → Sheets append |
| `inbound-lead.json` | `POST /webhook/deskdev-lead-intake` (`{ lead_id }`, from migration 035's trigger) | Parse → Lead → Settings → Recipients → Prior auto-reply → Plan → Process? → (no) Log skipped / (yes) Auto-reply? → [Send auto-reply → Record auto-reply] → Team email → Sheet row → Sheets append → Log run |
| `vault-reset-code.json` | `POST /webhook/deskdev-vault-reset-code` | Lookup owner (vault_settings) → Build email → Send → Respond |
| `email-send.json` | `POST /webhook/deskdev-email-send` (`{ email_id }`, from 049's trigger and `email_retry`) | Parse → Claim (conditional PATCH queued → sending) → Original → Settings → Plan → Send? → Reply? → Reply in thread / Send new → Sent? → Mark sent → Log run; Failure → Mark failed → Log failed; Fail? → Log skipped |
| `email-inbound.json` | Gmail Trigger every 5 min + schedule, hourly | New mail → Normalize → Ingest (`rpc/email_ingest`, one call per message) → Summarize → Log run; Hourly → Check Gmail → Heartbeat → Log run |
| `ops-alert.json` | `POST /webhook/deskdev-ops-alert` (`{ subject, text }`, from the watchdog Worker and the nightly backup workflow) | Recipients (active admins; a failed read falls through) → Build (plain text, capped; company inbox when no admin is readable) → Email |
| `error-handler.json` | Error Trigger | Build → Log error → Throttle (1 email per job per hour) → Alert |

Every webhook uses Header Auth (`x-webhook-secret`, credential `DeskDev Webhook Secret`); every
workflow except the handler names `__DESKDEV_ERROR_WORKFLOW__` as its error workflow, which push
replaces with the live id. Timezone `Asia/Manila`, execution order v1.

## Placeholders

Nothing instance-specific is stored here. Credential references carry a placeholder id and the
credential's name; the instance's real ids never enter git.

| Placeholder | Credential |
|---|---|
| `__SUPABASE_CRED__` | `Supabase — DeskDev` (supabaseApi, project `rgasjotvqwkjbeivlhvn`, service role) |
| `__DESKDEV_WEBHOOK_CRED__` | `DeskDev Webhook Secret` (httpHeaderAuth) |
| `__ADZUNA_CRED__` | `Adzuna API key` (httpQueryAuth) |
| `__GMAIL_CRED__` | `Gmail account` (gmailOAuth2) |
| `__GOOGLE_SHEETS_CRED__` | `Google Sheets account` (googleSheetsOAuth2Api) |
| `__DESKDEV_ERROR_WORKFLOW__` | the `[deskdev] error-handler` workflow id |

Importing a file by hand through the n8n UI still works, but every placeholder then shows as a
missing credential. `scripts/n8n.mjs push` is the supported path.

## Notes

- **No workflow names a person.** Every Gmail node computes `sendTo` from the **Recipients**
  node (`profiles`, read with the service role): admins, `clients: edit` or `growth: edit`
  members, or a lead's owner, skipping anyone with `deactivated_at` set (migration 032) or
  without one usable address. Only when nobody qualifies does mail go to the company inbox.
  `check` fails on a literal `sendTo`. The error handler is the one exception, on purpose: it
  must alert while the database is the thing that is failing.
- **`inbound-lead` never writes a lead.** `intake_site_lead` (migration 034) stores, dedupes,
  scores and assigns it; this workflow only reads it back and adds the side effects. The
  prospect's auto-reply goes out only while `workspace_settings.growth_auto_reply` is on, and
  each one is recorded as an `auto_reply_sent` row in `lead_activity` (REST, service role), which
  also stops a second reply on a replay. Every run logs `ok` or `skipped` in `automation_runs`.
- **`lead-nudge` is retired** in favour of `lead_followups_due()` (migration 035), the in-app
  digest per owner. It is kept, rewritten per owner, so it can come back as an email channel.
  Migration 045 pauses its `automation_jobs` row, so health no longer reports it stale.

- The Supabase calls use the service role, because the digests read across all users. The key
  lives only in n8n's credential store.
- `log-to-sheets` runs on every task, notification, EOD report and lead event. Its failures
  are logged one by one, but alert at most once an hour.
- Gmail **Label** steps continue on error: the label id is specific to one Google account.
- `email-send`'s two Gmail steps continue on error too, on purpose: **Sent?** routes a refusal
  to **Failure**, which marks the email `failed` with a reason scrubbed of addresses.
- `email-inbound` logs counts only. Message text and addresses go to `email_ingest` and nowhere
  else; the database keeps them only for senders DeskDev already knows.
- Gmail's send step outputs the Gmail API response, not its input. A step after it that needs
  the row (task-assigned's **Assignment row**) rebuilds it from the node before the send.
- Every Code node that puts database text into an HTML email escapes it (`esc`), and every
  Sheets append writes `RAW`; `check` enforces the second.
