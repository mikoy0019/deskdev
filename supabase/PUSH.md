# Web Push for DeskDev

Background notifications for DeskDev: a chat message, an @mention, a task assignment or a due reminder
shows up as a system notification on the phone or desktop even when DeskDev is closed. Tapping it opens
the right screen inside the installed app. Push also sets the number on the app icon.

Nothing here is switched on until you follow the runbook below. Applying migration 029 before that does
no harm: its triggers do nothing until the two Vault secrets exist, and they can never make an insert fail.

## What gets pushed

| Event | Who receives it | Category (Settings → Notifications) | Tap opens |
|---|---|---|---|
| New chat message (`messages` insert) | every member of the conversation except the sender | Direct messages | `/messages/<conversation>` |
| `channel_mention` notification | the person mentioned or replied to | Mentions & replies | `/channels/<channel>` |
| `task_assigned`, `task_updated` | the recipient | Tasks | `/tasks?task=<id>` |
| `due_reminder` | the recipient | Due reminders | the task, `/meetings` or `/calendar` |
| `lead_new`, `lead_sla`, `lead_followup`, `lead_assigned` (033) | the recipient (Growth viewers only) | Leads (on by default) | `/growth/leads?lead=<id>` |
| every other notification type, including `showcase_ready` | the recipient | Workspace updates (off by default) | same link as the in-app notification |
| Settings → "Send test push" | the signed-in user's own devices | none (always sent) | `/notifications` |

The rules match the in-app popups. Rows inserted already read are skipped, and so are your own actions
echoed back to you (except due reminders, which your own device files for you). The title, body and link
are the ones the bell shows (`lib/notifications.ts`, `useMessageNotifications.ts`). Chat bodies are cut to
140 characters, and a group chat is titled "Sender · Group". Plain channel messages are not pushed;
only mentions and replies are.

## How it works

```
 browser / installed app                     Supabase                                push services
 ───────────────────────                     ────────                                ─────────────
 pushManager.subscribe(VAPID public key)
   └─ rpc upsert_push_subscription ───────▶  push_subscriptions (RLS: own rows)
                                               ▲ service role reads
 user sends a chat line / a notification row   │
   └─ INSERT messages / notifications ──────▶  AFTER INSERT trigger (migration 029)
                                               └─ push_dispatch(): reads Vault
                                                   deskdev_push_function_url + deskdev_push_secret
                                                   pg_net POST {type, record:{id}}  (after commit)
                                                          │  Authorization: Bearer <secret>
                                                          ▼
                                               Edge Function send-push
                                               ├─ re-reads the row (service role)
                                               ├─ recipients → their subscriptions → filter by category
                                               ├─ push_badge_count() per recipient
                                               ├─ Declarative Web Push JSON, < 4 KB
                                               ├─ RFC 8291 encryption + VAPID JWT ─────────▶  FCM (Chromium)
                                               │   TTL / Urgency / Topic headers              web.push.apple.com
                                               │                                              Mozilla autopush
                                               └─ 2xx: last_success_at   404/410: delete row  WNS (Edge, Windows)
                                                  other: failure_count + 1                         │
                                                                                                    ▼
 iOS 18.4+: the OS shows it (declarative)  ◀───────────────────────────────────────────────  the device
 everything else: service worker push handler (site/src/deskdev/pwa/sw/sw.js) → showNotification
```

