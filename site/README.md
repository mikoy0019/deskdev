# NixGen site + DeskDev — one app

The public NixGen Solutions website (formerly the standalone `nixgen-site`
project) **and** DeskDev, built as one app and served by one Cloudflare
Worker on two hostnames:

| URL | What | Code |
|---|---|---|
| `nixgensolutions.com/`, `/services`, `/portfolio`, … | the NixGen site | `src/app/(site)/` |
| `nixgensolutions.com/login` | Team login — the only sign-in page | `src/app/(site)/login/` |
| `workspace.nixgensolutions.com/*` | DeskDev | `src/app/workspace/` → `src/deskdev/` |

In local dev, on previews and on the workers.dev address the site lives at
before the DNS cutover, there's no second hostname: DeskDev is served
same-origin at `/workspace/*`.

Next.js 16 (App Router), built by `next build` and turned into a
**Cloudflare Worker** by the [OpenNext adapter](https://opennext.js.org/cloudflare)
(`@opennextjs/cloudflare`) — worker `nixgen-site`, configured in
`wrangler.jsonc` and `open-next.config.ts`. The stack is Next.js → Supabase →
Cloudflare; nothing runs on Vercel.

## How the two fit together

- **Two root layouts.** `src/app/(site)/layout.tsx` (site styles:
  `src/app/globals.css`) and `src/app/workspace/layout.tsx` (DeskDev styles:
  `src/deskdev/index.css` + self-hosted fonts). Each Tailwind entry scans only
  its own code, so neither design system leaks into the other; moving between
  the site and `/workspace` is a full page load.
- **DeskDev is a client-side app inside one route.**
  `src/app/workspace/[[...path]]/page.tsx` mounts `src/deskdev/Root.tsx`
  (client-only, `next/dynamic` with `ssr: false`), and DeskDev's own
  react-router picks the screen. File-like paths that reach the route are 404s.
- **Host routing** (`src/lib/hosts.ts`, from `NEXT_PUBLIC_SITE_URL` and
  `NEXT_PUBLIC_APP_URL`). On the workspace host, `next.config.ts` rewrites every
  path except `/_next/*`, `/workspace/*` and `/api/*` to `/workspace/*`, and
  DeskDev's router basename is `''` (`src/deskdev/lib/basePath.ts`) — so
  `workspace.nixgensolutions.com/projects/123`. On the site host,
  `src/proxy.ts` redirects `/workspace/*` there, query intact. With the
  variables unset, or with the app URL on the site's own hostname (the
  workers.dev address), none of this applies and the basename is `/workspace`.
- **Static files** for DeskDev live in `public/workspace/` (favicon, OG image)
  and are served at `/workspace/*` on every host, before the route runs — link
  them with `assetUrl()`, not `withBase()`.
- **Login handoff.** `/login` signs in with Supabase — the **same project** as
  DeskDev — keeping no session itself, then hands it to
  `<DeskDev>/auth/callback#dd_at=…&dd_rt=…&next=…` (a different origin in
  production, so the tokens have to travel in the URL). DeskDev strips the
  fragment, calls `setSession`, loads the profile and opens `next`. The
  contract lives in `src/lib/deskdev.ts` and `src/deskdev/lib/siteLogin.ts` —
  keep them in sync.
- DeskDev's own `/login` forwards to the site's `/login` in remote mode;
  `/login?direct=1` keeps the in-app form as an escape hatch. Password-reset
  emails land on DeskDev's `/reset-password`.
- **The site's Team login links go through DeskDev** (`workspaceLoginUrl()`
  in `src/lib/workspaceLogin.ts`): someone already signed in lands straight in
  the workspace, anyone else comes back to `/login` carrying DeskDev's
  one-time `?state=`, so the handoff applies without the "Continue as …?"
  question. A direct visit to `/login` with no state hops through DeskDev once
  to pick one up (a 60 s sessionStorage guard stops a loop).
- There is no public sign-up: accounts are created by a DeskDev admin.
- `src/deskdev/lib` is the source of truth for the data layer that
  `../mobile/src/lib` mirrors — see `../scripts/check-shared-drift.mjs`.

## What the website hands DeskDev

End to end, every way a visitor's action on the site reaches DeskDev:

