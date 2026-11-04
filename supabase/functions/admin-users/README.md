# admin-users Edge Function

Admin-only user lifecycle endpoint for DeskDev Studio. Handles
`{ action: 'create' | 'update' | 'delete' | 'deactivate' | 'reactivate', ...payload }`
via POST.

## Deploy

```bash
supabase functions deploy admin-users
```

Since migration 042 the database refuses every new `auth.users` row whose
address is not on `public.signup_allowlist` (the sign-up guard). The create
path puts the address there right before it asks Auth for the account and
takes it off again afterwards, through `signup_allowlist.ts` (tested in
`supabase/tests/admin-users-allowlist.test.mjs`). Order on a project: apply
042, then deploy this function. A version deployed before 042 cannot create
users once the guard is on; it answers "Could not create the user" until this
version is out. Nothing opens in between.

## Required secrets

These are injected automatically by Supabase for deployed functions — no
manual setup needed on the hosted platform:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

For local development (`supabase functions serve admin-users`), the local
stack provides them as well.

Optional: `APP_ORIGINS` — comma-separated origins (no paths) the browser may
call from, the same secret the `google` function reads. Unset, it defaults to
`https://nixgensolutions.com`, `https://www.nixgensolutions.com` and
`https://workspace.nixgensolutions.com`. Loopback origins
(`http://localhost:<port>`, `http://127.0.0.1:<port>`) are always allowed for
local dev. If DeskDev is served from anywhere else (e.g. a `*.workers.dev`
URL), list it here or the browser gets `403 Origin not allowed`. `vault-reset`
uses the same rule (its `cors.ts` is a copy of this one). Never expose `SUPABASE_SERVICE_ROLE_KEY` to any
client — it lives only inside this function.

## Request format

Call with the logged-in user's access token (must be an admin):

```ts
const { data, error } = await supabase.functions.invoke("admin-users", {
  body: {
    action: "create",
    email: "new.user@example.com",
    password: "temp-password-123",
    full_name: "New User",
    role: "member", // 'admin' | 'member'
    permissions: { tasks: "edit", projects: "view" },
    phone: "+63...",
    title: "Designer",
  },
});
```

Actions:

| action   | required fields                       | optional fields                                                    |
| -------- | ------------------------------------- | ------------------------------------------------------------------ |
| `create` | `email`, `password`, `full_name`      | `role`, `permissions`, `phone`, `title`, `avatar_color`             |
| `update` | `user_id`                             | `email`, `password`, `full_name`, `role`, `permissions`, `phone`, `title`, `avatar_color` |
| `delete` | `user_id`                             | —                                                                   |
| `deactivate` | `user_id`                         | —                                                                   |
| `reactivate` | `user_id`                         | —                                                                   |

Responses: `{ ok: true, user_id }` on success, `{ error }` with an
appropriate HTTP status otherwise.

Rules:

- `user_id` must be a UUID; `role` must be `admin` or `member`; an `email`
  that is present must not be blank. All of this is checked before anything
  is written.
- DeskDev always keeps one active admin: demoting, deactivating or deleting
  the last one answers `409`. Migration 032's `guard_last_admin` trigger is
  the backstop for two admins demoting each other at the same instant.
- You can't delete or deactivate yourself.
- The vault owner's account is protected: `vault_settings.owner_email`
  approves vault resets and can hand the vault over, so another admin can't
  change that account's email or password, or delete it (`403`), and no
  account can be created with, or moved onto, that address (`409`). The owner
  can still change their own password. Profile fields stay editable.
- `deactivate` is the offboarding path. It sets the profile to `member` with
  no permissions and stamps `profiles.deactivated_at` / `deactivated_by`
  (migration 032), which makes `is_admin()` and `has_perm()` refuse them at
  once. It deletes their push subscriptions and bans the auth account so no
  new session can start. An access token already issued lives until it
  expires (about an hour), with no rights. `reactivate` lifts the ban and
  clears `deactivated_at`; grant access again with `update`. Giving a role or
  permissions to a deactivated person answers `409` (reactivate first).
- `delete` is for test accounts. Since 032 every foreign key to `profiles` is
  `ON DELETE SET NULL`, so history stays with the name blanked. If GoTrue
  still reports a database error it answers `409 { code: 'user_has_history' }`.
- Audit: the function sends the verified admin's id as `x-deskdev-actor`, so
  032's triggers log role, permission, email and deactivation changes with
  that admin as the actor. Work done inside GoTrue is logged by the function
  through `write_audit_log`: `auth.user_created`, `auth.password_set`,
  `auth.user_deleted`, `auth.sign_in_blocked`, `auth.sign_in_restored`. A
  failed audit write is logged and never fails the action.
- Deploy order: apply migration 032 before deploying this version. It reads
  `profiles.deactivated_at`, so against an older database every call answers
  `403`.
- GoTrue's 4xx messages (e.g. "already registered", password rules) are
  returned as-is. Database and unexpected errors are logged in the function
  and answered with a fixed sentence.