| Piece | File |
|---|---|
| Table, RPCs, badge count, triggers | `supabase/migrations/029_push_subscriptions.sql` |
| Edge Function (HTTP, auth, I/O) | `supabase/functions/send-push/index.ts` |
| Who and what (pure, unit-tested) | `supabase/functions/send-push/logic.ts` |
| Encryption + VAPID on WebCrypto (tested against RFC 8291's example) | `supabase/functions/send-push/webpush.ts` |
| Tests | `site/src/deskdev/pwa/sendPushLogic.test.ts` |
| Key generator | `site/scripts/generate-vapid-keys.mjs` |
| Client (subscribe, settings UI, test button) | `site/src/deskdev/pwa/push.ts` |
| Service worker push and click handling | `site/src/deskdev/pwa/sw/sw.js` |

### Decisions

- **Deploy with `--no-verify-jwt`.** The triggers authenticate with a shared secret, not a JWT, so the
  gateway's JWT check would reject them. The function does its own checks instead: the trigger secret is
  compared in constant time (SHA-256 of both sides first), and the test push verifies the caller's JWT
  with `supabase.auth.getUser`. A signed-in user can only call `{type:'test'}`, and it reaches only their
  own devices.
- **The trigger body is only a pointer.** The function re-reads the row with the service role, so even a
  leaked `PUSH_WEBHOOK_SECRET` can only re-send pushes for rows that exist. It cannot put words in a push.
  This also keeps message text out of `net._http_response`.
- **No Web Push library.** `npm:web-push` uses `node:crypto` `createECDH`, which has been reported missing
  on the Edge Runtime (Sept 2026), and its `sendNotification` goes through `node:https`.
  `jsr:@negrel/webpush` also runs on WebCrypto, but it ships no tests, wants JWK keys, and reuses one ECDH
  key pair for every message. `webpush.ts` is about 150 lines of WebCrypto with no imports. It reproduces
  RFC 8291's worked example byte for byte, and it uses a new ECDH key pair and salt for every message.
- **Endpoint allow-list.** Subscriptions are accepted only for the real push services
  (`fcm.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`,
  legacy `android.googleapis.com`, and FCM paths on Google hosts such as `jmt17.google.com/fcm/…`). Without the list, the function could be pointed at any URL. The list
  is in two places, `is_push_service_endpoint()` in 029 and `isPushServiceEndpoint()` in `logic.ts`.
  Change both together.
- **Payload.** The payload uses Declarative Web Push JSON (`web_push: 8030`, `mutable: true`). iOS/iPadOS
  18.4+ show it without running the service worker. Every other browser passes the same JSON to the
  service worker, which reads it too. `tag`, `renotify`, `timestamp` and `app_badge` are written both at
  the top level and inside `notification`, because WebKit, the Push API draft and DeskDev's contract
  disagree on where they go, and parsers ignore members they don't read.
- **Delivery hints.** Chat, mentions and leads: `TTL` 24 h, `Urgency: high`. Everything else: 72 h, `normal`.
  `Topic` is derived from the tag (≤ 32 URL-safe characters), so a phone that was offline gets the latest
  line of a chat instead of twenty.
- **VAPID JWT.** The JWT is reused for 11 h per push service while an isolate stays warm, and its `exp` is
  12 h ahead. Apple asks for at most one new token an hour, and it rejects an `exp` more than a day ahead.

## Enable it (runbook)

**Status: set up on `rgasjotvqwkjbeivlhvn` (2026-10-04) and proven end to end.** Delivery is on. What is
left is the production half of step 6, on the day the site goes live.

The supported way, safe to run again at any time:

```bash
node scripts/setup-integrations.mjs --dry-run      # what would change; changes nothing
node scripts/setup-integrations.mjs --only push
```

It does steps 1, 2, 5 and the local half of 6: it makes the key pair and saves it in the secrets file
before sending it anywhere, generates the webhook secret inside the Vault, sets the four function secrets,
waits until the function answers as configured and accepts that secret, and only then writes the URL row
that switches delivery on. It never makes a second key pair while one is in use, and it sends a secret
only when its value changed. The header of the script lists its flags and exit codes.

The steps below are the reference for what the script does, and the way to do it without the script.
**Do not run step 1 on a project that is already set up:** a new key pair cuts off every subscribed
device.

You need: the Supabase CLI logged in (`npx supabase login`), access to the project's SQL Editor (project
`rgasjotvqwkjbeivlhvn`), and access to the site's build settings. Every step below changes
production. Do them in this order.

1. **Generate keys** (once per project, from `site/`):

   ```bash
   node scripts/generate-vapid-keys.mjs --subject mailto:<an inbox someone reads>
   ```

   `--subject` must be a real `mailto:` address or an `https://` URL. Apple rejects anything else,
   including `@localhost`, with `403 BadJwtToken`. The script writes nothing to disk. It prints the four
   values and the exact commands for steps 2, 3, 5 and 6, so keep the output open until you finish.
   Running it again creates a different key pair, which orphans every existing subscription.

2. **Function secrets.** Run the `npx supabase secrets set … VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=…
   VAPID_SUBJECT=… PUSH_WEBHOOK_SECRET=…` command it printed. `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` come from the runtime.

3. **Deploy the function:**

   ```bash
   npx supabase functions deploy send-push --no-verify-jwt --project-ref rgasjotvqwkjbeivlhvn
   ```

   Check it: `curl -s -X POST https://rgasjotvqwkjbeivlhvn.supabase.co/functions/v1/send-push` should
   answer `401 Missing Authorization header`. A `500 Push is not configured.` means a secret is missing; the
   function log (Dashboard → Edge Functions → send-push → Logs) names it. The response never does.

4. **Apply migration 029.** Paste `supabase/migrations/029_push_subscriptions.sql` into the SQL Editor and
   run it (or `npx supabase db query --linked -f supabase/migrations/029_push_subscriptions.sql`; never
   `db push`, see supabase/README.md). It is re-runnable. It needs 001, 006,
   019 and 020 to be applied already.

