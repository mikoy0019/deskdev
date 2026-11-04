# Auth settings (Supabase Authentication)

The Supabase Auth settings DeskDev depends on, for the live project
`rgasjotvqwkjbeivlhvn` and, the same way, for a staging project. They live in
the dashboard, not in migrations, so this page is their record. Owner (or an
admin with dashboard access) applies them; every step is a dashboard click.

Use it at three moments: now (sign-ups, email), at the DNS cutover
(`DNS-CUTOVER.md` step 6), and after a restore into a new project
(`BACKUP-RESTORE.md` R7).

| # | Setting | Why it matters |
|---|---|---|
| 1 | Public sign-ups **off** | Anyone could create an account otherwise |
| 2 | Site URL + redirect URLs | Password-reset links land on the wrong host or are refused |
| 3 | Custom SMTP | The default sender only delivers to the project's own team; staff resets fail today |
| 4 | Passwords + sessions | Weak passwords; stolen refresh tokens |
| 5 | MFA (TOTP) | The Vault already needs it; admin writes will (plan D2) |
| 6 | CAPTCHA stays **off** | Turning it on without the code change locks everyone out |
| 7 | On- and offboarding | A leaver keeps access |

---

## 1. Sign-ups off

Authentication → Sign In / Providers → **Allow new users to sign up: off**.
Keep **Email** enabled as a provider (that is the password login), with
**Confirm email: on**, **Secure email change: on** and **Secure password
change: on**.

Every account is created by an admin in DeskDev (Settings → Users), which calls
the `admin-users` Edge Function with the service role. Since 024 a self-made
account would only ever be a member, but it should not exist at all: it gets
a profile, so it shows in the staff directory, in New chat and in mentions
under a name its maker chose, and once it can confirm its email (section 3
makes that possible) it reads what every signed-in profile reads.

This switch is the first lock and stays a required step. On 2026-10-04 it
was found **on** although this page said off, which is why there is a second
one.

