#!/usr/bin/env node
// Sets up DeskDev's integrations on the live Supabase project. Every step
// first looks at what is already there, so it is safe to run again: it never
// rotates a key that is in use and never sends a secret that has not changed.
//
//   node scripts/setup-integrations.mjs --dry-run            what would change (changes nothing)
//   node scripts/setup-integrations.mjs                      push + google
//   node scripts/setup-integrations.mjs --only push
//   node scripts/setup-integrations.mjs --only google [--dev-origin] [--redirect-base <url>]
//   node scripts/setup-integrations.mjs --only env --yes-env  OWNER ONLY (rewrites env files)
//
// Parts, and the env keys each one writes
//   push    Web Push (supabase/PUSH.md): the VAPID key pair, the send-push
//           function secrets and the two Vault rows the triggers read.
//           Adds VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to the
//           secrets file, and NEXT_PUBLIC_VAPID_PUBLIC_KEY to site/.env.local.
//   google  Everything Google connect needs that does not come from Google:
//           the token sealing key, the allowed origins, the calendar webhook
//           secret and its Vault rows. The OAuth client id and secret are
//           sent to the function once the owner has put them in the env file.
//           Adds GOOGLE_TOKEN_KEYS and GOOGLE_TOKEN_KEY_ID to the secrets file.
//   env     The env layout AGENTS.md describes: a repo-root .env.local (copied
//           from the legacy web/.env.local), site/.env.local with public
//           values only, and site/.dev.vars. The only part that rewrites a
//           file as a whole; it never runs unless asked for. It also connects
//           LOCAL DEV TO THE LIVE DATABASE: site/.env.local then names the
//           live project, where today "npm run dev" shows the demo workspace.
//   push and google only ADD the lines named above to a file that exists (one
//   atomic write per file, proven before and read back after). That is still
//   an edit of an env file: an agent runs them only with the owner's go-ahead.
//
// Flags
//   --rotate-vapid      make a NEW key pair although devices are subscribed (each
//                       must open DeskDev again). Only when neither the function
//                       nor the env file holds a pair.
//   --resume-push       write the push URL row although everything else was already
//                       in place: after a pause (PUSH.md "Disable"), or after a run
//                       that stopped before its last step
//   --resume-calendar   the same for the calendar sync URL row
//   --dev-origin        add http://localhost:6969 to APP_ORIGINS (local testing)
//   --workers-dev-origin  add the production Worker's workers.dev address to
//                       APP_ORIGINS, for the time before the domain is attached
//   --prod-origins      set APP_ORIGINS back to the production list (takes both
//                       extras out again)
//   --replace-client    send the env file's Google OAuth client although the
//                       function holds a different one
//   --redirect-base U   set GOOGLE_REDIRECT_BASE (the apex proxy, google/README.md §5)
//   --force             write env files although a dev server is listening
//
// Exit codes
//   0  done (a dry run always ends 0, also when it lists open points)
//   1  stopped; the sentence says what was and was not changed
//   2  ran to the end, but something is still open (the output says which
//      command closes it)
//
// How secrets are handled
//   - Nothing secret is printed: the output is names, counts and yes/no.
//   - A value both the database and a function must hold is generated inside
//     the database (Vault) and read back into memory.
//   - A key that cannot be read back from Supabase (the VAPID pair, the Google
//     token key) is saved in the secrets file first, and read back from it, so
//     a failed run can pick it up and a later rotation still has the old key.
//   - Function secrets go to the Supabase CLI binary as process arguments,
//     without a shell. A secret whose digest already matches is not sent again,
//     and what was sent is checked against the digests Supabase lists.
//   - The CLI runs in an empty folder of its own, so it never loads an env
//     file or a supabase/config.toml from this repo.
//   - SQL sent to the database never contains a secret.
//   - A function is only ever pointed at after it has answered as configured
//     and accepted the Vault secret; both probes do no work in the function.
//
// The work is in lib/setup-core.mjs. This file only says where the real
// surroundings are. There is no test mode in this command: the tests run the
// same core through their own entry, with their own project ref and CLI.

import os from 'node:os'
import path from 'node:path'
import { REPO_ROOT } from './lib/env.mjs'
import { PROJECT_REF, findCli, listeningPorts, runSetup } from './lib/setup-core.mjs'

runSetup(process.argv.slice(2), {
  ref: PROJECT_REF,
  fn: `https://${PROJECT_REF}.supabase.co/functions/v1`,
  root: REPO_ROOT,
  repoRoot: REPO_ROOT,
  chain: {},
  cli: findCli,
  ports: () => listeningPorts(),
  lockFile: path.join(os.tmpdir(), `deskdev-setup-integrations-${PROJECT_REF}.lock`),
}).then((code) => {
  // Not process.exit(): on Windows it can abort inside libuv while a probe's
  // socket is still closing. The exit code is set and the loop drains by itself.
  process.exitCode = code
})