| On the site | Route | In DeskDev |
|---|---|---|
| Contact brief + first/last touch (`AttributionCapture`) | `/api/contact` → `intake_site_lead` (034) | CRM Leads: the lead, owner, reply clock, score, source; open it for the brief and attribution (`?lead=<id>`); a notification + push to the owner; n8n `inbound-lead` auto-reply, team email and Sheets row |
| Footer Dispatch box | `/api/subscribe` → `intake_subscriber` (039) | CRM Leads → Site subscribers |
| `/f/<token>` quick form | `/api/forms/<token>` → `form_link_submit` (047) | the lead's / project's form, waiting for review, + a notification |
| `/book` | `/api/booking*` → Edge Function `google-calendar` → `booking_record` (048) | a meeting on the lead (Team Calendar, Meet, invite) + a notification |
| `/portfolio`, `/portfolio/<slug>`, the home Field Work strip | read side: `showcase_items` as anon (037), cached 5 minutes under the `showcase` tag, the committed snapshot when Supabase can't answer | what DeskDev's Showcase publishes |
| Team login | DeskDev `/login` → site `/login?state=` → `/auth/callback` | signed in, at `next` |

## Develop

```bash
cp .env.example .env.local   # uncomment DeskDev's Supabase URL + anon key
npm install --legacy-peer-deps
npm run dev                  # site at http://localhost:6969, DeskDev at /workspace
```

Leave `NEXT_PUBLIC_SUPABASE_*` unset to run DeskDev in **local mode** (data in
localStorage, demo accounts `admin@deskdev.local` / `admin`).