5. **Vault secrets** (SQL Editor, as postgres). Run the two `select vault.create_secret(…)` lines the
   script printed: `deskdev_push_function_url` (the function URL) and `deskdev_push_secret` (the same value
   as `PUSH_WEBHOOK_SECRET`). From this moment, new notifications and chat messages call the function.

6. **Site env.** Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>` in `site/.env.local` (the script does
   this) and in the build environment that deploys the site: GitHub → Settings → Environments →
   `production` → Variables (`docs/runbooks/DNS-CUTOVER.md`), or the Workers Builds variables while that
   older hookup is still the one deploying. The value is `VAPID_PUBLIC_KEY` from the secrets file. Then
   rebuild and redeploy the site. `NEXT_PUBLIC_*` values are inlined at build time, so without a redeploy
   the app keeps reporting push as not configured.

7. **Verify.** On a device, open DeskDev. On iPhone/iPad, open the app installed to the Home Screen.
   Go to Settings → Notifications → turn on push → **Send test push**. A "DeskDev — Push notifications are
   working." notification should arrive within seconds. Then close the app, have someone send you a chat
   message, and tap the notification. It should open that conversation.

To check the database side without a device:

```sql
-- Did the triggers fire, and what did the function answer?
select id, status_code, left(content::text, 300) as body, error_msg, created
  from net._http_response order by created desc limit 20;

-- Subscriptions and their health
select user_id, platform, split_part(endpoint, '/', 3) as service, last_success_at, failure_count, updated_at
  from public.push_subscriptions order by updated_at desc;
```

Each successful call returns a JSON summary such as
`{"type":"message","recipients":2,"subscriptions":3,"sent":3,"gone":0,"failed":0}`, or a `skipped` reason.
To re-send one row by hand:

```bash
curl -s -X POST https://rgasjotvqwkjbeivlhvn.supabase.co/functions/v1/send-push \
  -H "Authorization: Bearer $PUSH_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"type":"notification","record":{"id":"<notification uuid>"}}'
```

## Platform notes

- **iPhone / iPad (iOS/iPadOS 16.4+):** push works only in the app added to the Home Screen, never in a
  Safari tab or an in-app browser (Instagram, Gmail …). Installs from Chrome or Edge on iOS work too.
  Permission must be requested from a tap. Each Home Screen icon has its own subscription, and deleting
  the icon deletes the subscription. iOS 18.4+ shows the declarative payload without running the service
  worker. Older versions run the worker, which must show a notification for every push, or Safari revokes
  the permission. The icon badge appears only after notification permission is granted.
- **Android:** works in Chrome, Edge, Samsung Internet, Firefox and Opera, both in a tab and in the
  installed app. The launcher shows a notification dot instead of a number.
- **Desktop:** Chrome, Edge, Firefox and Safari (macOS 13+) work in a tab or as an installed app. Desktop
  browsers usually deliver only while the browser process is running.
- **Several devices:** every subscribed device gets the push, including the one in your hand while
  DeskDev is open. The service worker decides whether to show it when a DeskDev window is focused.
- **Due reminders** are created by the app itself (`checkDueReminders`) while DeskDev is open on one of
  your devices, so on their own they never wake a closed app. They do reach your other devices.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Settings says push is not configured | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` was missing from the build, or Supabase isn't configured. Set it and redeploy the site (step 6). |