**The second lock: the database (migration 042).** A trigger on `auth.users`
refuses every account that Supabase Auth tries to insert (sign-up, magic
link, OAuth, invite, the admin API, the dashboard's *Add user*) unless the
address is on `public.signup_allowlist` at that moment. `admin-users` puts it
there for the seconds the create takes; an entry is used up by the account
and expires after ten minutes otherwise. It holds whatever this switch says,
and it does not replace the switch: with the switch off Auth answers a
stranger "Signups not allowed", with only the guard it answers "Database
error saving new user".

- The first admin of a new project, and what an operator may still do in
  SQL: `supabase/README.md`, *First admin*.
- Is the guard on (SQL editor, read-only; expect `on_auth_user_created` and
  `signup_guard`, both `O`):
  ```sql
  SELECT tgname, tgenabled FROM pg_trigger
   WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
  ```
- Does it catch Supabase Auth on this project? The query above cannot tell:
  the guard lets `postgres` and `supabase_admin` sessions through, so it only
  holds while Auth logs in under another name. Prove it once per project,
  right after 042 is applied (and after a restore into a new project):
  `supabase/README.md`, *Prove the guard on the project*. In short: Auth shows
  in `pg_stat_activity` as `supabase_auth_admin`, and a dashboard *Add user*
  with a throwaway address that is not on the allow-list ends in a database
  error and no account.
- Emergency off, if admins cannot add users and the guard is the cause (the
  switch above is then the only lock, so check it first):
  `DROP FUNCTION public.signup_guard() CASCADE;`
  Back on: apply `supabase/migrations/042_signup_guard.sql` again.

Check the switch (any shell; read-only, uses the public anon key, never the
service key):

```bash
curl -s "https://rgasjotvqwkjbeivlhvn.supabase.co/auth/v1/settings" \
  -H "apikey: $SUPABASE_ANON_KEY"
# expect: "disable_signup": true
```

Do not test with `POST /auth/v1/signup`: if sign-ups turn out to be allowed
and the guard is missing, that request creates a real account. The guard's
own proof (above) is the one exception to "do not create anything": a single
*Add user* in the dashboard, by an operator, with an address they chose, and
the account is deleted on the spot if it gets through.

## 2. Site URL and redirect URLs

Authentication → URL Configuration.

- **Site URL**: `https://workspace.nixgensolutions.com`
  (before the DNS cutover: the workers.dev host + `/workspace`).
- **Redirect URLs** (one per line; `**` matches any path):

  | URL | Why |
  |---|---|
  | `https://workspace.nixgensolutions.com/**` | DeskDev on its own host (reset-password, callbacks) |
  | `https://nixgensolutions.com/workspace/**` | DeskDev under the site host (the site's "Forgot password" on a single-host build) |
  | `https://nixgen-site.<subdomain>.workers.dev/**` | the pre-cutover proof; remove after step 7 of the cutover |
  | `http://localhost:6969/**`, `http://workspace.localhost:6969/**` | local dev (`cd site && npm run dev`) |

- **Remove** anything older: `localhost:3000`, `*.pages.dev`, the retired web
  app's hosts. A forgotten entry is a host that can receive reset tokens.

Where the URLs come from: both "Forgot password" forms (the site's `/login`
and DeskDev's own) send `redirectTo` = `<DeskDev origin>/reset-password`. The
site-to-DeskDev login handoff (`/auth/callback#dd_at=…`) is not a Supabase
redirect and needs no entry; it is covered by the wildcard anyway.

## 3. Email: custom SMTP

Supabase's built-in sender delivers **only to members of the Supabase
project team** and is limited to a few emails an hour. Until custom SMTP is
set, a staff member's password reset never arrives.

**Recommended: Resend for system mail**, whatever Q1 (company mailboxes)
decides. It needs no mailbox seat, and its DNS records sit on a `send.`
subdomain plus one DKIM selector, so they never touch the MX/SPF records that
carry company mail.

1. resend.com → Domains → Add `nixgensolutions.com` (region closest to the
   team's users). It shows 3-4 records: `resend._domainkey` (TXT, DKIM), and
   on `send.nixgensolutions.com` an MX and an SPF TXT. Add them at whoever
   serves DNS today (before the cutover) or in Cloudflare (after). Mark them
   in the `DNS-CUTOVER.md` inventory so the move copies them. Wait for
   *Verified*.
2. Resend → API Keys → create `supabase-auth`, permission **Sending access**,
   domain `nixgensolutions.com` only.
3. Supabase → Authentication → Emails → **SMTP Settings** → enable custom SMTP:

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@nixgensolutions.com` |
   | Sender name | `NixGen` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the `supabase-auth` API key (paste it here only) |
   | Minimum interval | 30 seconds (default 60 is fine too) |

4. Authentication → Rate Limits → **emails sent per hour**: raise from the
   built-in default to `30`.
5. Test: Settings → Users → pick a non-admin test account → reset password
   (or the site's "Forgot password"). Gmail → *Show original*: SPF, DKIM and
   DMARC all `PASS`.

Alternative if everything must stay in Google Workspace: a `no-reply@`
Workspace user with 2-Step Verification and an app password, host
`smtp.gmail.com`, port `587`. It counts against that user's sending limits and
needs a seat.

**Templates** (Authentication → Emails → Templates): brand *Reset password*,
*Invite user*, *Change email address* and *Confirm signup* with the NixGen
name and the support address. Keep `{{ .ConfirmationURL }}` intact. Never
mention where the team is located.

## 4. Passwords and sessions

Authentication → Sign In / Providers → Email, and Authentication → Sessions:

| Setting | Value |
|---|---|
| Minimum password length | 12 |
| Password requirements | lowercase, uppercase, digits |
| Leaked password protection (HaveIBeenPwned) | **on** (Pro plan only; turn on the day the plan is upgraded) |
| Refresh token rotation | on, reuse interval 10 s (the default) |
| Access token (JWT) expiry | 3600 s (the default). Shorter means a deactivated user's last token dies sooner, at the cost of more refreshes |
| Time-box / inactivity timeout (Pro) | optional: 7 days inactivity is a sensible start |

## 5. MFA (TOTP)

Authentication → Multi-Factor → **TOTP: enabled** (it is on by default; check
it was not switched off). Leave phone/SMS MFA off: it costs money per message
and is weaker.

- The **Vault** already requires a TOTP-upgraded (`aal2`) session for every
  read and write (migrations 030 and 031). Losing the authenticator app is
  covered by `supabase/VAULT-RECOVERY.md`.
- **Admins**: every admin enrols TOTP (issuer *DeskDev Studio*). Plan D2 adds
  RESTRICTIVE `aal2` policies on admin write paths and an `aal` check in
  `admin-users`; once that ships, an admin without a factor can read but not
  change users, settings or the showcase.
- **Lost authenticator (non-Vault)**: the owner removes the person's factor in
  Authentication → Users → the user → *Factors* → delete, then the person
  enrols again at their next sign-in. Note it in the audit trail:
  `SELECT public.write_audit_log('auth.mfa_factor_reset', 'profile', '<user id>', '{}'::jsonb);`

## 6. CAPTCHA: leave it off

Authentication → Bot and Abuse Protection → *Enable CAPTCHA protection* stays
**off**. With it on, Supabase rejects every sign-in and password reset that
does not carry a CAPTCHA token, and neither login form sends one today: the
whole team would be locked out. Turnstile protects the public contact and
newsletter forms (`site/src/lib/guard.ts`), which do not go through Supabase
Auth. Turning Auth CAPTCHA on is a code change first (both login forms pass
`options.captchaToken`), then this switch.

## 7. On- and offboarding

**Joiner**
1. DeskDev → Settings → Users → *Add user*: email, a temporary password, role
   and per-feature permissions. The account is created confirmed (no email
   needed).
2. Send the temporary password over a different channel than the email
   address, and ask them to change it on first sign-in (profile menu →
   change password, or "Forgot password").
3. Admins: enrol TOTP the same day (section 5).

**Leaver (default: Deactivate)**
1. DeskDev → Settings → Users → the person → **Deactivate**. In one action it
   drops their role and permissions, stamps `profiles.deactivated_at`, deletes
   their push subscriptions and bans the auth account so no new session can
   start. Their work history (tasks, messages, time entries) stays. An access
   token they already hold keeps working, with no rights, until it expires
   (up to the JWT expiry above). The audit log records
   `profile.deactivated` and `auth.sign_in_blocked`.
2. Outside DeskDev, the same day:
   - Google: suspend their Workspace seat (if any) and remove them from the
     shared "NixGen Team" calendar; revoke their DeskDev Google grant
     (Settings → Integrations, once Google is connected).
   - Remove them from GitHub, Cloudflare, Supabase, Render/n8n and the
     registrar if they had access.
   - Rotate any shared credential they could read in the Vault, and any key
     they handled (deploy tokens, webhook secrets).
3. **Reactivate** restores sign-in but not rights: grant permissions again.

**Delete** (Settings → Users → Delete) is for test accounts. It removes the
auth user; history they touched keeps the rows with the person blanked
(`ON DELETE SET NULL`, migration 032). Use it for a real person only to honour
a deletion request (`DATA-REQUESTS.md`).

---

## Checklist (copy into the cutover or recovery ticket)

- [ ] Sign-ups off: `GET /auth/v1/settings` shows `"disable_signup": true`; the `signup_guard` trigger is on `auth.users` (042)
- [ ] The guard is proven on this project (`supabase/README.md`, *Prove the guard on the project*): Auth connects as `supabase_auth_admin`, and a dashboard *Add user* without an allow-list row gave a database error and no account. Date written in the ledger row (live project) or in this ticket
- [ ] Site URL and redirect URLs as in section 2; old hosts removed
- [ ] Custom SMTP on; a reset email to a non-team address arrives with SPF/DKIM/DMARC pass
- [ ] Email rate limit raised; templates branded, no location
- [ ] Password length 12 + requirements; leaked-password protection on (Pro)
- [ ] TOTP enabled; every admin has a verified factor
- [ ] CAPTCHA off (until the login forms send tokens)
- [ ] Staging project: the same settings, with its own hosts
