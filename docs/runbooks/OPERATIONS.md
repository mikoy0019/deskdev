# Operations: is it up, what went wrong, how to go back

For `nixgen-site`, the one Cloudflare Worker that serves the NixGen site and
DeskDev, and its database (Supabase project `rgasjotvqwkjbeivlhvn`). Owner
runbook. Deploying is in [`site/README.md`](../../site/README.md#deploy);
moving the domain is in [`DNS-CUTOVER.md`](DNS-CUTOVER.md).

| Word | Meaning here |
|---|---|
| Worker | the program Cloudflare runs to answer every request to the site |
| Version | one uploaded build of the Worker. Every deploy makes a new one, with its own id; so does changing a Worker secret |
| Deployment | which version is answering visitors right now |

**The address.** Until the DNS cutover the site is at
`https://nixgen-site.nixgensolutions.workers.dev`, with DeskDev at
`/workspace`. After the cutover, read every URL below with
`https://nixgensolutions.com` instead.

Sections: [1. Health](#1-health-is-it-up) ·
[2. Logs](#2-logs-what-happened) ·
[3. Service levels](#3-service-levels-what-good-means) ·
[4. Rollback](#4-rollback-undo-a-bad-deploy) ·
[5. Load test](#5-load-test) ·
[6. Alerts](#6-alerts-what-warns-you-and-what-does-not)

---

> **If DeskDev shows "Error 1102" or pages stop half-way down:** the Cloudflare
> account is on the Workers Free plan. It allows 10 ms of processor time per
> request and a page needs about 35 ms. The fix is the Workers Paid plan
> (dashboard, Workers & Pages, Plans); it takes effect without a redeploy.
> `/api/health` keeps answering 200 in that state, because it needs almost no
> processor time, so a green health check does not rule this out. Workers &
> Pages, nixgen-site, Metrics shows it as "Exceeded resources".

## 1. Health: is it up?

1. Open **`/api/health`** on the site's address in a browser. A healthy
   answer:

   ```json
   { "ok": true, "service": "nixgen-site", "version": "0f8c2d1e-…", "time": "2026-10-04T14:48:30.462Z" }
   ```

   | Field | Meaning |
   |---|---|
   | `ok` | `true`: the Worker is answering |
   | `service` | always `nixgen-site`: this Worker answered, not something else on the address |
   | `version` | the id of the version that is live. It changes with every deploy and goes back after a rollback. `null` only where there is no Cloudflare version, such as a run on your own computer |
   | `time` | the moment of the answer, in UTC. The page is never served from a cache, so a fresh time means a live answer |

2. Open **`/api/health?deep=1`** to test the database too. The answer gains
   `"checks": { "database": "…" }`:

   | `database` | Meaning | What to do |
   |---|---|---|
   | `ok` | the Worker asked the database one small question and got an answer | nothing |
   | `down` | no answer within 2 seconds, or an error. `ok` turns `false` and the status is **503** ("service unavailable") | Supabase dashboard: is the project paused or unhealthy? Then https://status.supabase.com |
   | `unconfigured` | this build was made without the database settings. Normal for a preview or a demo build. On the real site it means the deploy went out without its build values | deploy again with them (`site/README.md`, Deploy) |

3. The deep check is limited to 20 calls a minute from one network. Past
   that it answers **429** ("too many requests") until the minute is over.
   Anything that asks often should use the plain check.

In a terminal, `curl -i <address>/api/health` shows the status and the
headers as well (in Windows PowerShell type `curl.exe`; plain `curl` is a
different command there).

If neither page answers, or a Cloudflare error page comes back, the Worker
itself is failing. Read the [logs](#2-logs-what-happened); if a deploy went
out shortly before, [roll back](#4-rollback-undo-a-bad-deploy).

## 2. Logs: what happened?

1. Cloudflare dashboard → **Workers & Pages** → `nixgen-site` →
   **Observability** (some versions of the dashboard call this tab **Logs**).
2. Cloudflare adds one line of its own per request (address, status, how long
   it took). Every line the site's own `/api` routes write is one JSON object,
   a small record of named fields, and always carries these three:

   | Field | Meaning | Examples |
   |---|---|---|
   | `route` | which part of the site wrote it | `contact`, `subscribe`, `client-errors`, `health`, `/api/google` |
   | `event` | what happened | `lead_created`, `intake_rpc_failed`, `database_down`, `client_error` |
   | `request_id` | the id of that one request | the Ray ID, such as `8f1e2d3c4b5a6978-AMS` |

   Cloudflare reads the fields, so you can filter on them: `event` is
   `client_error`, or `request_id` is the id you were given.
3. **Finding one person's problem.** Every answer the site gives under
   `/api/...` has a response header `X-Request-Id` with the same value as
   `request_id` in the logs. That includes the refusals no route writes itself:
   404 for an address that does not exist, 405 for a method a route does not
   take, and the 500 of a route that crashed. On Cloudflare it is the Ray ID,
   which is also printed at the bottom of Cloudflare's own error pages. Ask for
   it (or read it in the browser's developer tools, Network tab), then filter
   the logs by it. An answer without the header never reached the site's code
   (a Cloudflare error page, say): read `cf-ray` instead, the header Cloudflare
   puts on every response, which holds the same value.
4. **Errors in the browser.** When a page crashes in a visitor's or a team
   member's browser, the page reports it to `/api/client-errors` and it
   appears here as `event: client_error`. Addresses are cut down to the path
   and tokens, emails and long codes are removed before the line is written.
5. **Look soon.** At the time of writing the free plan keeps Workers logs for
   3 days and up to 200,000 lines a day. Copy what you need into the ticket.

The lines worth knowing (level *error* unless noted):

| `event` | Means | First thing to check |
|---|---|---|
| `intake_not_configured` | a contact or newsletter form could not record: a Worker secret or a build value is missing | `site/README.md`, Deploy |
| `intake_secret_rejected` | the database refused `LEAD_INTAKE_SECRET` | the Worker secret must equal the Vault row `lead_intake_secret` |
| `intake_rpc_failed`, `intake_rpc_timeout`, `intake_rpc_unreachable` | the database did not record an enquiry or a newsletter sign-up. The contact form sends the enquiry by email instead | `/api/health?deep=1`, then Supabase |
| `database_down` | a deep health check failed | Supabase |
| `client_error` | a page crashed in someone's browser | the `app`, `path` and `message` fields of the line |
| `handler_threw` | one of the site's own `/api` routes crashed | the lines with the same `request_id` |
| `limiter_unavailable` (warning) | the 20-a-minute limiter did not answer, so the request was let through | `API_LIMITER` in `site/wrangler.jsonc` |

## 3. Service levels: what "good" means

Three targets, set at the first deploy on 2026-10-04. They are goals to check
against. Nothing here is a measurement: no numbers existed when they were set.

| # | Target | What counts | Where the number is read |
|---|---|---|---|
| 1 | **Up 99.5% of each month.** That allows about 3 hours 36 minutes of downtime in a 30-day month | "up" = `/api/health?deep=1` answers 200 with `"database": "ok"`: the Worker answers and can reach the database | Nothing records this yet. Once the watchdog is deployed (section 6) it checks the site and the database every 5 minutes and emails when one goes down and when it is back; add up those gaps for the month. Until then the only check is a person opening the page |
| 2 | **Fewer than 1 request in 100 fails in the Worker, each day** | Cloudflare counts an error when the Worker crashes or runs past its limits. A route that answers 503 on purpose (the contact form or the health check while the database is down) is *not* counted there; those are the error lines in section 2 | Cloudflare dashboard → Workers & Pages → `nixgen-site` → **Metrics** → the **Requests** chart, set to one day: Errors divided by Total |
| 3 | **9 in 10 requests are handled within 1 second** | the **Wall Time per execution** chart: how long the Worker worked on a request, waiting for the database included. It covers pages and `/api` routes; images, scripts and styles are served without the Worker. It is not the time until the page has arrived in the browser | same **Metrics** tab → **Wall Time per execution**, the P90 line (the value 90% of requests stayed under). If your chart has no P90 line, use the next line above it and say which in your notes |

The database has its own charts: Supabase dashboard → **Reports** →
**API Gateway** (requests, response errors, response speed) and **Database**.
Use them when target 1 or 3 is missed and the Worker's charts look fine. At
the time of writing, Cloudflare keeps Worker metrics for three months and the
Supabase free plan shows the last 24 hours.

Review the three numbers once a month. A miss is a reason to look for the
cause, not a breach of anything.

## 4. Rollback: undo a bad deploy

Going back puts an earlier version in front of visitors again. It needs no
build; how long it takes is what the drill below records.

1. Note what is live now: open `/api/health` and copy `version`.
2. Cloudflare dashboard → **Workers & Pages** → `nixgen-site` →
   **Deployments**.
3. Find the last version that worked. Select the three dots at the right of
   its row → **Rollback** → confirm.
4. Open `/api/health` again: `version` must now be the older id. Then walk the
   home page, `/login` and one DeskDev page.
5. Undo the change in git too (`git revert`), or the next deploy brings the
   fault back.
6. Add a line to the log below.

What a rollback does **not** undo:

- **The database.** A migration applied for the newer version stays applied.
  If the older code cannot work with it, fix forward with a new migration
  (`supabase/README.md`); never edit one that was applied.
- **The domains.** Which addresses point at the Worker is not part of a
  version (`DNS-CUTOVER.md` step 5 has its own rollback). The other way
  round, a version does carry the addresses it was built with: one from
  before the DNS cutover still names the workers.dev address, tells search
  engines to stay out and sends sign-ins to an address that no longer
  answers. After the cutover, only go back to versions deployed after it.
- **Secrets, in one case.** A version is uploaded together with its settings,
  secrets included. If a secret was changed after the version you want to go
  back to, Cloudflare holds the rollback until you confirm it. Assume the
  older value comes back with the older version: if that value is no longer
  valid, fix and deploy instead of rolling back.

The same from a terminal, for when the dashboard is not at hand. These
commands come from the help of the installed tool (`wrangler` 4.147, run
from `site/`). They have not been used on this Worker until the drill log
below says so; if they and the dashboard disagree, trust the dashboard.

```bash
npx wrangler deployments list --name nixgen-site   # the first entry is what is live
npx wrangler versions list --name nixgen-site      # every version, with its id
npx wrangler rollback <the id to go back to> --name nixgen-site --message "<why>"
```

`wrangler rollback` asks before it switches. A rollback goes back to that
version's code and bindings; if a secret changed in between, read the note on
secrets above first. The page cache is not rolled back: its pages age out
within 5 minutes.

### Drill

A rollback nobody has tried is a hope. After the first deploy, and again
after any change to how deploys work:

1. There must be two versions: deploy a second time (the same code will do)
   and note both `version` ids from `/api/health`.
2. Roll back to the first, as above. Time it from confirming until
   `/api/health` shows the older `version`.
3. Roll forward again the same way (pick the newer version), so the site ends
   on the latest.

| Date | From version | To version | Time taken | Result |
|---|---|---|---|---|
| | | | | |

## 5. Load test

There is nothing to balance by hand. Cloudflare runs the Worker in each of its
data centres, sends a visitor to one nearby and starts more copies as traffic
grows. The part that does not multiply is the database: one Supabase project
that every request shares. The test checks that pages keep answering when
many arrive at once.

Rules:

- **Reading only:** `GET /` and `GET /portfolio`. Never `/api/contact`,
  `/api/subscribe` or `/api/client-errors`: they are throttled on purpose, so
  a test would only measure the throttle, and it would write junk into the
  live database. Not `/api/health?deep=1` either (20 a minute).
- **Small and capped.** The two commands below send **600 requests in total**
  (300 per page), at most 10 a second, for about 30 seconds each. That is
  enough to show whether pages keep answering under a burst, and it is 0.6%
  of the free plan's allowance of 100,000 requests a day (it resets at
  midnight UTC). Stay far below that allowance: once it is used up, the
  Worker stops answering (Cloudflare error 1027) until the reset. Do not
  raise the numbers without checking the day's count on the Metrics tab
  first.

```bash
npx -y autocannon@8.0.0 --connections 5 --overallRate 10 --amount 300 --renderStatusCodes --no-progress https://nixgen-site.nixgensolutions.workers.dev/
npx -y autocannon@8.0.0 --connections 5 --overallRate 10 --amount 300 --renderStatusCodes --no-progress https://nixgen-site.nixgensolutions.workers.dev/portfolio
```

`autocannon` is a small load tool that `npx` downloads for the run; nothing is
added to the repo. `--amount` is the number of requests, `--overallRate` the
most it sends per second.

Reading the result:

1. The **Code** table must show `200` for all 300. Anything else is a fail:
   note the code. Cloudflare error 1102 means the Worker ran past its limits
   on a request (on the free plan, 10 ms of processing time each, at the time
   of writing).
2. Note the **Latency** line: the 50%, 97.5% and 99% columns and Max.
3. A few minutes later, look at the **Metrics** tab for those minutes: no
   errors on the Requests chart, and the Wall Time chart against target 3.

| Date | Target | Tool and settings | Result |
|---|---|---|---|
| | | | |

## 6. Alerts: what warns you, and what does not

The state at the first deploy, 2026-10-04, as far as the repo's own records
go (`docs/SYSTEM_MAP.md`). In one sentence: **nothing sends anyone a message
yet when the site or the database fails.** The pieces are built; none of them
is switched on.

What exists:

| Piece | What it does | State |
|---|---|---|
| The watchdog: Worker `nixgen-watchdog` (`workers/n8n-keepalive`) | every 5 minutes it asks the site, the workspace, Supabase (sign-in and one database read) and n8n. After two failed rounds in a row it sends an alert, repeats it every hour while the fault lasts, and sends a notice when it is over | built, with tests in CI. **Not deployed.** Its settings still name the real hosts; until the cutover they must name the workers.dev address (`DNS-CUTOVER.md`, phase 0). Two secrets make it useful: `SUPABASE_ANON_KEY` (without it the database check is skipped) and `N8N_WEBHOOK_SECRET` (without it no alert can be sent). A small store, `WATCHDOG_STATE`, lets it remember the last round: without it, it alerts only on the first check of each half hour and sends no notice at the end |
| The alert email: n8n workflow `[deskdev] ops-alert` | turns an alert from the watchdog or the nightly backup into an email to the active admins, or to the company inbox when it cannot read them | in git (`automation/n8n/ops-alert.json`). The new n8n's workflows are recorded as not switched on, so no email goes out. Confirm in n8n before relying on it. The second route (Resend) is optional and not set up |
| n8n's error handler | a failed automation is recorded in `automation_runs` and emailed, at most once per job per hour | not switched on, as above |
| DeskDev → Settings → Integrations → Automations | shows each scheduled automation as ok, late or failing (admins) | a screen someone has to open, not an alert |
| The nightly backup | when a night fails, GitHub emails whoever last edited the workflow, plus the ops alert once that is set up | off until `DB_BACKUP_ENABLED` is set (`BACKUP-RESTORE.md`) |
| The deploy pipeline's check | after a pipeline deploy it requests the home page, `/robots.txt` and the workspace, and fails the run if one of them does not answer within a minute | off until `SITE_DEPLOY_ENABLED` is set (`DNS-CUTOVER.md`, Deploy pipeline) |

What does not exist:

1. **No message when the site is down** or when `/api/health` turns 503,
   until the watchdog is deployed and n8n can send its email.
2. **No message for errors in the logs** (`client_error`, the `intake_…`
   lines). Workers logs are read by a person, and kept 3 days.
3. **Nothing outside Cloudflare is watching.** The watchdog runs on Cloudflare
   too, so it cannot report an outage of Cloudflare itself. An outside uptime
   service asking `/api/health?deep=1` would close this.
4. **Nothing of ours warns before the free plan's daily request allowance
   runs out.** The day's count is on the Metrics tab.
5. **No rota.** When alerts are on they go to the admins' email; nobody is
   named to react outside working hours.

Until that changes, the routine is manual, once a working day:

1. Open `/api/health?deep=1`: `"ok": true` and `"database": "ok"`.
2. Cloudflare → `nixgen-site` → **Metrics**: errors on the Requests chart.
3. Cloudflare → `nixgen-site` → **Observability**: any *error* lines since
   yesterday (section 2).
4. DeskDev → Settings → Integrations: nothing late or failing.