| Permission shows "denied" | The user blocked notifications. They must allow them in the browser's site settings. On iOS: Settings → Notifications → DeskDev. The app cannot ask again. |
| "This browser's push service is not supported" | The endpoint isn't on the allow-list. Add the host in both places (see Decisions). |
| `net._http_response` is empty after an insert | The Vault secrets are missing or misnamed (step 5), or pg_net is disabled. `select name from vault.secrets where name like 'deskdev_push%';` |
| `401 Invalid token` in `net._http_response` | `deskdev_push_secret` differs from the function's `PUSH_WEBHOOK_SECRET`. Set both to the same value. |
| `401` from the Supabase gateway with no function log | The function was deployed without `--no-verify-jwt`. Deploy it again with the flag. |
| `500 Push is not configured.`, log says `not configured: VAPID_SUBJECT (…)` | The subject must be `mailto:<real address>` or `https://…`. |
| Pushes to Apple fail with `403` / `BadJwtToken` | The VAPID subject is a placeholder or localhost, or the public and private keys don't match. Fix `VAPID_SUBJECT`. The function refuses mismatched keys at start-up with "are not a pair". |
| `403` from FCM or Mozilla, `failure_count` climbing | The subscription was made with a different VAPID public key (keys rotated, or the site has a different `NEXT_PUBLIC_VAPID_PUBLIC_KEY` than the function). The client re-subscribes with the current key on its next launch. Rows are never deleted for a 403; a device that doesn't relaunch keeps a failing row (see "Stale rows"). |
| Stale rows | Only 404/410 delete a row, so rows that keep failing (a device gone quiet after a key rotation) stay until the device relaunches DeskDev or the 20-row cap evicts them. Once you've confirmed the keys are right, delete them in the SQL editor: `delete from public.push_subscriptions where failure_count >= 10 and (last_success_at is null or last_success_at < now() - interval '30 days');` |
| Rows disappear from `push_subscriptions` | Expected: the push service answered 404/410 (the user unsubscribed, cleared site data, or removed the icon), so the row was deleted. Each install re-checks its subscription at launch. |
| `413` / `PayloadTooLarge` | Shouldn't happen: payloads are capped at 3 KB. Look for an unusually long `app_base`. |
| `429` / `TooManyRequests` | Too many pushes to one device in a short time. They are not retried. |
| iOS: notifications stop after a few pushes | The service worker received a push and showed nothing, so Safari revoked permission. Every push handler path must `event.waitUntil(showNotification(…))`. |
| Tapping opens Safari instead of the app | The `navigate` URL is outside the installed app's scope. `app_base` must be the install's origin + base, with no trailing slash, as stored by the client. |

Function logs: Supabase Dashboard → Edge Functions → send-push → Logs. Each failed push logs the push
service host, the status and the reason.

## Disable

- **Pause delivery** (keeps subscriptions): delete the URL secret. The triggers then do nothing.
  `delete from vault.secrets where name = 'deskdev_push_function_url';`
  To resume, run `node scripts/setup-integrations.mjs --only push --resume-push` (it proves the function
  first), or step 5 again. Without the flag the script reports delivery as OFF and leaves it off, because
  it cannot tell a pause from a run that stopped early.
- **Hide it in the app:** unset `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and redeploy the site.
- **Remove it completely:**

  ```sql
  drop trigger if exists push_on_notification on public.notifications;
  drop trigger if exists push_on_message on public.messages;
  drop function if exists public.push_on_notification(), public.push_on_message(),
    public.push_dispatch(text, jsonb), public.push_badge_count(uuid),
    public.upsert_push_subscription(text, text, text, text, jsonb, text, text),
    public.delete_push_subscription(text), public.is_push_service_endpoint(text);
  drop table if exists public.push_subscriptions;
  delete from vault.secrets where name in ('deskdev_push_function_url', 'deskdev_push_secret');
  ```

  Then `npx supabase functions delete send-push --project-ref rgasjotvqwkjbeivlhvn` and
  `npx supabase secrets unset VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT PUSH_WEBHOOK_SECRET`.

## Rotating secrets

- **`PUSH_WEBHOOK_SECRET`:** generate a new value
  (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), then set it with
  `supabase secrets set` and `vault.update_secret(…)` together. Pushes fail with 401 in the gap between
  the two.
- **VAPID keys:** rotate only if the private key leaked. Every existing subscription is tied to the old
  public key and starts failing with 403. Rotate in this order: function secrets, then the site env and a
  redeploy. Update `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the secrets file in the same sitting:
  `scripts/setup-integrations.mjs` stops when the pair in that file is not the one the function holds. Each device subscribes again with the new key on its next launch, which replaces its row.
  Nothing deletes a row on a 403: the function only raises its `failure_count` (a 403 is more often our
  VAPID config than the device). A device that never opens DeskDev again keeps its old row, and every
  push to that user retries it, until the 20-rows-per-user cap evicts it. Once the new key is live, clear
  those rows by hand (see "Stale rows" under Troubleshooting).

## Client contract (for reference)

- `rpc('upsert_push_subscription', {p_endpoint, p_p256dh, p_auth, p_app_base, p_categories, p_platform,
  p_user_agent})`. Keys may be base64 or base64url. `p_app_base` is `location.origin + BASE_PATH` with no
  trailing slash, and must be https (plain http only for localhost). `p_categories: null` keeps the
  device's stored switches. The endpoint is re-bound to the caller, replacing any row with that endpoint.
  At most 20 rows are kept per user.
- `rpc('delete_push_subscription', {p_endpoint})`. Call it before signing out, while the JWT is still
  valid.
- `functions.invoke('send-push', {body: {type: 'test'}})` returns
  `{sent, failed, gone, subscriptions, skipped?}`.
