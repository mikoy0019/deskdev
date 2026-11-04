# google-calendar: Team Calendar sync (C1), personal calendar feeds (C1b) and the booking page

One-way sync from DeskDev events to one shared **"NixGen Team"** calendar on the company Google
account, plus a secret `.ics` URL per person ("see DeskDev in my own calendar", no Google scope),
plus the public booking page's two server calls (`slots`, `book`; migration 048, below).
Schema and every database rule: `supabase/migrations/040_google_workspace_calendar.sql`. The
company grant is connected by the `google` function (purpose `workspace`, admins only, see
`../google/README.md`) and read through the shared token module (`../_shared/google_grants.ts`,
`accessTokenForWorkspace`).

## How a change reaches Google

```
events / event_attendees write (app, any device)
  └─ trigger google_calendar_events_guard / event_attendees_queue_sync
       ├─ only a change Google shows (title, time, zone, repeats, place, link, Meet, guests)
       ├─ google_sync_outbox: at most ONE pending row per event (10 quick edits = 1 push)
       └─ google_calendar_kick(): pg_net POST {action:'drain'} after commit, once per transaction,
          only while google_workspace_link.status = 'active' and both Vault secrets exist
google-calendar function (this folder)
  └─ worker.ts drain(): google_sync_claim → push the event AS IT IS NOW → google_sync_complete
cron 'google-calendar-retry' (every 2 min)
  └─ stale claims (> 10 min) due again, backoff rows due, old rows purged, kick when anything is due
```

- **Deterministic ids.** Google stores DeskDev event `<uuid>` as `dd<uuid hex>` (base32hex-safe;
  `googleEventId()` in `mapping.ts` and `google_calendar_event_id()` in SQL). A retried insert
  after a lost response answers 409 and becomes an update: guests never get a second invitation.
- **Loop guard.** The worker writes back (event id, etag, Meet link, sync status) only through
  `google_sync_complete()`, which sets `deskdev.google_sync = 'on'` for its transaction; the
  triggers return early when they see it. Clients can never write the bookkeeping columns
  (`google_event_id`, `google_etag`, `sync_status`, `sync_error`, `origin`): the trigger puts back
  the old values.
- **Guests are only emailed for material changes.** `sendUpdates=all` for a new event with guests,
  a change of time / repeats / zone of a series / title / place / guest list / Meet, a deleted
  event coming back, and a delete. A description or typo fix goes out with `sendUpdates=none`.
- **Time zones.** Timed events carry their IANA zone (`events.timezone`, else the team calendar's
  zone, else `workspace_settings.growth_business_hours.tz`, else UTC), so Google expands a weekly
  09:00 at 09:00 across DST. All-day events are `date` values with an exclusive end. `UNTIL` is the
  end of that local day. A monthly event on the 29th–31st skips short months on Google (RFC 5545).
- **Meet.** `add_meet` sends a `conferenceData.createRequest` (`conferenceDataVersion=1`); the
  join URL Google makes is written into `events.meeting_link` only when that field is empty.
  Switching Meet off removes it on Google and clears a Meet link DeskDev wrote.
- **What guests see.** Title, description, place, times, join link. Never notes, colour, the
  client link, or the word DeskDev (the DeskDev id travels in `extendedProperties.private`).
- **Retries.** Transient failures (429, 5xx, 412 etag race, network) back off 1, 2, 4 … minutes,
  capped at 6 hours; the 10th failure, or a content error Google refuses (400), is final
  (`status='failed'`, the event shows `sync_status='error'` with a short reason). Admins re-queue
  the last 7 days of failures with `google_calendar_retry_failed()` ("Retry failed").
- **Revoked grant.** Google answering `invalid_grant` (password reset, access removed, consent
  screen left in Testing) or a missing calendar scope sets `google_workspace_link.status =
  'revoked'` (the row and calendar id are kept), notifies every active admin once (type `system`)
  and writes an `audit_log` row `google.workspace_revoked`. Edits keep queueing; reconnecting the
  same account in Settings → Integrations sends the backlog. Connecting a **different** account
  forgets the old calendar and pushes every synced event to the new one. An admin's own
  Disconnect clears the token and alarms nobody.
- **Calendar deleted in Google.** The next push notices (404 on the calendar), forgets it and
  re-queues every synced event; the run after that creates a fresh "NixGen Team" calendar.

## The app's side (RPCs and columns)

| What | For |
|---|---|
| `events.timezone`, `sync_google`, `add_meet` | the user's switches (writable like any event column) |
| `events.google_event_id`, `google_etag`, `sync_status` (`pending`/`synced`/`error`/NULL), `sync_error`, `origin` | read-only sync chip |
| `event_attendees` (`event_id`, `profile_id`, `email`, `display_name`, `optional`, `response_status`) | guest picker; same edit rights as the event; `response_status` is Google's (read-only) |
| `google_workspace_status()` | admins: `{status, googleEmail, calendarReady, calendarTimeZone, connectedAt, revokedAt, revokedReason, lastSyncAt, lastError, pending, failed}`; calendar viewers: `{status}`; others NULL |
| `google_calendar_retry_failed()` | admins: re-queue failed pushes, returns the count |
| `calendar_feed_rotate(p_scope 'mine'|'all')` | returns the feed token ONCE (64 hex); revokes the previous one |
| `calendar_feed_status()` / `calendar_feed_revoke()` | `{active, scope, hint, createdAt, lastUsedAt}` / turn the feed off |
| `googleTemplateUrl(event)` in `mapping.ts` | "Add to Google Calendar" link for one event (no scope) |

