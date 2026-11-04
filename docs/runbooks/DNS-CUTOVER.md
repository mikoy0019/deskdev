# DNS cutover: nixgensolutions.com to Cloudflare

Moves the domain's DNS to Cloudflare and points `nixgensolutions.com` and
`workspace.nixgensolutions.com` at the `nixgen-site` Worker, replacing the
WordPress site. Owner runbook; every step is a dashboard or registrar action.

**The one way this goes badly is email.** If an MX, SPF, DKIM or DMARC record
is not copied exactly, company mail stops or lands in spam, and nothing on the
website tells you. Steps 1 and 3 exist for that. Mail is *copied* in this
cutover, never *changed*; moving mail to Google Workspace (Q1) is a separate,
later change.

| Phase | When | Reversible |
|---|---|---|
| 0. Prove the new site on workers.dev | any time | yes, nothing public changes |
| 1. Inventory the current DNS | 2+ days before | yes |
| 2. Lower TTLs | 24-48 h before | yes |
| 3. Add the zone to Cloudflare, compare record by record | the day before | yes (zone stays pending) |
| 4. Switch name servers | a weekday morning | yes, but slow (up to 48 h) |
| 5. Attach the Worker domains | once the zone is Active | yes, in minutes |
| 6. Update everything that knows the URLs | same day | yes |
| 7. After 2 clean weeks: DMARC, HSTS, cleanup | +14 days | yes |

---

## 0. Prove the new site first