| Script | |
|---|---|
| `npm run dev` | Next.js dev server (Node) — site and DeskDev, hot reload. The Worker's bindings come from `wrangler.jsonc` and its secrets from `site/.dev.vars` (`next.config.ts`) |
| `npm run build` | `next build` only → `.next/` (CI's type check needs it) |
| `npm run preview` | the real thing locally: the OpenNext build in the Workers runtime (workerd) at http://localhost:8787, with a local page cache |
| `npm run start` | `next start` on the build — Node, not the Worker |
| `npm run deploy` | build and deploy the production Worker ([Deploy](#deploy)) |
| `npm run deploy:preview` | build and deploy the preview Worker |
| `npm test` | DeskDev unit tests (Vitest) |
| `npm run test:e2e` | DeskDev end-to-end tests (Playwright) — builds in local mode first |
| `npm run typecheck` / `npm run lint` | |

## Deploy

Deploying is the owner's call. Nothing goes out without their go-ahead, and a
production deploy comes after the e2e video proof and the 13-layer gate
([`../AGENTS.md`](../AGENTS.md)). Once it is out, health checks, logs,
rollback and alerts are in
[`../docs/runbooks/OPERATIONS.md`](../docs/runbooks/OPERATIONS.md).

### The plan it needs

The account needs **Workers Paid** (Cloudflare dashboard, Workers & Pages,
Plans). Rendering a page on the server took about 35 ms of processor time on
the first deploy (2026-10-05, vinext) against the Free plan's 10 ms a request:
on Free, DeskDev answered Cloudflare error 1102 and the larger pages arrived
cut off. The page cache below means most visits no longer render anything, but
a page still has to render when its 5 minutes are up, and the Worker bundle is
about 2.9 MiB compressed, right at Free's 3 MiB limit (Paid allows 10 MiB).
Changing the plan needs no redeploy.

**R2** is not needed today: the page cache serves what the build rendered
from the Worker's static files (see "The page cache" below). To have home and
`/portfolio` refresh every 5 minutes without a deploy, switch R2 on for the
account (Cloudflare dashboard → R2; the free allowance is far above what the
cache uses), create its two buckets once from `site/`, and follow the switch
described in `open-next.config.ts`:

```bash
npx wrangler r2 bucket create nixgen-site-cache
npx wrangler r2 bucket create nixgen-site-preview-cache
```

### What a deploy creates

`wrangler.jsonc` describes both Workers: the top level is production, the
`preview` environment the previews.

| | Production | Preview |
|---|---|---|
| Command | `npm run deploy` | `npm run deploy:preview` |
| Worker | `nixgen-site` | `nixgen-site-preview` |
| Address | today: `https://nixgen-site.nixgensolutions.workers.dev`, DeskDev at `/workspace`, no custom domain. After the cutover: `nixgensolutions.com` and `workspace.nixgensolutions.com` (`routes`), and the workers.dev address is switched off | its own workers.dev address, never a custom domain |
| Worker secrets | the three required ones in step 2 | none, on purpose: a preview can never hold production's `LEAD_INTAKE_SECRET`, so its contact form falls back to email |
| Page cache | the build's pages, in its static files (with R2 on: bucket `nixgen-site-cache`) | the same (with R2 on: bucket `nixgen-site-preview-cache`) |

Both get the same bindings: `ASSETS` (the static files, which also carry the
page cache), `API_LIMITER` (at most 20 calls a minute per network on the
public `/api` routes, `src/lib/rateLimit.ts`), `CF_VERSION_METADATA` (the
version id that `/api/health` reports), and Workers Logs switched on
(`observability`). The R2 page cache would add its bucket, a Durable Object
queue and `WORKER_SELF_REFERENCE` (`wrangler.jsonc` lists them).

The custom domains stay commented out in `wrangler.jsonc` until the
`nixgensolutions.com` zone is Active on the Cloudflare account: a deploy that
lists them before that stops at the domain step. Switching them on is step 5
of [`../docs/runbooks/DNS-CUTOVER.md`](../docs/runbooks/DNS-CUTOVER.md).

### The page cache

Every site page except `/portfolio/<slug>` is rendered at build time.
`open-next.config.ts` uses the static-assets cache: the deploy uploads those
pages with the static files, and the Worker answers a cached page before
Next.js loads the route's code. Nothing re-renders at runtime, so home and
`/portfolio` show the showcase as it was when the site was built: a portfolio
edit in DeskDev appears there with the next deploy. (They are marked
`revalidate = 300` for the R2 page cache, which would re-render them every 5
minutes; with the static-assets cache, a page past its 5 minutes is still
served from the cache, labelled `STALE`, and its re-render is dropped on
purpose.) `/portfolio/<slug>` renders per request, but its showcase read is
the same cached fetch, so it too shows the build's showcase. Responses say which: `x-opennext-cache: HIT` (or
`STALE`) came from the cache; `x-nextjs-cache: MISS` was rendered. DeskDev
(`/workspace`) and the API routes are never cached.

### 1. Build values

`NEXT_PUBLIC_*` values are read when the build runs and inlined into the
bundle, so changing one means building and deploying again. A local deploy
reads them from `site/.env.local`; the pipeline reads them from the GitHub
environment's variables.

| Name | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | DeskDev's Supabase project. Without them DeskDev runs in local mode on demo data, the forms cannot record anything and `/api/health?deep=1` reports `unconfigured` |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL` | where the site and DeskDev live (`src/lib/hosts.ts`); see the next table |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push in DeskDev |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_CF_BEACON_TOKEN` | optional: the Turnstile widget on the forms, Cloudflare Web Analytics |

| | `NEXT_PUBLIC_SITE_URL` | `NEXT_PUBLIC_APP_URL` | What the build does |
|---|---|---|---|
| Before the DNS cutover | `https://nixgen-site.nixgensolutions.workers.dev` | `https://nixgen-site.nixgensolutions.workers.dev/workspace` | one host for both, DeskDev at `/workspace`. Search engines are told to stay out: `robots.txt` disallows everything and pages carry `X-Robots-Tag: noindex, nofollow` |
| Domain attached, `workspace.` not yet (today) | `https://nixgensolutions.com` | unset | one host for both, DeskDev at `nixgensolutions.com/workspace`; the site is open to search engines |
| After it | `https://nixgensolutions.com` | `https://workspace.nixgensolutions.com` | DeskDev at the root of its own host; the site is open to search engines |

While DeskDev shares the site's host, the Team login and its handoff use the
relative `/workspace`, so a sign-in stays on whichever host it started on
(`src/lib/workspaceLogin.ts`). Canonical links, `og:url`, form links and the
noindex decision still come from `NEXT_PUBLIC_SITE_URL`: a build that names
the workers.dev address keeps telling search engines to stay away from the
domain too.

Only a build whose site URL is `https://nixgensolutions.com` is indexable.

### 2. Worker secrets

Runtime secrets live on the Worker, never in the build. The Worker holds no
service-role key and no n8n secret: `/api/contact`, `/api/subscribe` and the
quick form's `/f/<token>` and `/api/forms/<token>` write through database
functions that check `LEAD_INTAKE_SECRET`.

| Secret | Read by | Value |
|---|---|---|
| `LEAD_INTAKE_SECRET` | `/api/contact`, `/api/subscribe`, `/f/<token>`, `/api/forms/<token>` | the same value as the Supabase Vault row `lead_intake_secret`. A mismatch is logged as `intake_secret_rejected` |
| `LEAD_IP_SALT` | both forms | any long random string. It salts the visitor hash the throttle counts by |
| `FORM_TOKEN_SECRET` | `/api/contact` | any long random string. It signs the form's fill-time check |
| `BOOKING_API_SECRET` | `/api/booking`, `/api/booking/slots` (the `/book` page) | the same value as the `google-calendar` Edge Function's secret of that name. Without it `/book` says booking can't load right now |

The first three are listed under `secrets.required` in `wrangler.jsonc`, so a
production deploy stops until the Worker has every one of them. That is on purpose: without
`LEAD_INTAKE_SECRET` or `LEAD_IP_SALT` the forms answer 503 and no enquiry
reaches the Growth Hub, while the contact form's email copy still arrives, so
the failure would be silent.

`TURNSTILE_SECRET_KEY` is optional and not required: set it, and add it to
`secrets.required`, on the day `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set.
`BOOKING_API_SECRET` is not required either, so a deploy does not wait for it:
set it on the Worker with the others, or `/book` (linked from the contact page)
shows its can't-load state. Locally every secret in `site/.dev.vars` reaches
the routes, in `npm run dev` and `npm run preview` alike. `/api/google/*` reads two
optional settings of its own, `GOOGLE_FUNCTION_URL` and
`GOOGLE_CONNECT_ORIGINS`; `src/app/api/google/[leg]/route.ts` says what each
is for.

To see or change them:

- Names only: `npx wrangler secret list --name nixgen-site`.
- Set or replace one: Cloudflare dashboard → Workers & Pages → `nixgen-site` →
  Settings → Variables and Secrets, or `npx wrangler secret put <NAME> --name nixgen-site`
  (it asks for the value, so nothing lands in the shell history).
- A Worker deployed before the forms wrote through the database may still hold
  `N8N_WEBHOOK_SECRET` or `N8N_BASE_URL`. Nothing reads them any more: delete
  them (`npx wrangler secret delete N8N_WEBHOOK_SECRET --name nixgen-site`).

### 3. Deploy

From `site/`, signed in to Cloudflare: `npx wrangler login` once, or
`CLOUDFLARE_API_TOKEN` in the environment (`npx wrangler whoami` shows who).
The account is pinned in `wrangler.jsonc`.

```bash
npx opennextjs-cloudflare build
npx wrangler deploy --dry-run   # checks the config and the bundle size; uploads nothing
npm run deploy                  # production: build, fill the page cache, deploy
```

`nixgen-site` already exists (first deployed 2026-10-05) and holds its
secrets, and every deploy keeps them. If it lacks one, set it first (step 2):
the upload stops with "required secrets have not been set" until it has all
three. A Worker that does not exist yet can take them with the upload:
`npx wrangler deploy --secrets-file <file of NAME=value lines>` after
`npx opennextjs-cloudflare build` (then `npx opennextjs-cloudflare deploy`
once, to fill its page cache). Delete the file afterwards.

A preview is `npm run deploy:preview` (`--env preview`). Do not use
`npm run deploy` for it: that one always deploys production.

`.github/workflows/site-deploy.yml` does both from GitHub (production on a
push to `master`, a preview per pull request) once it is switched on:
[`DNS-CUTOVER.md` → Deploy pipeline](../docs/runbooks/DNS-CUTOVER.md#deploy-pipeline).

### 4. After a deploy

1. `GET /api/health?deep=1` on the deployed address answers 200 with
   `"database": "ok"`, and its `version` is the new one
   ([`OPERATIONS.md`](../docs/runbooks/OPERATIONS.md) → Health).
2. Supabase has to know the address DeskDev is served from:
   - Authentication → URL Configuration: the redirect URLs in
     [`../docs/runbooks/AUTH.md`](../docs/runbooks/AUTH.md) section 2.
     Without the entry, password-reset links for that address are refused.
   - `APP_ORIGINS`, the allow-list of the `admin-users`, `vault-reset` and
     `google` Edge Functions. Without the address in it, user management, the
     vault reset and Google connect are refused from DeskDev. Before the
     cutover it needs the workers.dev address:
     `node scripts/setup-integrations.mjs --only google --workers-dev-origin`
     (an owner step: it writes to the live project). After the cutover:
     `DNS-CUTOVER.md` step 6.
3. Walk it: home, `/portfolio`, the contact form, `/book`, `/login` → DeskDev.