Feed URL to show after a rotate: `https://<ref>.supabase.co/functions/v1/google-calendar/feed/<token>.ics`
(`webcal://` with the same host and path for one-click subscribe on Apple devices). Scope `mine` =
events the person created or is invited to; `all` = everything they can see in DeskDev. The feed
covers 60 days back to 400 days ahead, drops meeting notes and colours, and stops working at once
when the token is rotated or revoked, the person loses calendar/meetings access, or is
deactivated. Only the SHA-256 of the token is stored.

## The booking page (migration 048)

The site's Worker (`nixgensolutions.com/book`, `site/src/lib/booking.ts`) asks this function for
free `slots` and `book`s one. A booking is recorded by `booking_record` (048: the visitor's open
lead or a new one, the meeting, its guests, the notification) and pushed to Google straight away
through the same worker as a drain, so Google emails the customer the invitation with the Meet
link. The decisions (slots, recurrences, the request checks) live in `logic.ts`, tested by the
site's Vitest suite (`site/src/deskdev/pwa/googleCalendarLogic.test.ts`); `index.ts` does the I/O.

Every POST is server-to-server: no CORS headers are sent and a POST carrying an `Origin` header
is refused (403), so a browser can't call it even with a secret. The header picks the action:

| Action | Auth | Body | Answer |
|---|---|---|---|
| `drain` | `Authorization: Bearer <GOOGLE_CALENDAR_WEBHOOK_SECRET>` | `{action:'drain'}` (or empty) | `{status, processed, done, retried, failed, calendarId}` |
| `slots` | `x-booking-secret: <BOOKING_API_SECRET>` | `{action:'slots'}` | `{ok:true, tz, minutes, title, days:[{date, slots:[ISO]}], google}` or `{ok:false, reason:'disabled'}` |
| `book` | `x-booking-secret` | `{action:'book', start, name, email, company?, phone?, notes?, customer_tz?, ip_hash?}` | `{ok:true, start, end, title, meetUrl, invited}` or `{ok:false, reason}` |

- `google` in `slots`: `checked` (the account's own calendar was read through free/busy, plus the
  team calendar), `team_only` (only the team calendar: free/busy not granted yet), `not_connected`
  (no active grant: slots come from DeskDev alone, and bookings get no Google event or invite).
- `book` reasons: `disabled`, `invalid`, `slot_taken` (no longer offered, or taken by a racing
  booking), `throttled`, `unavailable`. Business refusals answer HTTP 200 with `ok:false`;
  `unavailable` (Google or the database could not answer, or `BOOKING_API_SECRET` is missing or
  shorter than 32 characters) answers **503** `{ok:false, reason:'unavailable'}`; a wrong secret
  answers 401.
- `invited` is true when the meeting goes to Google with the customer as a guest (Google sends the
  invitation, immediately or on the kick's retry if the inline push ran out of its 4-second
  budget). `meetUrl` is set when the Meet link already exists; otherwise it arrives in the
  invitation.
- Free slots: every business day (`workspace_settings.growth_business_hours`, in its time zone)
  from now + `booking_notice_minutes` to `booking_days_ahead` days ahead, every `booking_minutes`,
  ending by closing time, at least `booking_buffer_minutes` from anything busy. Busy = Google
  free/busy ∪ DeskDev timed events that are website bookings, created by the host, or have the
  host as a guest (recurrences expanded the way the app does; 048's `booking_overlaps` applies the
  same rule under the booking lock). When Google can't answer, `slots`/`book` answer
  `unavailable` rather than risk a double booking.
- Monthly repeats on the 29th–31st: DeskDev's busy times step like the browser's `setMonth`
  (Jan 31 → Mar 3), Google follows RFC 5545 (skips short months). Daily and weekly match exactly.

**Free/busy is optional.** The `workspace` connection also requests `calendar.freebusy` (busy/free
times only, never event details) so the booking page can avoid the account's own appointments. An
existing connection keeps working, and `slots` reports `team_only` until an admin presses Connect
again in Settings → Integrations and leaves the box ticked. The `google` function's `status` shows
`workspace.freebusyGranted`. Check how the Cloud Console classifies `calendar.freebusy` on the
consent screen page: if it is marked sensitive, Google shows the "unverified app" screen to the
admin until the app is verified; one company account can click through it, and nothing else
changes.

## Runbook (owner)

Prerequisites: the `google` function and its secrets (`../google/README.md` §5), the DeskDev OAuth
client with `calendar.app.created` on its consent screen, the **Google Calendar API** enabled in
the DeskDev project, and migrations 032, 033 and 040 applied.