The proof is the production Worker itself, `nixgen-site`, on its workers.dev
address: **https://nixgen-site.nixgensolutions.workers.dev**, with DeskDev at
`/workspace` on the same host. While the `routes` in `site/wrangler.jsonc`
stay commented out, a production deploy attaches no domain and the Worker is
reached at that address. It is the real build on the live database,
so whatever is entered there is real data. (The "preview" Worker of the
[Deploy pipeline](#deploy-pipeline) cannot stand in for it: it holds no
secrets and is never built with production's database values, so its contact
form only emails and its DeskDev shows demo or staging data.)

- This is a production deploy, so the e2e video proof and the 13-layer gate
  come first; both must pass (`AGENTS.md`). Then deploy: `site/README.md` →
  Deploy.
- Tell Supabase about the address, or password-reset links, user management,
  the vault reset and Google connect are refused from it: the redirect URL in
  `docs/runbooks/AUTH.md` section 2, and `APP_ORIGINS` with
  `node scripts/setup-integrations.mjs --only google --workers-dev-origin`.
- Walk it: home, services, portfolio, contact form (a real test enquiry lands
  in DeskDev → Growth), `/login` → workspace handoff, a DeskDev page per
  section. `/api/health?deep=1` answers `"database": "ok"`. Then run the
  rollback drill and the load test and fill in their logs
  (`docs/runbooks/OPERATIONS.md`).
- Check that search engines are told to stay out while the site is on this
  address: `/robots.txt` says `Disallow: /`, and a page's response headers
  include `X-Robots-Tag: noindex, nofollow`. Both follow from the build's
  site URL not being `nixgensolutions.com` (`site/src/lib/hosts.ts`), so the
  temporary address never competes with the real one.
- Point the watchdog at it for a few days: in `workers/n8n-keepalive/wrangler.jsonc`
  set `SITE_URL` to the workers.dev URL and `WORKSPACE_URL` to its `/workspace/`.
- Build the WordPress redirect map: export the old sitemap
  (`https://nixgensolutions.com/sitemap_index.xml` or `/wp-sitemap.xml`) and
  check that every indexed URL is either a page on the new site or in the
  `redirects()` list in `site/next.config.ts`.

## 1. Inventory the current DNS

Find out who serves DNS today (likely SiteGround) and who the registrar is:

```powershell
Resolve-DnsName nixgensolutions.com -Type NS
whois nixgensolutions.com   # or https://lookup.icann.org
```

Export every record. From the current DNS panel, export the zone file if it
offers one (SiteGround: Site Tools → Domain → DNS Zone Editor). Also capture
what the world sees, so the comparison in step 3 has a reference:

```powershell
$d = 'nixgensolutions.com'
$names = @($d, "www.$d", "workspace.$d", "mail.$d", "_dmarc.$d", "autodiscover.$d",
           "default._domainkey.$d", "google._domainkey.$d", "resend._domainkey.$d", "send.$d",
           "ftp.$d", "webmail.$d", "cpanel.$d")
foreach ($n in $names) { foreach ($t in 'A','AAAA','CNAME','MX','TXT','CAA','SRV') {
  Resolve-DnsName $n -Type $t -ErrorAction SilentlyContinue |
    Where-Object { $_.Section -eq 'Answer' } |
    Select-Object @{n='Name';e={$_.Name}}, Type, TTL, @{n='Data';e={ $_.IPAddress, $_.NameHost, $_.NameExchange, ($_.Strings -join ''), $_.Preference | Where-Object { $_ } }}
}} | Format-Table -AutoSize | Out-File dns-before.txt
```

DKIM selectors cannot be listed from outside. Read them from the mail
provider: SiteGround (Email → Authentication), Google Admin (Apps → Gmail →
Authenticate email), and any sender such as Resend or formsubmit. Note each
`<selector>._domainkey` record exactly. Write the list down; it is the
checklist for step 3. Note the current apex IP of the WordPress host too: it
is the rollback target.

## 2. Lower TTLs

At the current DNS host, set the TTL of the apex, `www`, `workspace` (if it
exists) and the MX records to 300 seconds. Wait at least the old TTL (often
4-24 h) before step 4, so the switch propagates in minutes.

If **DNSSEC** is on at the registrar, turn it off now and wait 24 h. Changing
name servers with DNSSEC on breaks resolution for everyone who validates.

## 3. Add the zone to Cloudflare and compare

Cloudflare dashboard (account `5c6cabb0e7c2e306c3dd792599736a46`) → **Add a
domain** → `nixgensolutions.com` → Free plan. Cloudflare imports what it can
see; it always misses some records (DKIM selectors, SRV, anything not in its
guess list).

Compare the imported list with the step 1 inventory, **one record at a time**:

| Record | Must be | Proxy |
|---|---|---|
| MX (all, with priorities) | identical | DNS only (grey) |
| `mail`, `webmail`, `smtp`, `imap`, `pop`, `autodiscover` A/CNAME | identical | **DNS only**: mail breaks if proxied |
| TXT apex SPF (`v=spf1 …`) | identical, exactly one SPF record | n/a |
| TXT `<selector>._domainkey` (every one) | identical, long values not truncated | n/a |
| TXT `_dmarc` | identical (leave `p=` as it is today) | n/a |
| TXT `google-site-verification`, others | identical | n/a |
| apex A / `www` CNAME | the WordPress IP for now (step 5 replaces them) | proxied is fine |
| CAA (if any) | identical, plus `0 issue "letsencrypt.org"` and `0 issue "pki.goog"` so Cloudflare can issue certificates | n/a |

Do **not** press "Done, check nameservers" until the table is all ticks.

## 4. Switch name servers

At the registrar, replace the name servers with the two Cloudflare gives you.
Do it on a weekday morning (Manila), so a mail problem is noticed while people
are working. Then:

- Watch the zone in Cloudflare turn **Active** (minutes to a few hours).
- Send a test email **to** a company address from an outside account, and
  **from** a company address to an outside Gmail. In Gmail, *Show original*
  must say `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
- Compare `Resolve-DnsName` output with `dns-before.txt`: only NS may differ.

Rollback: put the old name servers back at the registrar. Propagation can take
hours, which is why step 3 is thorough.

## 5. Attach the Worker domains

`site/wrangler.jsonc` names `nixgensolutions.com` and
`workspace.nixgensolutions.com` as the Worker's custom domains, in a
`routes` block that is commented out. While it is (phase 0) the Worker has no
domain and lives on its workers.dev address. Custom domains can only attach to an
**Active** zone, and they conflict with an existing A or CNAME on the same
name:

1. In Cloudflare DNS, delete the apex A record (WordPress) and any
   `workspace` record. The site is unreachable from here until step 2, so do
   both back to back.
2. Switch the Worker over, in one deploy:
   - In `site/wrangler.jsonc` uncomment `routes` and set `workers_dev` to
     `false`. That lists both domains and switches the workers.dev address
     off, so the site has one address. `src/lib/cloudflareConfig.test.ts`
     checks the pair.
   - Set the build values to the real hosts: `NEXT_PUBLIC_SITE_URL` =
     `https://nixgensolutions.com`, `NEXT_PUBLIC_APP_URL` =
     `https://workspace.nixgensolutions.com` (`site/.env.local` for a local
     deploy, the GitHub `production` environment for the pipeline). A build
     that still names the workers.dev address keeps telling search engines to
     stay out, and points canonical links and form links at an address this
     deploy switches off. With only the apex attached so far, leave
     `NEXT_PUBLIC_APP_URL` unset: DeskDev stays at `/workspace` on the domain
     (`site/README.md` → Build values).
   - Deploy production: either merge to `master` with the pipeline enabled,
     or locally `cd site && npm run deploy`. The deploy attaches both domains
     and Cloudflare issues the certificates (a minute or two).
3. `www`: add a proxied `CNAME www → nixgensolutions.com` and a Redirect Rule
   (Rules → Redirect Rules) `www.nixgensolutions.com/*` → `https://nixgensolutions.com/${1}`, 301.
4. Check: `https://nixgensolutions.com/`, `/robots.txt` (crawling allowed now,
   with the sitemap line; pages no longer carry `X-Robots-Tag: noindex`),
   `/sitemap.xml`, `/api/health?deep=1` (the `version` of this deploy), an old
   WordPress URL (301), `https://workspace.nixgensolutions.com/` (DeskDev),
   `/login` → workspace handoff, the contact form. The workers.dev address no
   longer answers.

Rollback: Workers → `nixgen-site` → Settings → Domains → remove the custom
domain, then re-create the apex A record with the WordPress IP from step 1.
A deploy does not take a domain off again, only the dashboard does. Then
comment `routes` out again, set `workers_dev` back to `true` and the two build
values back to the workers.dev address, and deploy: that brings the workers.dev address back,
and without it the next deploy would attach the domains again.

## 6. Update everything that knows the URLs

| Where | Setting | Value |
|---|---|---|
| Supabase → Authentication → URL Configuration | Site URL, Redirect URLs | see `docs/runbooks/AUTH.md` |
| Supabase → Edge Functions → secrets | `APP_ORIGINS` | `https://workspace.nixgensolutions.com,https://nixgensolutions.com,https://www.nixgensolutions.com` |
| Supabase → Edge Functions → secrets | `GOOGLE_REDIRECT_BASE` | `https://nixgensolutions.com/api/google` |
| Google Cloud → OAuth client | redirect URI | `https://nixgensolutions.com/api/google/callback` |
| GitHub → Environments → production | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL` | `https://nixgensolutions.com`, `https://workspace.nixgensolutions.com`. A local deploy already set them in step 5; this row is for the pipeline, so its next deploy builds with the same values |
| Cloudflare → Turnstile → widget | hostnames | `nixgensolutions.com` (remove workers.dev later) |
| Cloudflare → Web Analytics | site | `nixgensolutions.com`; token = `NEXT_PUBLIC_CF_BEACON_TOKEN` |
| `workers/n8n-keepalive/wrangler.jsonc` | `SITE_URL`, `WORKSPACE_URL` | back to the real hosts, redeploy the watchdog |
| n8n emails | links | any `pages.dev` or workers.dev link → the real hosts |
| Google Search Console | Domain property | TXT verification in Cloudflare DNS, submit `/sitemap.xml` |
| Supabase Auth → SMTP | custom SMTP (Q1) | see `docs/runbooks/AUTH.md` → Email |

Announce "install the app" (PWA) to the team only now: an installed PWA is
tied to the origin it was installed from, so an install made on workers.dev
would have to be redone.

## 7. After two clean weeks

- **DMARC**: if the aggregate reports (the `rua=` address) show only your own
  senders passing, change `_dmarc` from `p=none` to `p=quarantine; pct=100`.
  Add `rua=mailto:<an inbox you read>` first if it is missing.
- **HSTS**: `includeSubDomains` belongs in the header only once no subdomain
  is served over plain http (old SiteGround names such as `webmail`, `cpanel`
  or `mail` count): with it, browsers that visited the site refuse those
  names over http for a year. At the time of writing `site/next.config.ts`
  already sends `max-age=31536000; includeSubDomains`; check the inventory
  from step 1 before the cutover and drop `includeSubDomains` from the build
  until this step if any http-only subdomain exists. Never add `preload`
  casually; it is near-permanent.
- **DNSSEC**: Cloudflare → DNS → Settings → Enable DNSSEC, then add the DS
  record it shows at the registrar.
- **Cleanup**: cancel the WordPress hosting only after the mail decision (Q1)
  is done if mail is still at SiteGround. Remove workers.dev hostnames from
  Turnstile, Supabase redirect URLs and `GOOGLE_CONNECT_ORIGINS`.
- **WAF**: Security → WAF → Rate limiting rule on `/api/contact` and
  `/api/subscribe` (e.g. 10 requests / minute / IP → block 10 minutes), on top
  of the database throttle.

---

## Deploy pipeline

`.github/workflows/site-deploy.yml` deploys production on every push to
`master` and a preview per pull request. It does nothing until switched on.

1. **Turn off the old automatic deploys first**: Workers & Pages →
   `nixgen-site` → Settings → Builds → disconnect the Git repository (and the
   old `mikoy0019` hookup / `deskdev-studio.pages.dev` project, if still there).
   Otherwise every push deploys twice.
2. Cloudflare → My Profile → API Tokens → Create Token → *Edit Cloudflare
   Workers* template, limited to account `5c6cabb0e7c2e306c3dd792599736a46`
   and zone `nixgensolutions.com`. GitHub → Settings → Secrets → Actions →
   `CLOUDFLARE_API_TOKEN`.
3. GitHub → Settings → Environments:
   - `production`: variables `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`,
     `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
     `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_CF_BEACON_TOKEN`.
     Add yourself as a *required reviewer* to approve each production deploy,
     and approve only once that change has passed the e2e video proof and the
     13-layer gate (repo rule, `AGENTS.md`). Deployment branches: `master` only.
   - `preview`: leave the Supabase pair empty (DeskDev runs in demo mode) or
     use the staging project's. Never production's.
4. Previews have a Worker of their own. `site/wrangler.jsonc`'s "preview"
   environment (`npx opennextjs-cloudflare deploy --env preview`, which is what
   the preview job runs) is `nixgen-site-preview`: its own workers.dev address,
   no custom domain, and none of production's Worker secrets, so a preview
   never holds `LEAD_INTAKE_SECRET` and its contact form falls back to email.
   Every pull request deploys to that one Worker, so the address shows the
   preview deployed last. The job still asks the config before each deploy
   and skips itself with a notice if the "preview" environment ever names the
   production Worker or a domain; `site/src/lib/cloudflareConfig.test.ts`
   fails on that first.
5. Repository variable `SITE_DEPLOY_ENABLED=true`.

Rollback of a bad deploy: Workers → `nixgen-site` → Deployments → pick the
previous version → **Rollback** (instant), then revert the commit.