**Steps 1 and 3 are done by `node scripts/setup-integrations.mjs --only google`** (run it with
`--dry-run` first; it is safe to run again). The secret is generated inside the Vault, sent to the
function, and the URL row is written only after the function has accepted it. Status on
`rgasjotvqwkjbeivlhvn` (2026-10-04): steps 1 to 3 are done. Nothing calls the function until
step 4, because the kick returns unless a company account is connected. To pause sync later, delete
the `deskdev_google_calendar_url` row; `--only google --resume-calendar` writes it again. The manual
commands below stay as the reference.

1. **Webhook secret** (shared by the database and this function, at least 32 characters):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   supabase secrets set GOOGLE_CALENDAR_WEBHOOK_SECRET=<that value>
   ```
   The function also uses `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (provided by Supabase) and the `google` function's `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_KEYS` / `GOOGLE_TOKEN_KEY_ID` (same project
   secrets, nothing new).
2. **Deploy without JWT verification** (pg_net, the site Worker and calendar apps carry no Supabase
   JWT; the drain checks the Bearer secret, the booking calls their `x-booking-secret`, the feed
   its token):
   ```bash
   supabase functions deploy google-calendar --no-verify-jwt
   ```
3. **Vault entries** (SQL editor, as postgres). Until both exist the kick does nothing and the
   outbox simply waits:
   ```sql
   SELECT vault.create_secret('https://rgasjotvqwkjbeivlhvn.supabase.co/functions/v1/google-calendar', 'deskdev_google_calendar_url');
   SELECT vault.create_secret('<GOOGLE_CALENDAR_WEBHOOK_SECRET>', 'deskdev_google_calendar_secret');
   ```
4. **Connect the company account**: an admin signed in to DeskDev → Settings → Integrations →
   Team Calendar → Connect, choosing the company Google account and ticking the calendar
   permission. The first push creates the "NixGen Team" calendar in that account; share it with
   the team from Google Calendar (Settings → the calendar → Share with specific people).
5. **Check**: `SELECT public.google_workspace_status();` as an admin, and
   `supabase functions logs google-calendar`. `SELECT * FROM google_sync_outbox ORDER BY id DESC
   LIMIT 20;` shows each push and its last error.

Rotating the webhook secret: set the new value with `supabase secrets set`, then
`SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'deskdev_google_calendar_secret'), '<new>');`.
Pushes kicked in between fail with 401 and are picked up by the 2-minute cron.

### The booking page

Needs migration 048 applied and the sync above working (a booking without an active grant is
still recorded, but gets no Google event or invite).

Status on `rgasjotvqwkjbeivlhvn` (2026-10-07): 048 applied, this function redeployed with the
`slots` / `book` actions, and `BOOKING_API_SECRET` set on the function and on the `nixgen-site`
Worker (same value, generated in memory, never printed). `/api/booking/slots` answers
`{ok:false, reason:'disabled'}`: step 2 (turning the page on) waits until the company account is
connected (step 4 above), so the first bookings already carry a Meet link.

1. **Booking secret** (shared by this function and the site Worker, at least 32 characters):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   supabase secrets set BOOKING_API_SECRET=<that value>
   npx wrangler secret put BOOKING_API_SECRET --name nixgen-site   # the same value
   ```
2. **Turn the page on**: an admin, in DeskDev Settings, Growth → booking page (on/off, title,
   length, notice, days ahead, buffer, host: `workspace_settings.booking_*`).
3. **Try it**:
   ```bash
   URL=https://rgasjotvqwkjbeivlhvn.supabase.co/functions/v1/google-calendar

   # Free slots (what /api/booking/slots does):
   curl -s -X POST "$URL" -H "x-booking-secret: $BOOKING_API_SECRET" \
     -H 'Content-Type: application/json' -d '{"action":"slots"}'

   # Book the first offered slot (use a real address you own: Google emails it):
   curl -s -X POST "$URL" -H "x-booking-secret: $BOOKING_API_SECRET" -H 'Content-Type: application/json' \
     -d '{"action":"book","start":"<an ISO start from slots>","name":"Test Person","email":"you@example.com"}'
   ```

## Tests

```bash
node --test "supabase/functions/google-calendar/*.test.ts"   # Node 22.6+ (strips the types)
```

`mapping.test.ts` (event mapping, RRULE, zones, Meet, material changes, errors), `worker.test.ts`
(the drain loop against an in-memory Google: deterministic ids, 409 recovery, sendUpdates, RSVPs,
retries, revoked grant, lost calendar, budget) and `ics.test.ts` (iCalendar output, VTIMEZONE,
folding). The SQL side was tested on PGlite with real RLS (outbox, loop guard, worker RPCs,
backoff, grant lifecycle, attendees, feed tokens).

The booking page's `logic.ts` (slots across DST, busy subtraction, recurrence parity with
DeskDev, the book request) is tested by the site's Vitest suite:
`site/src/deskdev/pwa/googleCalendarLogic.test.ts`.
