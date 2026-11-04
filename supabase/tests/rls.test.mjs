// Row level security, tried rather than read: who gets which rows of every
// table in public, and who can change them.
//
// Every attempt goes through tryAs(): BEGIN, SET LOCAL ROLE, the JWT claims
// in request.jwt.claims (what auth.uid(), auth.jwt() and the Vault's aal
// check read), the statement, ROLLBACK. That is the sequence PostgREST sends,
// so a policy sees here what it sees behind the API, and no attempt leaves
// anything behind for the next one.
//
// The people:
//   anon       the public key, no session (the site Worker, any visitor)
//   nobody     signed in, but no profile row
//   gone       deactivated (032). The profile still says admin with every
//              permission: the worst case, where only deactivated_at is left
//              to take the rights away. Its token is still valid.
// nobody and gone are "not active" (043): they read and write no row.
//   B          a member with no permissions
//   A          a member with edit on every feature; the owner of the seeded rows
//   admin      an admin with a password-only session (aal1)
//   adminTotp  the same admin after the authenticator step (aal2)
// Everyone except admin holds an aal2 session, so wherever the Vault refuses
// them it is the role that refuses, and where it refuses admin it is the
// missing second factor.
//
// Adding a table: seed a row in seed(), add a line to READS. The suite fails
// until both are there.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { addUser, applyMigration, asAnon, asUser, freshDatabase, one, rows, tryAs } from './harness.mjs'

/** The file that closed what this suite found; some tests apply it again. */
const MIGRATION_043 = '043_active_accounts_only.sql'

const ID = {
  admin: '00000000-0000-4000-8000-0000000000ad',
  A: '00000000-0000-4000-8000-00000000000a',
  B: '00000000-0000-4000-8000-00000000000b',
  gone: '00000000-0000-4000-8000-0000000000de',
  nobody: '00000000-0000-4000-8000-000000000000',
}
const EMAIL = {
  admin: 'ada.admin@example.test',
  A: 'amy.a@example.test',
  B: 'ben.b@example.test',
  gone: 'gil.gone@example.test',
  nobody: 'nell.nobody@example.test',
}
const session = (name, aal) => ({ id: ID[name], email: EMAIL[name], aal })
const ACTORS = {
  anon: 'anon',
  nobody: session('nobody', 'aal2'),
  gone: session('gone', 'aal2'),
  B: session('B', 'aal2'),
  A: session('A', 'aal2'),
  admin: session('admin', 'aal1'),
  adminTotp: session('admin', 'aal2'),
}

const FEATURES = ['projects', 'tasks', 'clients', 'crm', 'calendar', 'meetings', 'growth', 'courses', 'showcase']
const EVERY_PERMISSION = Object.fromEntries(FEATURES.map((f) => [f, 'edit']))
const INTAKE_SECRET = 'rls-suite-intake-secret'

/** A label for a row that only has a person to tell it by. */
const person = (column) =>
  `CASE ${column} ${Object.entries(ID).map(([name, id]) => `WHEN '${id}' THEN '${name}'`).join(' ')} ELSE 'someone else' END`

let db
/** Ids and tokens of seeded rows the write checks aim at. */
let S

// ------------------------------------------------------------------- seed

async function seed() {
  const id = async (sql, params) => (await one(db, `${sql} RETURNING id`, params)).id
  const s = {}

  await addUser(db, { id: ID.admin, email: EMAIL.admin, fullName: 'Ada Admin', role: 'admin' })
  await addUser(db, { id: ID.A, email: EMAIL.A, fullName: 'Amy A', permissions: EVERY_PERMISSION })
  await addUser(db, { id: ID.B, email: EMAIL.B, fullName: 'Ben B' })
  await addUser(db, { id: ID.gone, email: EMAIL.gone, fullName: 'Gil Gone', role: 'admin', permissions: EVERY_PERMISSION })
  await addUser(db, { id: ID.nobody, email: EMAIL.nobody, fullName: 'Nell Nobody' })
  await db.query('DELETE FROM public.profiles WHERE id = $1', [ID.nobody])

  // What the migrations seed would only blur the lists below.
  await db.exec('DELETE FROM public.showcase_items; DELETE FROM public.channels; DELETE FROM public.channel_categories')
  await db.query(`SELECT vault.create_secret($1, 'lead_intake_secret')`, [INTAKE_SECRET])

  // ---- clients, projects, tasks, CRM, courses, growth: one permission each
  const category = await id(`INSERT INTO public.client_categories (name) VALUES ('Retail')`)
  s.client = await id(`INSERT INTO public.clients (name, category_id) VALUES ('Acme', $1)`, [category])
  const projectCategory = await id(`INSERT INTO public.project_categories (client_id, name) VALUES ($1, 'Web')`, [s.client])
  s.project = await id(
    `INSERT INTO public.projects (client_id, category_id, title, created_by) VALUES ($1, $2, 'Acme site', $3)`,
    [s.client, projectCategory, ID.A])
  s.task = await id(
    `INSERT INTO public.tasks (client_id, project_id, title, assignee_id, created_by) VALUES ($1, $2, 'Write copy', $3, $3)`,
    [s.client, s.project, ID.A])
  await db.query(
    `INSERT INTO public.task_activity (task_id, client_id, actor_id, action) VALUES ($1, $2, $3, 'created')`,
    [s.task, s.client, ID.A])
  await db.query(
    `INSERT INTO public.time_entries (task_id, client_id, user_id, entry_date, minutes, note)
     VALUES ($1, $2, $3, current_date, 30, 'A wrote copy')`, [s.task, s.client, ID.A])
  await db.query(
    `INSERT INTO public.eod_reports (author_id, client_id, report_date, content) VALUES ($1, $2, current_date, 'A: end of day')`,
    [ID.A, s.client])

  const crmTable = await id(`INSERT INTO public.crm_tables (name, client_id, created_by) VALUES ('Pipeline', $1, $2)`, [s.client, ID.A])
  await db.query(`INSERT INTO public.crm_columns (table_id, name, type) VALUES ($1, 'Stage', 'text')`, [crmTable])
  await db.query(
    `INSERT INTO public.crm_rows (table_id, "values", created_by) VALUES ($1, '{"name": "Row of A"}', $2)`, [crmTable, ID.A])

  const course = await id(`INSERT INTO public.courses (title, created_by) VALUES ('Onboarding', $1)`, [ID.A])
  const courseModule = await id(`INSERT INTO public.course_modules (course_id, title) VALUES ($1, 'Module 1')`, [course])
  await db.query(`INSERT INTO public.course_topics (module_id, title) VALUES ($1, 'Topic 1')`, [courseModule])

  await db.query(`INSERT INTO public.campaigns (name, week_of, owner_id) VALUES ('Q4 email', current_date, $1)`, [ID.A])
  await db.query(`INSERT INTO public.job_postings (source, url, title) VALUES ('board', 'https://jobs.example.test/1', 'Build a site')`)
  s.lead = await id(
    `INSERT INTO public.leads (name, email, form, owner_id) VALUES ('Lead Larry', 'larry@lead.example.test', 'import', $1)`, [ID.A])
  await db.query(`INSERT INTO public.lead_activity (lead_id, actor_id, action) VALUES ($1, $2, 'note')`, [s.lead, ID.A])
  await db.query(
    `INSERT INTO public.lead_intake_attempts (email_norm, lead_id, status) VALUES ('larry@lead.example.test', $1, 'created')`, [s.lead])
  s.subscriber = await id(`INSERT INTO public.site_subscribers (email) VALUES ('reader@example.test')`)
  await db.query(`INSERT INTO public.site_subscriber_attempts (email_norm) VALUES ('reader@example.test')`)

  await db.query(`INSERT INTO public.project_engagements(project_id,terms) VALUES($1,'{}'::jsonb)`, [s.project])
  await db.query(`INSERT INTO public.cube_intakes(project_id) VALUES($1)`, [s.project])
  await db.query(`INSERT INTO public.cube_work_items(key,department,subject_type,subject_id,title,instruction,urgency)
    VALUES('fixture','finance','project',$1,'Agreement review','Record acceptance evidence','attention')`, [s.project])
  await db.query(`INSERT INTO public.cube_operation_history(work_key,action) VALUES('fixture','created')`)
  const recordingFolder = await id(`INSERT INTO public.recording_folders (client_id, name, created_by) VALUES ($1, 'Kickoffs', $2)`, [s.client, ID.A])
  await db.query(
    `INSERT INTO public.meeting_recordings (client_id, folder_id, title, url, created_by)
     VALUES ($1, $2, 'Kickoff recording', 'https://www.loom.com/share/fixture', $3)`, [s.client, recordingFolder, ID.A])
  const boardFolder = await id(`INSERT INTO public.whiteboard_folders (name, created_by) VALUES ('Sketches', $1)`, [ID.A])
  await db.query(`INSERT INTO public.whiteboards (folder_id, title, created_by) VALUES ($1, 'Site map', $2)`, [boardFolder, ID.A])

  // ---- forms (046, 047): the most specific anchor decides. The project's
  // onboarding form follows projects, the lead's discovery form follows
  // growth; the discovery form also carries a customer link (only its hash
  // is stored), which the form-link doors look up.
  s.formToken = 'rls-suite-form-link-token-0123456789abcdef'
  s.form = {}
  s.form.onboarding = await id(
    `INSERT INTO public.form_responses (form, project_id, client_id, answers, created_by)
     VALUES ('onboarding', $1, $2, '{"scope": "A site"}', $3)`, [s.project, s.client, ID.A])
  s.form.discovery = await id(
    `INSERT INTO public.form_responses (form, lead_id, answers, created_by, share_token_hash, share_expires_at, shared_by)
     VALUES ('discovery', $1, '{"goal": "More leads"}', $2, encode(sha256(convert_to($3, 'UTF8')), 'hex'),
             now() + interval '14 days', $2)`, [s.lead, ID.A, s.formToken])

  // ---- booking (048): the throttle ledger, admins only
  await db.query(`INSERT INTO public.booking_attempts (ip_hash, email_norm, status) VALUES ('ip-hash', 'larry@lead.example.test', 'booked')`)

  // ---- email (049): a reply from the lead, anchored to it (growth). Inbound,
  // so the send trigger has nothing to post.
  s.email = await id(
    `INSERT INTO public.emails (direction, status, lead_id, from_email, to_emails, subject, body_text, received_at)
     VALUES ('in', 'received', $1, 'larry@lead.example.test', ARRAY['studio@example.test'], 'Re: your site', 'Sounds good', now())`,
    [s.lead])

  // ---- calendar
  s.meeting = await id(
    `INSERT INTO public.events (kind, title, starts_at, created_by) VALUES ('meeting', 'Kickoff', now() + interval '1 day', $1)`, [ID.A])
  await db.query(
    `INSERT INTO public.events (kind, title, starts_at, created_by) VALUES ('event', 'Launch day', now() + interval '2 days', $1)`, [ID.A])
  await db.query(`INSERT INTO public.event_attendees (event_id, profile_id, email) VALUES ($1, $2, NULL)`, [s.meeting, ID.A])
  await db.query(`INSERT INTO public.event_attendees (event_id, email) VALUES ($1, 'guest@client.example.test')`, [s.meeting])
  // The app's own function: it is the only way to get a token whose hash is stored.
  s.feedToken = (await asUser(db, ACTORS.A, () => one(db, `SELECT public.calendar_feed_rotate('mine') AS token`))).token
  await db.query(
    `INSERT INTO public.google_connections (user_id, google_email, refresh_token_enc) VALUES ($1, 'amy@gmail.example.test', 'v1.sealed')`,
    [ID.A])
  await db.query(
    `INSERT INTO public.google_workspace_link (google_email, refresh_token_enc, connected_by)
     VALUES ('studio@gmail.example.test', 'v1.sealed', $1)`, [ID.admin])
  await db.query(`INSERT INTO public.google_sync_outbox (event_id, op) VALUES ($1, 'upsert')`, [s.meeting])

  // ---- own-row tables: one row for each person
  s.notification = {}
  for (const name of ['admin', 'A', 'B', 'gone']) {
    s.notification[name] = await id(
      `INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES ($1, $2, 'task_assigned', $3)`,
      [ID[name], ID.admin, `for ${name}`])
  }
  s.push = {}
  for (const name of ['A', 'B', 'gone']) {
    s.push[name] = await id(
      `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, app_base)
       VALUES ($1, $2, 'p256dh', 'auth', 'https://desk.example.test')`, [ID[name], `https://push.example.test/${name}`])
  }
  // The phone app's devices (050).
  for (const name of ['A', 'B']) {
    await db.query(
      `INSERT INTO public.push_devices (user_id, token, platform) VALUES ($1, $2, 'android')`,
      [ID[name], `ExponentPushToken[device-${name}-0000]`])
  }

  // ---- chat: admins are not participants of other people's conversations
  s.conversation = {}
  s.message = {}
  const conversation = async (title, creator, other) => {
    s.conversation[title] = await id(
      `INSERT INTO public.conversations (title, participant_ids, created_by) VALUES ($1, $2::uuid[], $3)`,
      [title, [ID[creator], ID[other]], ID[creator]])
  }
  const message = async (title, sender, body) => {
    s.message[body] = await id(
      `INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)`, [s.conversation[title], ID[sender], body])
  }
  const read = (title, name) => db.query(
    `INSERT INTO public.conversation_reads (conversation_id, user_id) VALUES ($1, $2)`, [s.conversation[title], ID[name]])
  await conversation('A and admin', 'A', 'admin')
  await conversation('admin and B', 'admin', 'B')
  await conversation('A and gone', 'A', 'gone')
  await message('A and admin', 'A', 'A to admin')
  await message('admin and B', 'B', 'B to admin')
  await message('admin and B', 'admin', 'admin to B')
  await message('A and gone', 'A', 'A to gone')
  await read('A and admin', 'A')
  await read('A and admin', 'admin')
  await read('admin and B', 'B')
  await read('A and gone', 'gone')

  // ---- channels: the studio space (client_id NULL) and one client's space
  const studio = await id(`INSERT INTO public.channel_categories (name, created_by) VALUES ('Studio', $1)`, [ID.A])
  const acmeSpace = await id(
    `INSERT INTO public.channel_categories (name, client_id, created_by) VALUES ('Acme space', $1, $2)`, [s.client, ID.A])
  s.channel = {}
  s.channelMessage = {}
  // Each channel is made by `owner`, who also writes its one message and reacts to it.
  const channel = async (name, owner, { category, client = null, isPrivate = false }) => {
    s.channel[name] = await id(
      `INSERT INTO public.channels (name, category_id, client_id, is_private, member_ids, created_by)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6)`,
      [name, category, client, isPrivate, isPrivate ? [ID[owner]] : [], ID[owner]])
    s.channelMessage[name] = await id(
      `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, $3)`, [s.channel[name], ID[owner], `in ${name}`])
    await db.query(
      `INSERT INTO public.channel_reactions (message_id, channel_id, user_id, emoji) VALUES ($1, $2, $3, $4)`,
      [s.channelMessage[name], s.channel[name], ID[owner], `on ${name}`])
  }
  await channel('general', 'A', { category: studio })
  await channel('a-private', 'A', { category: studio, isPrivate: true })
  await channel('b-private', 'B', { category: studio, isPrivate: true })
  await channel('acme-general', 'A', { category: acmeSpace, client: s.client })
  const channelRead = (name, who) => db.query(
    `INSERT INTO public.channel_reads (channel_id, user_id) VALUES ($1, $2)`, [s.channel[name], ID[who]])
  await channelRead('general', 'A')
  await channelRead('a-private', 'A')
  await channelRead('general', 'B')
  await channelRead('general', 'admin')
  await channelRead('general', 'gone')

  // ---- the Vault
  s.vaultMeta = await id(`INSERT INTO public.vault_meta (salt, iterations, wrapped_key) VALUES ('salt', 600000, 'wrapped')`)
  s.vaultFolder = await id(
    `INSERT INTO public.vault_folders (name_enc, meta_id, created_by) VALUES ('enc:folder', $1, $2)`, [s.vaultMeta, ID.admin])
  s.vaultItem = await id(
    `INSERT INTO public.vault_items (folder_id, title_enc, data_enc, meta_id, created_by) VALUES ($1, 'enc:item', 'enc:data', $2, $3)`,
    [s.vaultFolder, s.vaultMeta, ID.admin])
  await db.query(
    `INSERT INTO public.vault_key_slots (meta_id, user_id, kind, salt, iterations, wrapped_key, created_by)
     VALUES ($1, $2, 'password', repeat('a', 32), 210000, 'abcdef', $2)`, [s.vaultMeta, ID.admin])
  await db.query(
    `INSERT INTO public.vault_reset_codes (code_hash, requested_by, sent_to, expires_at)
     VALUES ('hash', $1, 'owner@example.test', now() + interval '10 minutes')`, [ID.admin])
  await db.exec(`UPDATE public.vault_settings SET owner_email = 'owner@example.test'`)

  // ---- showcase: what the public site reads with the anon key
  const showcase = (slug, status, linkStatus) => id(
    `INSERT INTO public.showcase_items (slug, title, url, status, consent, link_status, client_id)
     VALUES ($1, $1, 'https://' || $1 || '.example.test', $2, 'internal', $3, $4)`, [slug, status, linkStatus, s.client])
  s.showcase = await showcase('published-site', 'published', 'ok')
  await showcase('down-site', 'published', 'down')
  await showcase('draft-site', 'draft', 'unknown')
  await db.query(
    `INSERT INTO public.showcase_link_checks (item_id, request_id, url) VALUES ($1, 1, 'https://published-site.example.test')`,
    [s.showcase])

  // ---- service-only
  await db.query(`INSERT INTO public.automation_runs (job, status, execution_id) VALUES ('nightly-check', 'ok', 'run-1')`)
  await db.query(`INSERT INTO public.signup_allowlist (email, invited_by) VALUES ('invitee@example.test', $1)`, [ID.admin])

  // Last, so that everything above exists when the account is switched off.
  await db.query('UPDATE public.profiles SET deactivated_at = now(), deactivated_by = $2 WHERE id = $1', [ID.gone, ID.admin])
  return s
}

before(async () => {
  db = await freshDatabase()
  S = await seed()
})
after(async () => { await db?.close() })

// -------------------------------------------------------------- the switch

test('tryAs is the switch the policies read: role, auth.uid(), auth.jwt() and aal', async () => {
  const identity = () => one(db, `
    SELECT session_user::text AS session, current_user::text AS role, auth.uid()::text AS uid,
           auth.role() AS jwt_role, auth.email() AS email, auth.jwt() ->> 'aal' AS aal`)

  assert.deepEqual(await tryAs(db, 'anon', identity),
    { session: 'authenticator', role: 'anon', uid: null, jwt_role: 'anon', email: null, aal: null })
  assert.deepEqual(await tryAs(db, ACTORS.B, identity),
    { session: 'authenticator', role: 'authenticated', uid: ID.B, jwt_role: 'authenticated', email: EMAIL.B, aal: 'aal2' })
  assert.deepEqual(await tryAs(db, ACTORS.admin, identity),
    { session: 'authenticator', role: 'authenticated', uid: ID.admin, jwt_role: 'authenticated', email: EMAIL.admin, aal: 'aal1' })
  assert.deepEqual(await tryAs(db, 'service_role', identity),
    { session: 'authenticator', role: 'service_role', uid: null, jwt_role: 'service_role', email: null, aal: null })

  // Nothing of a request survives it.
  assert.deepEqual(await identity(), { session: 'postgres', role: 'postgres', uid: null, jwt_role: null, email: null, aal: null })
  await tryAs(db, ACTORS.B, () => db.query(`UPDATE public.profiles SET full_name = 'changed' WHERE id = $1`, [ID.B]))
  assert.equal((await one(db, 'SELECT full_name FROM public.profiles WHERE id = $1', [ID.B])).full_name, 'Ben B')
})

test('the seed: the people are who the header says they are', async () => {
  const people = await rows(db, `
    SELECT ${person('id')} AS who, role, permissions = $1::jsonb AS every_permission, deactivated_at IS NOT NULL AS deactivated
      FROM public.profiles ORDER BY 1`, [JSON.stringify(EVERY_PERMISSION)])
  assert.deepEqual(people, [
    { who: 'A', role: 'member', every_permission: true, deactivated: false },
    { who: 'B', role: 'member', every_permission: false, deactivated: false },
    { who: 'admin', role: 'admin', every_permission: false, deactivated: false },
    // Not demoted on purpose: deactivated_at alone has to be enough.
    { who: 'gone', role: 'admin', every_permission: true, deactivated: true },
  ])
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM auth.users WHERE id = $1', [ID.nobody])).n, 1)
})

// ---------------------------------------------------------------- reading

const REFUSED = 'REFUSED' // the statement fails: no grant on the table (42501)
const none = Object.freeze([]) // the statement runs and RLS leaves no row
const ALL = 'ALL' // every row there is
const SOME = 'SOME' // rows the migrations or triggers put there; not listed

/**
 * One line of READS. `label` is an SQL expression that names a row, `seeded`
 * is every label in the table, then what each person gets back.
 */
const reads = (label, seeded, anon, nobody, gone, B, A, admin, adminTotp = admin) =>
  ({ label, seeded, cells: { anon, nobody, gone, B, A, admin, adminTotp } })
/** The same line with the people named, for tables where each gets a different list. */
const readsBy = (label, seeded, cells) => ({ label, seeded, cells: { adminTotp: cells.admin, ...cells } })

// Every table and view in public. The policies are in supabase/migrations
// (the comment names the rule); the permission model is has_perm(feature,
// level) of 001 and 032: admins pass everything, a member passes what
// profiles.permissions grants, a deactivated profile passes nothing.
//
// anon is REFUSED everywhere except showcase_items: 043 took away the table
// grants Supabase gives by default, so anon no longer reaches RLS at all.
//
// nobody and gone read no row of any table: 043's restrictive policy
// ("active_account_only", is_active()) is ANDed with every policy below.
// `none` for them is "RLS returned nothing"; the grant belongs to the role
// authenticated, which they share with everyone signed in.
const READS = {
  //                                  label              seeded                                      anon     nobody   gone     B        A        admin    adminTotp

  // -- has_perm(<feature>, 'view'): A (every permission) and admins. B has none.
  clients:             reads('name',             ['Acme'],                                   REFUSED, none,    none,    none,    ALL,     ALL),
  client_categories:   reads('name',             ['Retail'],                                 REFUSED, none,    none,    none,    ALL,     ALL),
  project_engagements: reads('project_id::text', SOME, REFUSED, none, none, none, none, ALL, ALL),
  cube_departments: reads('code', SOME, REFUSED, none, none, none, none, ALL, ALL),
  cube_control: reads('id::text', SOME, REFUSED, none, none, none, none, ALL, ALL),
  cube_intakes: reads('project_id::text', SOME, REFUSED, none, none, none, none, ALL, ALL),
  cube_work_items: reads('key', SOME, REFUSED, none, none, none, none, ALL, ALL),
  cube_operation_history: reads('action', SOME, REFUSED, none, none, none, none, ALL, ALL),
  recording_folders:   reads('name',             ['Kickoffs'],                               REFUSED, none,    none,    none,    ALL,     ALL),
  meeting_recordings:  reads('title',            ['Kickoff recording'],                      REFUSED, none,    none,    none,    ALL,     ALL),
  // -- the team's shared boards (059): every active account; nobody and gone are not active.
  whiteboard_folders:  reads('name',             ['Sketches'],                               REFUSED, none,    none,    ALL,     ALL,     ALL),
  whiteboards:         reads('title',            ['Site map'],                               REFUSED, none,    none,    ALL,     ALL,     ALL),
  projects:            reads('title',            ['Acme site'],                              REFUSED, none,    none,    none,    ALL,     ALL),
  project_categories:  reads('name',             ['Web'],                                    REFUSED, none,    none,    none,    ALL,     ALL),
  tasks:               reads('title',            ['Write copy'],                             REFUSED, none,    none,    none,    ALL,     ALL),
  task_activity:       reads('action',           ['created'],                                REFUSED, none,    none,    none,    ALL,     ALL),
  time_entries:        reads('note',             ['A wrote copy'],                           REFUSED, none,    none,    none,    ALL,     ALL),
  eod_reports:         reads('content',          ['A: end of day'],                          REFUSED, none,    none,    none,    ALL,     ALL),
  crm_tables:          reads('name',             ['Pipeline'],                               REFUSED, none,    none,    none,    ALL,     ALL),
  crm_columns:         reads('name',             ['Stage'],                                  REFUSED, none,    none,    none,    ALL,     ALL),
  crm_rows:            reads(`"values"->>'name'`, ['Row of A'],                              REFUSED, none,    none,    none,    ALL,     ALL),
  courses:             reads('title',            ['Onboarding'],                             REFUSED, none,    none,    none,    ALL,     ALL),
  course_modules:      reads('title',            ['Module 1'],                               REFUSED, none,    none,    none,    ALL,     ALL),
  course_topics:       reads('title',            ['Topic 1'],                                REFUSED, none,    none,    none,    ALL,     ALL),
  campaigns:           reads('name',             ['Q4 email'],                               REFUSED, none,    none,    none,    ALL,     ALL),
  job_postings:        reads('title',            ['Build a site'],                           REFUSED, none,    none,    none,    ALL,     ALL),
  leads:               reads('name',             ['Lead Larry'],                             REFUSED, none,    none,    none,    ALL,     ALL),
  lead_activity:       reads('action',           ['note'],                                   REFUSED, none,    none,    none,    ALL,     ALL),
  site_subscribers:    reads('email',            ['reader@example.test'],                    REFUSED, none,    none,    none,    ALL,     ALL),
  showcase_link_checks: reads('url',             ['https://published-site.example.test'],    REFUSED, none,    none,    none,    ALL,     ALL),
  // The most specific anchor decides (046): project → projects, lead → growth,
  // client → clients. Emails (049) follow the same rule.
  form_responses:      reads('form',             ['discovery', 'onboarding'],                REFUSED, none,    none,    none,    ALL,     ALL),
  emails:              reads('subject',          ['Re: your site'],                          REFUSED, none,    none,    none,    ALL,     ALL),
  // calendar:view or meetings:view; attendees follow their event (040).
  events:              reads('title',            ['Kickoff', 'Launch day'],                  REFUSED, none,    none,    none,    ALL,     ALL),
  event_attendees:     reads('email',            [EMAIL.A, 'guest@client.example.test'],     REFUSED, none,    none,    none,    ALL,     ALL),

  // -- the one table the public site reads with the anon key (037): published
  // rows whose link is not down, through column grants. Signed in, it is
  // showcase:view like any feature.
  showcase_items: readsBy('slug', ['down-site', 'draft-site', 'published-site'], {
    anon: ['published-site'], nobody: none, gone: none, B: none, A: ALL, admin: ALL,
  }),

  // -- admins only
  audit_log:           reads('action',           SOME,                                       REFUSED, none,    none,    none,    none,    ALL),
  automation_jobs:     reads('job',              SOME,                                       REFUSED, none,    none,    none,    none,    ALL),
  automation_runs:     reads('execution_id',     ['run-1'],                                  REFUSED, none,    none,    none,    none,    ALL),
  // A security_invoker view over the two tables above: their policies decide.
  automation_health:   reads('job',              SOME,                                       REFUSED, none,    none,    none,    none,    ALL),
  lead_intake_attempts: reads('status',          ['created'],                                REFUSED, none,    none,    none,    none,    ALL),
  booking_attempts:    reads('status',           ['booked'],                                 REFUSED, none,    none,    none,    none,    ALL),
  vault_settings:      reads('owner_email',      ['owner@example.test'],                     REFUSED, none,    none,    none,    none,    ALL),

  // -- the Vault (008, 030, 031): an admin AND a session that passed the
  // authenticator. Everyone left of admin holds aal2 here and still gets nothing.
  vault_meta:          reads('salt',             ['salt'],                                   REFUSED, none,    none,    none,    none,    none,    ALL),
  vault_folders:       reads('name_enc',         ['enc:folder'],                             REFUSED, none,    none,    none,    none,    none,    ALL),
  vault_items:         reads('title_enc',        ['enc:item'],                               REFUSED, none,    none,    none,    none,    none,    ALL),
  // 060: an admin's own key slot, at aal2 only.
  vault_key_slots:     reads('kind',             ['password'],                               REFUSED, none,    none,    none,    none,    none,    ALL),

  // -- own rows only; an admin gets no more than anyone else. gone has a row
  // in each of these and does not get it (043).
  notifications: readsBy('title', ['for A', 'for B', 'for admin', 'for gone'], {
    anon: REFUSED, nobody: none, gone: none, B: ['for B'], A: ['for A'], admin: ['for admin'],
  }),
  // gone's subscription was seeded and is not in the table: 032's trigger
  // removed it at deactivation.
  push_subscriptions: readsBy(person('user_id'), ['A', 'B'], {
    anon: REFUSED, nobody: none, gone: none, B: ['B'], A: ['A'], admin: none,
  }),
  // The phone app's tokens (050): your own only, like push_subscriptions.
  push_devices: readsBy(person('user_id'), ['A', 'B'], {
    anon: REFUSED, nobody: none, gone: none, B: ['B'], A: ['A'], admin: none,
  }),
  channel_reads: readsBy(person('user_id'), ['A', 'A', 'B', 'admin', 'gone'], {
    anon: REFUSED, nobody: none, gone: none, B: ['B'], A: ['A', 'A'], admin: ['admin'],
  }),

  // -- direct messages (019): the participants, and nobody else. An admin is
  // not a participant of 'A and gone' and does not see it. gone is a
  // participant of it and, since 043, does not see it either.
  conversations: readsBy('title', ['A and admin', 'A and gone', 'admin and B'], {
    anon: REFUSED,
    nobody: none,
    gone: none,
    B: ['admin and B'],
    A: ['A and admin', 'A and gone'],
    admin: ['A and admin', 'admin and B'],
  }),
  messages: readsBy('body', ['A to admin', 'A to gone', 'B to admin', 'admin to B'], {
    anon: REFUSED,
    nobody: none,
    gone: none,
    B: ['B to admin', 'admin to B'],
    A: ['A to admin', 'A to gone'],
    admin: ['A to admin', 'B to admin', 'admin to B'],
  }),
  // The read markers of a conversation are visible to its participants.
  conversation_reads: readsBy(person('user_id'), ['A', 'B', 'admin', 'gone'], {
    anon: REFUSED, nobody: none, gone: none, B: ['B'], A: ['A', 'admin', 'gone'], admin: ['A', 'B', 'admin'],
  }),

  // -- INTENDED: every ACTIVE account reads these, whatever its permissions.
  // profiles is the team directory (001: pickers, avatars and chat need it).
  // These policies ask neither has_perm() nor is_admin(), so until 043 an
  // account without a profile and a deactivated one read them too.
  profiles:            reads('full_name',        ['Ada Admin', 'Amy A', 'Ben B', 'Gil Gone'], REFUSED, none,   none,    ALL,     ALL,     ALL),
  // One row of workspace-wide settings (033); only admins change it.
  workspace_settings:  reads(`'the one row'`,    ['the one row'],                            REFUSED, none,    none,    ALL,     ALL,     ALL),
  // Channels (023, 025, 030): the studio space (client_id NULL) is open to
  // every active account, with no permission asked; a client's space needs
  // clients:view; a private channel shows to its members and to admins.
  channel_categories: readsBy('name', ['Acme space', 'Studio'], {
    anon: REFUSED, nobody: none, gone: none, B: ['Studio'], A: ALL, admin: ALL,
  }),
  channels: readsBy('name', ['a-private', 'acme-general', 'b-private', 'general'], {
    anon: REFUSED,
    nobody: none,
    gone: none,
    B: ['b-private', 'general'],
    A: ['a-private', 'acme-general', 'general'],
    admin: ALL,
  }),
  channel_messages: readsBy('body', ['in a-private', 'in acme-general', 'in b-private', 'in general'], {
    anon: REFUSED,
    nobody: none,
    gone: none,
    B: ['in b-private', 'in general'],
    A: ['in a-private', 'in acme-general', 'in general'],
    admin: ALL,
  }),
  channel_reactions: readsBy('emoji', ['on a-private', 'on acme-general', 'on b-private', 'on general'], {
    anon: REFUSED,
    nobody: none,
    gone: none,
    B: ['on b-private', 'on general'],
    A: ['on a-private', 'on acme-general', 'on general'],
    admin: ALL,
  }),

  // -- service role only: no policy at all, so not even an admin reads them.
  // REFUSED: no grant either. `none`: authenticated still holds the old
  // default grant (vault_reset_codes, 021) and RLS alone keeps it out.
  calendar_feed_tokens: reads(person('user_id'), ['A'],                                      REFUSED, REFUSED, REFUSED, REFUSED, REFUSED, REFUSED),
  google_connections:  reads('google_email',     ['amy@gmail.example.test'],                 REFUSED, REFUSED, REFUSED, REFUSED, REFUSED, REFUSED),
  google_sync_outbox:  reads('op',               ['upsert'],                                 REFUSED, REFUSED, REFUSED, REFUSED, REFUSED, REFUSED),
  google_workspace_link: reads('google_email',   ['studio@gmail.example.test'],              REFUSED, REFUSED, REFUSED, REFUSED, REFUSED, REFUSED),
  signup_allowlist:    reads('email',            ['invitee@example.test'],                   REFUSED, REFUSED, REFUSED, REFUSED, REFUSED, REFUSED),
  site_subscriber_attempts: reads('email_norm',  ['reader@example.test'],                    REFUSED, REFUSED, REFUSED, REFUSED, REFUSED, REFUSED),
  vault_reset_codes:   reads('sent_to',          ['owner@example.test'],                     REFUSED, none,    none,    none,    none,    none),
}

const sorted = (list) => [...list].sort()

async function seen(who, table, label) {
  const query = () => rows(db, `SELECT (${label})::text AS label FROM public.${table}`)
  try {
    return sorted((who === 'operator' ? await query() : await tryAs(db, who, query)).map((r) => r.label))
  } catch (err) {
    if (err.code === '42501' && /^permission denied for (table|view) /.test(err.message)) return REFUSED
    throw err
  }
}

test('every table and view in public has a line in READS', async () => {
  const relations = await rows(db, `
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') ORDER BY 1`)
  assert.deepEqual(relations.map((r) => r.relname), sorted(Object.keys(READS)),
    'a new table needs a seed row and a line that says who may read it; a dropped one loses its line')
  // A line decides for every one of the people; none is left to a default.
  for (const [table, { cells }] of Object.entries(READS)) {
    assert.deepEqual(Object.keys(cells).sort(), Object.keys(ACTORS).sort(), table)
    for (const [who, cell] of Object.entries(cells)) {
      assert.ok(cell === ALL || cell === REFUSED || Array.isArray(cell), `${table}: no decision for ${who}`)
    }
    // 043, as rules a new line cannot argue with: without an active profile
    // no row of any table, and the public key only on showcase_items.
    const nothing = (cell) => cell === REFUSED || (Array.isArray(cell) && cell.length === 0)
    assert.ok(nothing(cells.nobody), `${table}: an account without a profile must read nothing`)
    assert.ok(nothing(cells.gone), `${table}: a deactivated account must read nothing`)
    if (table !== 'showcase_items') assert.equal(cells.anon, REFUSED, `${table}: anon must hold no grant`)
  }
})

for (const [table, { label, seeded, cells }] of Object.entries(READS)) {
  test(`reads: ${table}`, async () => {
    const all = await seen('operator', table, label)
    if (seeded === SOME) assert.ok(all.length > 0, 'the table is empty, so a denial would prove nothing')
    else assert.deepEqual(all, sorted(seeded), 'what the seed put in the table')
    // The service key sees everything: the rows are there and the switch works.
    assert.deepEqual(await seen('service_role', table, label), all, 'service_role')

    for (const [who, cell] of Object.entries(cells)) {
      const expected = cell === ALL ? all : cell === REFUSED ? REFUSED : sorted(cell)
      assert.deepEqual(await seen(ACTORS[who], table, label), expected, `${who} reading ${table}`)
    }
  })
}

test('the public site reads showcase_items by column grant: never the private columns, never the real url', async () => {
  const granted = await tryAs(db, 'anon', () => rows(db, 'SELECT slug, title, public_url FROM public.showcase_items'))
  assert.deepEqual(granted, [{ slug: 'published-site', title: 'published-site', public_url: 'https://published-site.example.test' }])
  for (const column of ['url', 'status', 'consent', 'consent_note', 'client_id', 'project_id', 'link_status', 'created_by']) {
    await assert.rejects(
      tryAs(db, 'anon', () => db.query(`SELECT ${column} FROM public.showcase_items`)),
      { code: '42501' }, `anon must not read showcase_items.${column}`)
  }
  await assert.rejects(tryAs(db, 'anon', () => db.query('SELECT * FROM public.showcase_items')), { code: '42501' })
})

// ---------------------------------------------------------------- writing

/** One statement as `who`. Says what happened; nothing is kept. */
async function attempt(who, sql, params) {
  try {
    const result = await tryAs(db, ACTORS[who] ?? who, () => db.query(sql, params))
    return { affected: result.affectedRows ?? 0 }
  } catch (err) {
    return { refused: err.code ?? 'no SQLSTATE', message: err.message }
  }
}
/**
 * Inside a tryAs() request: look at the result as the operator. Still inside
 * the request's transaction, so the rollback takes it all back.
 */
async function asOperatorInside(fn) {
  await db.exec('SET LOCAL SESSION AUTHORIZATION postgres')
  return fn()
}
/** The statement ran and touched no row: RLS filtered every row out. */
const noRows = (result) => result.affected === 0
/** The statement failed with "insufficient privilege": no grant, or a policy's WITH CHECK. */
const refused = (result) => result.refused === '42501'

async function assertNoRows(who, sql, params) {
  const result = await attempt(who, sql, params)
  assert.ok(noRows(result) || refused(result), `${who}: ${sql}\n  expected no row or 42501, got ${JSON.stringify(result)}`)
}
async function assertRefused(who, sql, params, { code = '42501', message } = {}) {
  const result = await attempt(who, sql, params)
  assert.equal(result.refused, code, `${who}: ${sql}\n  expected SQLSTATE ${code}, got ${JSON.stringify(result)}`)
  if (message) assert.match(result.message, message)
}
/** The control: the same kind of statement, by someone who may, does change rows. */
async function assertChanges(who, count, sql, params) {
  const result = await attempt(who, sql, params)
  assert.deepEqual(result, { affected: count }, `${who}: ${sql}`)
}

/**
 * Nobody changes a row they cannot read. For every table, as `who`:
 *   - UPDATE of everything and DELETE of everything, without a WHERE: every
 *     row `who` cannot read is still there afterwards, unchanged, and no more
 *     rows were touched than `who` can read. The update sets a column to its
 *     default instead of reading one, so Postgres asks the UPDATE policy
 *     alone (with a WHERE it would also apply the SELECT policy, and a too
 *     wide UPDATE policy would hide behind it);
 *   - where `who` reads no row at all, an INSERT of defaults is refused.
 * A statement that fails for another reason than "insufficient privilege" (a
 * trigger, a constraint) reached some row before it failed and nothing says
 * which: that is reported as well.
 * anon reads one table and writes none, so for anon every row of every table
 * counts as out of reach.
 */
async function writeSweep(who) {
  const readsNothingAnywhere = who === 'anon'
  // The column to update: one no key cares about, nullable if there is one.
  const tables = await rows(db, `
    SELECT c.relname AS name,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
             ORDER BY EXISTS (SELECT 1 FROM pg_constraint k
                               WHERE k.conrelid = c.oid AND k.contype IN ('p', 'f', 'u') AND a.attnum = ANY (k.conkey)),
                      a.attnotnull, a.attnum DESC
             LIMIT 1) AS column
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`)
  const holes = []
  let tried = 0

  for (const { name, column } of tables) {
    // "Can read" is what READS declares, not what the database happens to
    // allow: a table that lost its RLS must not count as readable.
    if (!READS[name]) {
      holes.push(`${name}: no line in READS`)
      continue
    }
    const { label, cells } = READS[name]
    const declared = cells[who] === REFUSED || readsNothingAnywhere ? [] : cells[who]
    const snapshot = () => rows(db, `SELECT (${label})::text AS label, to_jsonb(t)::text AS image FROM public.${name} t`)
    const everything = await snapshot()
    const outOfReach = declared === ALL ? [] : everything.filter((row) => !declared.includes(row.label)).map((row) => row.image)
    if (outOfReach.length === 0) continue
    const readable = everything.length - outOfReach.length
    tried += 1

    if (readable === 0) {
      const insert = await attempt(who, `INSERT INTO public.${name} DEFAULT VALUES`)
      if (!refused(insert)) holes.push(`INSERT INTO ${name} DEFAULT VALUES: ${JSON.stringify(insert)}`)
    }
    for (const sql of [`UPDATE public.${name} SET "${column}" = DEFAULT`, `DELETE FROM public.${name}`]) {
      try {
        await tryAs(db, ACTORS[who], async () => {
          const touched = (await db.query(sql)).affectedRows ?? 0
          if (touched === 0) return
          const left = (await asOperatorInside(snapshot)).map((row) => row.image)
          const lost = outOfReach.filter((image) => !left.includes(image)).length
          if (lost > 0 || touched > readable) {
            holes.push(`${sql}: touched ${touched} rows, ${who} reads ${readable}; ${lost} rows out of reach changed or gone`)
          }
        })
      } catch (err) {
        if (err.code !== '42501') holes.push(`${sql}: failed with ${err.code} after reaching a row (${err.message})`)
      }
    }
  }
  return { tables: tables.length, tried, holes }
}

test('anon cannot insert, update or delete in any table', async () => {
  const { tables, tried, holes } = await writeSweep('anon')
  assert.equal(tables, Object.keys(READS).length - 1, 'every table (READS also lists one view)')
  assert.equal(tried, tables, 'anon was tried on every one of them')
  assert.deepEqual(holes, [])

  // The same with rows that would be valid, on the tables a visitor's data ends up in.
  await assertRefused('anon', `INSERT INTO public.leads (name, email) VALUES ('Mallory', 'm@example.test')`)
  await assertRefused('anon', `INSERT INTO public.site_subscribers (email) VALUES ('m@example.test')`)
  await assertRefused('anon', `INSERT INTO public.notifications (user_id, type, title) VALUES ($1, 'system', 'hello')`, [ID.A])
  await assertRefused('anon', `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Mallory', 'admin')`, [ID.nobody])
  await assertRefused('anon', `UPDATE public.showcase_items SET title = 'defaced' WHERE slug = 'published-site'`)
  await assertRefused('anon', `DELETE FROM public.showcase_items WHERE slug = 'published-site'`)
})

for (const who of ['nobody', 'gone', 'B', 'A', 'admin', 'adminTotp']) {
  test(`${who} changes no row it cannot read`, async () => {
    const { tried, holes } = await writeSweep(who)
    assert.ok(tried >= 10, `the sweep had something out of reach in ${tried} tables`)
    assert.deepEqual(holes, [])
  })
}

test('the checks above fail when there is a hole', async () => {
  // Four deliberate holes, each closed again. Without this, a suite that
  // always reports "nothing happened" would pass.
  const withHole = async (open, close, check) => {
    await db.exec(open)
    try {
      await check()
    } finally {
      await db.exec(close)
    }
  }

  // An UPDATE policy that is too wide, on a table where B reads two rows of four.
  await withHole(
    `CREATE POLICY "test_hole" ON public.messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true)`,
    `DROP POLICY "test_hole" ON public.messages`,
    async () => {
      const { holes } = await writeSweep('B')
      assert.equal(holes.length, 1, holes.join('\n'))
      assert.match(holes[0], /^UPDATE public\.messages .* touched 4 rows, B reads 2; /)
    })

  // A table whose RLS was forgotten: the default grants are all that is left.
  // Since 043 took anon's grants away, the hole needs Supabase's default
  // grant back too (what a new table gets when its migration forgets both).
  await withHole(
    'ALTER TABLE public.job_postings DISABLE ROW LEVEL SECURITY; GRANT ALL ON public.job_postings TO anon',
    'REVOKE ALL ON public.job_postings FROM anon; ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY',
    async () => {
      const { holes } = await writeSweep('anon')
      assert.deepEqual(holes.map((hole) => hole.replace(/: .*/s, '')), [
        'INSERT INTO job_postings DEFAULT VALUES',
        'UPDATE public.job_postings SET "description" = DEFAULT',
        'DELETE FROM public.job_postings',
      ])
      assert.deepEqual(await seen('anon', 'job_postings', 'title'), ['Build a site'])
    })

  // A SELECT policy that is too wide.
  await withHole(
    `CREATE POLICY "test_hole" ON public.notifications FOR SELECT TO authenticated USING (true)`,
    `DROP POLICY "test_hole" ON public.notifications`,
    async () => {
      assert.deepEqual(await seen(ACTORS.B, 'notifications', 'title'), ['for A', 'for B', 'for admin', 'for gone'])
    })

  // 043's policy taken off one table: the deactivated account has its row back.
  await withHole(
    `DROP POLICY "active_account_only" ON public.notifications`,
    `CREATE POLICY "active_account_only" ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()))`,
    async () => {
      assert.deepEqual(await seen(ACTORS.gone, 'notifications', 'title'), ['for gone'])
    })

  // Closed again: B is back to its own row and the sweeps are clean.
  assert.deepEqual(await seen(ACTORS.gone, 'notifications', 'title'), [])
  assert.deepEqual(await seen(ACTORS.B, 'notifications', 'title'), ['for B'])
  assert.deepEqual((await writeSweep('B')).holes, [])
  assert.deepEqual((await writeSweep('anon')).holes, [])
})

test('the write helpers can tell a write that goes through', async () => {
  assert.deepEqual(await attempt('A', 'DELETE FROM public.tasks'), { affected: 1 })
  assert.deepEqual(await attempt('A', `UPDATE public.clients SET notes = DEFAULT`), { affected: 1 })
  assert.deepEqual(await attempt('A', `INSERT INTO public.client_categories (name) VALUES ('New')`), { affected: 1 })
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM public.tasks')).n, 1, 'and it was rolled back')
})

test('notifications: only your own; none forged in someone else\'s name', async () => {
  const forA = S.notification.A
  await assertNoRows('B', 'UPDATE public.notifications SET read = true WHERE id = $1', [forA])
  await assertNoRows('B', 'DELETE FROM public.notifications WHERE id = $1', [forA])
  await assertNoRows('admin', 'DELETE FROM public.notifications WHERE id = $1', [forA])
  // Without a WHERE, B reaches exactly its own row.
  await assertChanges('B', 1, 'UPDATE public.notifications SET read = true')
  await assertChanges('B', 1, 'DELETE FROM public.notifications')
  // B cannot hand its notification to A, sign A's name under one, or send a type only the server sends.
  await assertRefused('B', 'UPDATE public.notifications SET user_id = $1 WHERE id = $2', [ID.A, S.notification.B])
  await assertRefused('B',
    `INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES ($1, $2, 'task_assigned', 'forged')`, [ID.admin, ID.A])
  await assertRefused('B',
    `INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES ($1, $2, 'system', 'forged')`, [ID.A, ID.B])
  await assertChanges('A', 1, 'UPDATE public.notifications SET read = true WHERE id = $1', [forA])
})

test('push_subscriptions: only your own, and only through the two functions', async () => {
  await assertNoRows('B', 'DELETE FROM public.push_subscriptions WHERE id = $1', [S.push.A])
  await assertChanges('B', 1, 'DELETE FROM public.push_subscriptions')
  // No INSERT or UPDATE grant: a client cannot write a row for anyone, itself included.
  await assertRefused('B', 'UPDATE public.push_subscriptions SET user_id = $1 WHERE id = $2', [ID.B, S.push.A])
  await assertRefused('B',
    `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, app_base)
     VALUES ($1, 'https://push.example.test/forged', 'k', 'a', 'https://desk.example.test')`, [ID.A])
  // delete_push_subscription() only looks among the caller's rows.
  await tryAs(db, ACTORS.B, async () => {
    await db.query('SELECT public.delete_push_subscription($1)', ['https://push.example.test/A'])
    assert.deepEqual(await asOperatorInside(() => rows(db, `SELECT ${person('user_id')} AS who FROM public.push_subscriptions ORDER BY 1`)),
      [{ who: 'A' }, { who: 'B' }])
  })
  await assertRefused('anon', `SELECT public.upsert_push_subscription('https://push.example.test/x', 'k', 'a', 'https://desk.example.test')`)
})

test('conversations and messages: a non-participant changes nothing, a participant only what is theirs', async () => {
  const theirs = S.conversation['A and admin']
  const shared = S.conversation['admin and B']

  // -- B is not in 'A and admin'
  await assertNoRows('B', `UPDATE public.conversations SET title = 'taken' WHERE id = $1`, [theirs])
  await assertNoRows('B', 'UPDATE public.conversations SET participant_ids = participant_ids || $2::uuid WHERE id = $1', [theirs, ID.B])
  await assertNoRows('B', 'DELETE FROM public.conversations WHERE id = $1', [theirs])
  await assertNoRows('B', `UPDATE public.messages SET body = 'rewritten' WHERE id = $1`, [S.message['A to admin']])
  await assertNoRows('B', 'DELETE FROM public.messages WHERE id = $1', [S.message['A to admin']])
  await assertRefused('B', `INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ($1, $2, 'uninvited')`, [theirs, ID.B])
  await assertNoRows('B', 'UPDATE public.conversation_reads SET last_read_at = now() WHERE conversation_id = $1', [theirs])
  await assertNoRows('B', 'DELETE FROM public.conversation_reads WHERE conversation_id = $1', [theirs])
  await assertRefused('B', 'INSERT INTO public.conversation_reads (conversation_id, user_id) VALUES ($1, $2)', [theirs, ID.B])

  // -- B cannot start a conversation it is not in, or in someone else's name
  await assertRefused('B',
    'INSERT INTO public.conversations (participant_ids, created_by) VALUES ($1::uuid[], $2)', [[ID.A, ID.admin], ID.B])
  await assertRefused('B',
    'INSERT INTO public.conversations (participant_ids, created_by) VALUES ($1::uuid[], $2)', [[ID.A, ID.B], ID.A])

  // -- B is in 'admin and B' but did not create it, and did not write admin's lines
  await assertNoRows('B', 'DELETE FROM public.conversations WHERE id = $1', [shared])
  await assertRefused('B', 'UPDATE public.conversations SET participant_ids = $2::uuid[] WHERE id = $1', [shared, [ID.B, ID.A]],
    { code: 'P0001', message: /only the conversation owner/ })
  await assertNoRows('B', `UPDATE public.messages SET body = 'rewritten' WHERE id = $1`, [S.message['admin to B']])
  await assertNoRows('B', 'DELETE FROM public.messages WHERE id = $1', [S.message['admin to B']])
  await assertRefused('B', `INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ($1, $2, 'as admin')`, [shared, ID.admin])
  await assertRefused('B', 'INSERT INTO public.conversation_reads (conversation_id, user_id) VALUES ($1, $2)', [shared, ID.admin])
  await assertNoRows('B', 'DELETE FROM public.conversation_reads WHERE conversation_id = $1 AND user_id <> $2', [theirs, ID.B])

  // -- being an admin does not open other people's direct messages
  await assertNoRows('admin', 'DELETE FROM public.conversations WHERE id = $1', [S.conversation['A and gone']])
  await assertNoRows('admin', 'DELETE FROM public.messages WHERE id = $1', [S.message['A to gone']])

  // -- the controls
  await assertChanges('B', 1, `UPDATE public.messages SET body = 'edited' WHERE id = $1`, [S.message['B to admin']])
  await assertChanges('B', 1, `INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ($1, $2, 'hello')`, [shared, ID.B])
  await assertChanges('A', 1, 'DELETE FROM public.conversations WHERE id = $1', [theirs])
})

test('channels: a private or client-space channel is closed to B, and B cannot touch A\'s messages', async () => {
  for (const name of ['a-private', 'acme-general']) {
    await assertRefused('B', `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'uninvited')`,
      [S.channel[name], ID.B])
    await assertRefused('B', `INSERT INTO public.channel_reads (channel_id, user_id) VALUES ($1, $2)`, [S.channel[name], ID.B])
    await assertNoRows('B', `UPDATE public.channels SET member_ids = member_ids || $2::uuid WHERE id = $1`, [S.channel[name], ID.B])
  }
  const inGeneral = S.channelMessage.general
  await assertNoRows('B', `UPDATE public.channel_messages SET body = 'rewritten' WHERE id = $1`, [inGeneral])
  await assertNoRows('B', 'DELETE FROM public.channel_messages WHERE id = $1', [inGeneral])
  await assertRefused('B', `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'as A')`,
    [S.channel.general, ID.A])
  await assertNoRows('B', 'DELETE FROM public.channels WHERE id = $1', [S.channel.general])
  await assertNoRows('B', 'DELETE FROM public.channel_reactions WHERE message_id = $1', [inGeneral])
  await assertNoRows('B', 'UPDATE public.channel_reads SET last_read_at = now() WHERE user_id = $1', [ID.A])
  // INTENDED: the studio space is open to every signed-in account, B included.
  await assertChanges('B', 1, `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'hello')`,
    [S.channel.general, ID.B])
})

test('the Vault: nothing without an admin role and nothing without the second factor', async () => {
  // A holds every permission, gone's profile still says admin, all three hold aal2;
  // admin is an admin at aal1.
  for (const who of ['B', 'A', 'gone', 'admin']) {
    await assertRefused(who, `INSERT INTO public.vault_meta (salt, iterations, wrapped_key) VALUES ('s', 1, 'w')`)
    await assertRefused(who, `INSERT INTO public.vault_folders (name_enc, meta_id) VALUES ('x', $1)`, [S.vaultMeta])
    await assertRefused(who, `INSERT INTO public.vault_items (folder_id, title_enc, data_enc, meta_id) VALUES ($1, 'x', 'x', $2)`,
      [S.vaultFolder, S.vaultMeta])
    await assertNoRows(who, `UPDATE public.vault_items SET data_enc = 'x'`)
    await assertNoRows(who, `UPDATE public.vault_folders SET name_enc = 'x'`)
    await assertNoRows(who, 'DELETE FROM public.vault_items')
    await assertNoRows(who, 'DELETE FROM public.vault_folders')
    await assertNoRows(who, 'UPDATE public.vault_meta SET archived_at = now()')
    await assertNoRows(who, 'DELETE FROM public.vault_meta')
    await assertNoRows(who, 'UPDATE public.vault_settings SET owner_email = auth.email()')
  }
  // The reset codes have no policy: not even an admin with the second factor.
  for (const who of ['B', 'admin', 'adminTotp']) {
    await assertRefused(who, `INSERT INTO public.vault_reset_codes (code_hash, sent_to, expires_at) VALUES ('h', 'x@example.test', now())`)
    await assertNoRows(who, 'UPDATE public.vault_reset_codes SET used_at = now()')
    await assertNoRows(who, 'DELETE FROM public.vault_reset_codes')
  }
  // Only the owner address on file hands the Vault over, second factor or not.
  await assertNoRows('adminTotp', 'UPDATE public.vault_settings SET owner_email = auth.email()')

  // -- the controls: the same admin after the authenticator step
  await assertChanges('adminTotp', 1, `INSERT INTO public.vault_folders (name_enc, meta_id) VALUES ('x', $1)`, [S.vaultMeta])
  await assertChanges('adminTotp', 1, `UPDATE public.vault_items SET data_enc = 'x'`)
  await assertChanges('adminTotp', 1, 'DELETE FROM public.vault_items')
})

test('profiles: nobody raises their own role or permissions, or edits someone else', async () => {
  const ONLY_ADMINS = { code: 'P0001', message: /Only admins can change role, permissions, email or deactivation/ }
  // A has every permission and still is not an admin.
  for (const who of ['B', 'A']) {
    const me = ID[who]
    await assertRefused(who, `UPDATE public.profiles SET role = 'admin' WHERE id = $1`, [me], ONLY_ADMINS)
    await assertRefused(who, `UPDATE public.profiles SET permissions = '{"clients": "edit"}' WHERE id = $1`, [me], ONLY_ADMINS)
    await assertRefused(who, `UPDATE public.profiles SET email = 'elsewhere@example.test' WHERE id = $1`, [me], ONLY_ADMINS)
    await assertNoRows(who, `UPDATE public.profiles SET full_name = 'renamed' WHERE id = $1`, [ID.admin])
    await assertNoRows(who, 'DELETE FROM public.profiles WHERE id = $1', [ID.admin])
    await assertNoRows(who, 'DELETE FROM public.profiles WHERE id = $1', [me])
    await assertRefused(who, `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Second me', 'admin')`, [ID.nobody])
  }
  await assertNoRows('B', `UPDATE public.profiles SET full_name = 'renamed' WHERE id = $1`, [ID.A])
  // A deactivated account cannot switch itself back on (since 043 it does not
  // even reach its own row), and its "admin" role opens no one else's row.
  await assertNoRows('gone', 'UPDATE public.profiles SET deactivated_at = NULL WHERE id = $1', [ID.gone])
  await assertNoRows('gone', 'UPDATE public.profiles SET deactivated_at = NULL')
  await assertNoRows('gone', `UPDATE public.profiles SET role = 'admin', permissions = $2::jsonb WHERE id = $1`,
    [ID.B, JSON.stringify(EVERY_PERMISSION)])
  // An account without a profile has no row to update and cannot make one.
  await assertNoRows('nobody', `UPDATE public.profiles SET role = 'admin'`)
  await assertRefused('nobody', `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Nell', 'admin')`, [ID.nobody])

  // -- the controls: your own name is yours; access is the admin's to give
  await assertChanges('B', 1, `UPDATE public.profiles SET full_name = 'Benjamin B' WHERE id = $1`, [ID.B])
  await assertChanges('admin', 1, `UPDATE public.profiles SET permissions = '{"clients": "view"}' WHERE id = $1`, [ID.B])
})

test('an account without a profile writes nothing, and it is the policy that says so', async () => {
  // The studio policies ask for no permission, and until 043 the only thing
  // that stopped this account was a foreign key (its id is not in profiles:
  // 23503). Now every statement is refused as "insufficient privilege", by
  // the policy, before a key is looked at. 042 keeps such accounts from
  // coming into being.
  await assertRefused('nobody', `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'hello')`,
    [S.channel.general, ID.nobody])
  await assertRefused('nobody', `INSERT INTO public.channels (name, created_by) VALUES ('mine', $1)`, [ID.nobody])
  await assertRefused('nobody', `INSERT INTO public.channel_categories (name, created_by) VALUES ('Mine', $1)`, [ID.nobody])
  await assertRefused('nobody', 'INSERT INTO public.channel_reads (channel_id, user_id) VALUES ($1, $2)',
    [S.channel.general, ID.nobody])
  await assertRefused('nobody', 'INSERT INTO public.conversations (participant_ids, created_by) VALUES ($1::uuid[], $2)',
    [[ID.nobody, ID.A], ID.nobody])
  await assertRefused('nobody',
    `INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES ($1, $2, 'task_assigned', 'hello')`,
    [ID.A, ID.nobody])
  await assertRefused('nobody', 'SELECT public.upsert_push_subscription($1, $2, $3, $4)',
    ['https://fcm.googleapis.com/fcm/send/no-profile', 'B'.repeat(87), 'a'.repeat(22), 'https://desk.example.test'],
    { message: /not active/ })
})

test('feature tables: view does not write, and edit stops at the admin-only actions', async () => {
  // B is given view on everything for the length of each attempt's own
  // transaction, by the operator, so the rest of the suite keeps "B has none".
  const viewer = Object.fromEntries(FEATURES.map((f) => [f, 'view']))
  const asViewer = async (sql, params) => {
    await db.query('UPDATE public.profiles SET permissions = $2::jsonb WHERE id = $1', [ID.B, JSON.stringify(viewer)])
    try {
      return await attempt('B', sql, params)
    } finally {
      await db.query(`UPDATE public.profiles SET permissions = '{}' WHERE id = $1`, [ID.B])
    }
  }
  await db.query('UPDATE public.profiles SET permissions = $2::jsonb WHERE id = $1', [ID.B, JSON.stringify(viewer)])
  try {
    assert.deepEqual(await tryAs(db, ACTORS.B, () => rows(db, 'SELECT name FROM public.clients')), [{ name: 'Acme' }],
      'with view, B reads the client')
  } finally {
    await db.query(`UPDATE public.profiles SET permissions = '{}' WHERE id = $1`, [ID.B])
  }
  for (const table of ['clients', 'projects', 'tasks', 'crm_rows', 'events', 'leads', 'courses', 'showcase_items', 'campaigns']) {
    const result = await asViewer(`DELETE FROM public.${table}`)
    assert.ok(noRows(result), `a viewer deleting ${table}: ${JSON.stringify(result)}`)
  }
  assert.equal((await asViewer(`INSERT INTO public.clients (name) VALUES ('Mine')`)).refused, '42501')
  assert.equal((await asViewer(`UPDATE public.tasks SET title = 'taken'`)).affected, 0)

  // A edits, and still: no audit or admin-only rows, no publishing, no consent.
  await assertRefused('A', `UPDATE public.showcase_items SET status = 'published', consent = 'internal' WHERE slug = 'draft-site'`,
    [], { message: /only an admin can publish/ })
  await assertRefused('A', `UPDATE public.showcase_items SET title = 'edited' WHERE slug = 'published-site'`,
    [], { message: /only an admin can edit a published/ })
  await assertNoRows('A', `DELETE FROM public.showcase_items WHERE slug = 'published-site'`)
  await assertRefused('A', `UPDATE public.clients SET showcase_consent = 'granted'`, [], { message: /only an admin can record/ })
  await assertNoRows('A', 'UPDATE public.workspace_settings SET growth_notify_all = false')
  await assertNoRows('A', 'DELETE FROM public.task_activity')
  await assertNoRows('A', 'DELETE FROM public.lead_activity')
  await assertRefused('A', `INSERT INTO public.audit_log (action) VALUES ('profile.created')`)
  await assertRefused('adminTotp', `INSERT INTO public.audit_log (action) VALUES ('profile.created')`)
  await assertRefused('adminTotp', 'DELETE FROM public.audit_log')
  // Someone else's time is not A's to log.
  await assertRefused('A',
    `INSERT INTO public.time_entries (client_id, user_id, entry_date, minutes) VALUES ($1, $2, current_date, 5)`, [S.client, ID.B])
})

// ----------------------------------------------- anon: the doors

test('anon is named in exactly one policy', async () => {
  // A policy TO PUBLIC would apply to anon as well, so those count.
  const policies = await rows(db, `
    SELECT schemaname || '.' || tablename AS on_table, policyname, cmd FROM pg_policies
     WHERE roles && ARRAY['anon', 'public']::name[] ORDER BY 1, 2`)
  assert.deepEqual(policies, [{ on_table: 'public.showcase_items', policyname: 'showcase_items_public_read', cmd: 'SELECT' }])
})

// What is left of Supabase's default grants. Until 043 this list held the 34
// tables of 001-026: anon had ALL on them (RLS returned it nothing), and anon
// and authenticated had TRUNCATE, which RLS does not guard. 043 revoked them.
// The list is empty and stays empty: a table whose migration forgets its
// REVOKE shows up here.
const LEGACY_DEFAULT_GRANTS = []
// Privileges RLS has no say over and no client has a use for. MAINTAIN
// (VACUUM, REINDEX, LOCK TABLE) is a table privilege since Postgres 17.
const NOT_FOR_API_ROLES = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']

test('table grants: anon holds showcase_items\' columns and nothing else; nobody but the service role truncates', async () => {
  const holders = (role, privilege) => rows(db, `
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND has_table_privilege($1, c.oid, $2)
     ORDER BY 1`, [role, privilege]).then((list) => list.map((r) => r.relname))

  assert.deepEqual(LEGACY_DEFAULT_GRANTS, [])
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', ...NOT_FOR_API_ROLES]) {
    assert.deepEqual(await holders('anon', privilege), LEGACY_DEFAULT_GRANTS, `anon ${privilege}`)
  }
  for (const privilege of NOT_FOR_API_ROLES) {
    assert.deepEqual(await holders('authenticated', privilege), [], `authenticated ${privilege}`)
  }
  // The control: the query can tell a holder. The service role keeps TRUNCATE
  // wherever a migration did not narrow it (042 did, on signup_allowlist).
  const serviceRole = await holders('service_role', 'TRUNCATE')
  assert.ok(serviceRole.includes('job_postings') && !serviceRole.includes('signup_allowlist'), serviceRole.join(', '))

  // Column grants: the 23 columns of showcase_items the public site reads
  // (037), SELECT only. A table-level REVOKE on showcase_items would have
  // taken these with it, which is why 043 leaves that table out by name.
  const readable = await rows(db, `
    SELECT c.relname, count(*)::int AS columns
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('anon', c.oid, a.attnum, 'SELECT')
     GROUP BY 1 ORDER BY 1`)
  assert.deepEqual(readable, [{ relname: 'showcase_items', columns: 23 }])
  const writable = await rows(db, `
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
       AND has_any_column_privilege('anon', c.oid, 'INSERT, UPDATE, REFERENCES') ORDER BY 1`)
  assert.deepEqual(writable, [])
  // The CASE keeps has_sequence_privilege() off other relations: the planner
  // may evaluate it before the relkind and schema filters, and it raises on a
  // relation that is not a sequence.
  const sequences = await rows(db, `
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
       AND CASE WHEN c.relkind = 'S' AND n.nspname = 'public'
                THEN has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE') ELSE false END
     ORDER BY 1`)
  assert.deepEqual(sequences, [])

  // What it means. Until 043 this TRUNCATE went through as anon and emptied
  // the table inside the request: RLS is not asked.
  const jobPostings = () => one(db, 'SELECT count(*)::int AS n FROM public.job_postings')
  for (const who of ['anon', 'gone', 'B', 'A', 'adminTotp']) {
    await assertRefused(who, 'TRUNCATE public.job_postings')
    await assertRefused(who, 'TRUNCATE public.showcase_items CASCADE')
  }
  await tryAs(db, 'service_role', async () => {
    await db.exec('TRUNCATE public.job_postings')
    assert.equal((await asOperatorInside(jobPostings)).n, 0, 'the service role still can')
  })
  assert.equal((await jobPostings()).n, 1, 'and it was rolled back')
})

// Functions anon may call: the doors, each of which checks a secret or a
// token itself. The first three are 043's; 047 adds the two customer
// form-link doors (the site Worker holds only the anon key, and both check
// lead_intake_secret before anything else). 043's list names them too, so
// applying 043 again keeps them. Until 043 a second list followed, 26
// helpers and trigger functions of 001-029 that still carried Postgres's
// default EXECUTE for PUBLIC. It is empty and stays empty: new functions
// revoke (AGENTS.md, database rule 3).
const ANON_DOORS = [
  'calendar_feed(text)', 'intake_site_lead(text,jsonb)', 'intake_subscriber(text,jsonb)',
  'form_link_read(text,text)', 'form_link_submit(text,text,jsonb,text)',
]
const ANON_LEGACY_EXECUTE = []

test('functions: anon may call the doors and nothing else', async () => {
  const callable = await rows(db, `
    SELECT p.oid::regprocedure::text AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1`)
  assert.deepEqual(callable.map((f) => f.signature), sorted([...ANON_DOORS, ...ANON_LEGACY_EXECUTE]))

  // The helpers are refused before they answer. is_admin() and has_perm()
  // said "false" to anon before 043; the channel checks said "true" for a
  // public studio channel, confirming that an id exists.
  for (const call of [
    'public.is_active()', 'public.is_admin()', `public.has_perm('clients', 'view')`, 'public.can_see_space(NULL)',
    `public.can_view_channel('${S.channel.general}')`, `public.can_post_channel('${S.channel.general}')`,
    `public.can_manage_channel('${S.channel.general}')`, `public.is_conversation_participant('${S.conversation['A and admin']}')`,
    'public.chat_retention()', `public.is_push_service_endpoint('https://fcm.googleapis.com/fcm/send/x')`,
  ]) {
    await assertRefused('anon', `SELECT ${call}`, [], { message: /permission denied for function/ })
  }
  await assertRefused('anon', `INSERT INTO public.channel_messages (channel_id, body) VALUES ($1, 'hello')`, [S.channel.general])
})

test('functions: trigger functions are nobody\'s to call, and the triggers still fire', async () => {
  // A trigger fires whatever the caller's EXECUTE rights are, so 043 took the
  // grant from PUBLIC, anon and authenticated on every one of them.
  const held = await rows(db, `
    SELECT p.oid::regprocedure::text AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     ORDER BY 1`)
  assert.deepEqual(held, [])
  await assertRefused('B', 'SELECT public.set_updated_at()', [], { message: /permission denied for function/ })
  // With the right, Postgres itself refuses: not a function to call.
  await assert.rejects(db.query('SELECT public.set_updated_at()'), { code: '0A000' })

  // Still firing for a signed-in member, from both kinds: set_updated_at()
  // (SECURITY INVOKER) and bump_channel_on_message() (SECURITY DEFINER).
  const channel = S.channel['b-private']
  // As text: a JS Date would drop the microseconds the comparison needs.
  const before = await one(db,
    'SELECT updated_at::text AS updated_at, last_message_at::text AS last_message_at FROM public.channels WHERE id = $1', [channel])
  await tryAs(db, ACTORS.B, async () => {
    await db.query(`UPDATE public.channels SET topic = 'renamed' WHERE id = $1`, [channel])
    await db.query(`INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'bump')`, [channel, ID.B])
    const after = await asOperatorInside(() => one(db,
      `SELECT updated_at > $2::timestamptz AS touched, last_message_at > $3::timestamptz AS bumped FROM public.channels WHERE id = $1`,
      [channel, before.updated_at, before.last_message_at]))
    assert.deepEqual(after, { touched: true, bumped: true })
  })
  // And the one on auth.users, fired by Supabase Auth's own role: a new
  // account still gets its profile (handle_new_user lost PUBLIC's EXECUTE).
  await db.exec('BEGIN')
  try {
    await db.query(`INSERT INTO public.signup_allowlist (email) VALUES ('new.hire@example.test')`)
    await db.exec('SET LOCAL SESSION AUTHORIZATION supabase_auth_admin')
    const made = await one(db, `INSERT INTO auth.users (email, email_confirmed_at) VALUES ('new.hire@example.test', now()) RETURNING id`)
    await db.exec('SET LOCAL SESSION AUTHORIZATION postgres')
    assert.equal((await one(db, 'SELECT role FROM public.profiles WHERE id = $1', [made.id])).role, 'member')
  } finally {
    await db.exec('ROLLBACK')
  }

  // The helpers the policies call stay with authenticated: without them every
  // read of a signed-in member would fail instead of being filtered.
  const helpers = await rows(db, `
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND p.proname IN ('is_active', 'is_admin', 'has_perm', 'can_see_space', 'can_view_channel', 'can_post_channel',
                         'can_manage_channel', 'is_conversation_participant', 'chat_retention', 'is_push_service_endpoint')
     ORDER BY 1`)
  assert.equal(helpers.length, 10, helpers.map((h) => h.proname).join(', '))
})

test('the doors: a wrong secret or token gets nothing and writes nothing', async () => {
  const lead = JSON.stringify({ name: 'Vera Visitor', email: 'vera@visitor.example.test', message: 'Hello', consent: true, form: 'contact' })
  const subscriber = JSON.stringify({ email: 'vera@visitor.example.test', consent: true, source: 'footer' })
  const answers = JSON.stringify({ goal: 'Replaced by a stranger' })
  const counts = () => one(db, `
    SELECT (SELECT count(*)::int FROM public.leads) AS leads,
           (SELECT count(*)::int FROM public.lead_intake_attempts) AS attempts,
           (SELECT count(*)::int FROM public.site_subscribers) AS subscribers,
           (SELECT count(*)::int FROM public.site_subscriber_attempts) AS subscriber_attempts,
           (SELECT count(*)::int FROM public.notifications) AS notifications,
           (SELECT count(*)::int FROM public.lead_activity) AS lead_activity,
           (SELECT string_agg(answers::text || '|' || coalesce(customer_submitted_at::text, ''), ',' ORDER BY form)
              FROM public.form_responses) AS forms`)
  const before = await counts()
  const FORBIDDEN = { code: '42501', message: /forbidden/ }

  // These commit, on purpose: a rollback would hide a row written before the refusal.
  for (const secret of ['', 'wrong', INTAKE_SECRET.slice(0, -1), `${INTAKE_SECRET} `, null]) {
    await assert.rejects(asAnon(db, () => db.query('SELECT public.intake_site_lead($1, $2::jsonb)', [secret, lead])), FORBIDDEN)
    await assert.rejects(asAnon(db, () => db.query('SELECT public.intake_subscriber($1, $2::jsonb)', [secret, subscriber])), FORBIDDEN)
    // 047: a link alone is not enough; the answers hold the team's notes.
    await assert.rejects(asAnon(db, () => db.query('SELECT public.form_link_read($1, $2)', [secret, S.formToken])), FORBIDDEN)
    await assert.rejects(asAnon(db, () =>
      db.query(`SELECT public.form_link_submit($1, $2, $3::jsonb, 'Discovery')`, [secret, S.formToken, answers])), FORBIDDEN)
  }
  for (const token of ['', 'nope', '0'.repeat(64), S.feedToken.toUpperCase(), null]) {
    const answer = await asAnon(db, () => one(db, 'SELECT public.calendar_feed($1) AS feed', [token]))
    assert.equal(answer.feed, null, `calendar_feed(${JSON.stringify(token)})`)
  }
  // With the secret, a wrong or malformed link finds nothing.
  for (const token of ['', 'nope', S.formToken.toUpperCase(), `${S.formToken}x`, null]) {
    const read = await asAnon(db, () => one(db, 'SELECT public.form_link_read($1, $2) AS r', [INTAKE_SECRET, token]))
    assert.deepEqual(read.r, { ok: false, reason: 'not_found' }, `form_link_read(${JSON.stringify(token)})`)
    const sent = await asAnon(db, () =>
      one(db, `SELECT public.form_link_submit($1, $2, $3::jsonb, 'Discovery') AS r`, [INTAKE_SECRET, token, answers]))
    assert.deepEqual(sent.r, { ok: false, reason: 'not_found' }, `form_link_submit(${JSON.stringify(token)})`)
  }
  assert.deepEqual(await counts(), before)

  // -- the controls: with the secret or the token, the same calls go through
  const made = await tryAs(db, 'anon', () => one(db, 'SELECT public.intake_site_lead($1, $2::jsonb) AS result', [INTAKE_SECRET, lead]))
  assert.equal(made.result.ok, true, JSON.stringify(made.result))
  const subscribed = await tryAs(db, 'anon', () =>
    one(db, 'SELECT public.intake_subscriber($1, $2::jsonb) AS result', [INTAKE_SECRET, subscriber]))
  assert.equal(subscribed.result.ok, true, JSON.stringify(subscribed.result))
  const feed = await tryAs(db, 'anon', () => one(db, 'SELECT public.calendar_feed($1) AS feed', [S.feedToken]))
  assert.deepEqual(feed.feed.events.map((e) => e.title), ['Kickoff', 'Launch day'], 'the feed of A, who created both')
  const read = await tryAs(db, 'anon', () => one(db, 'SELECT public.form_link_read($1, $2) AS r', [INTAKE_SECRET, S.formToken]))
  assert.deepEqual([read.r.ok, read.r.form, read.r.answers], [true, 'discovery', { goal: 'More leads' }], JSON.stringify(read.r))
  const sent = await tryAs(db, 'anon', () =>
    one(db, `SELECT public.form_link_submit($1, $2, $3::jsonb, 'Discovery') AS r`, [INTAKE_SECRET, S.formToken, answers]))
  assert.equal(sent.r.ok, true, JSON.stringify(sent.r))
  // A signed-in member has no use for the intake functions and no right to them.
  await assertRefused('A', 'SELECT public.intake_site_lead($1, $2::jsonb)', [INTAKE_SECRET, lead])
  await assertRefused('A', 'SELECT public.intake_subscriber($1, $2::jsonb)', [INTAKE_SECRET, subscriber])
  await assertRefused('A', 'SELECT public.form_link_read($1, $2)', [INTAKE_SECRET, S.formToken])
  assert.deepEqual(await counts(), before)
})

test('the doors fail closed when the Vault holds no secret', async () => {
  // An empty secret must not match an empty or missing argument.
  const lead = JSON.stringify({ name: 'Vera Visitor', email: 'vera@visitor.example.test', consent: true })
  const counts = () => one(db, `
    SELECT (SELECT count(*)::int FROM public.leads) AS leads, (SELECT count(*)::int FROM public.site_subscribers) AS subscribers`)
  const before = await counts()
  const FORBIDDEN = { code: '42501', message: /forbidden/ }
  const tryAll = async () => {
    for (const secret of ['', null, 'short', INTAKE_SECRET]) {
      await assert.rejects(asAnon(db, () => db.query('SELECT public.intake_site_lead($1, $2::jsonb)', [secret, lead])), FORBIDDEN)
      await assert.rejects(asAnon(db, () => db.query('SELECT public.intake_subscriber($1, $2::jsonb)', [secret, lead])), FORBIDDEN)
      await assert.rejects(asAnon(db, () => db.query('SELECT public.form_link_read($1, $2)', [secret, S.formToken])), FORBIDDEN)
      await assert.rejects(asAnon(db, () =>
        db.query(`SELECT public.form_link_submit($1, $2, '{}'::jsonb, 'Discovery')`, [secret, S.formToken])), FORBIDDEN)
    }
  }
  try {
    await db.exec(`DELETE FROM vault.secrets WHERE name = 'lead_intake_secret'`)
    await tryAll()
    await db.exec(`SELECT vault.create_secret('', 'lead_intake_secret')`)
    await tryAll()
    // Too short to be a secret (under 16 characters): shut as well, even for a caller who knows it.
    await db.exec(`UPDATE vault.secrets SET secret = 'short' WHERE name = 'lead_intake_secret'`)
    await tryAll()
  } finally {
    await db.exec(`DELETE FROM vault.secrets WHERE name = 'lead_intake_secret'`)
    await db.query(`SELECT vault.create_secret($1, 'lead_intake_secret')`, [INTAKE_SECRET])
  }
  assert.deepEqual(await counts(), before)
})

// ------------------------------------------------- active accounts only (043)

/**
 * One request as `who` after the operator changed something first, all in
 * one transaction that is rolled back: "the same person, the same token,
 * with the profile in another state". Triggers that the change fires (032
 * removes a person's devices on deactivation) are taken back with it.
 */
async function tryAfter(prepare, who, fn) {
  await db.exec('BEGIN')
  try {
    await prepare()
    await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.headers', '{}', true)`,
      [JSON.stringify({ sub: who.id, role: 'authenticated', email: who.email, aal: who.aal })])
    await db.exec('SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated')
    return await fn()
  } finally {
    await db.exec('ROLLBACK')
  }
}

test('is_active(): a profile that exists and is not deactivated', async () => {
  const active = (who) => tryAs(db, who, () => one(db, 'SELECT public.is_active() AS active')).then((r) => r.active)
  for (const who of ['B', 'A', 'admin', 'adminTotp']) assert.equal(await active(ACTORS[who]), true, who)
  assert.equal(await active(ACTORS.gone), false, 'deactivated')
  assert.equal(await active(ACTORS.nobody), false, 'no profile row')
  // A token whose subject is no account at all.
  assert.equal(await active({ id: '11111111-1111-4111-8111-111111111111', email: 'ghost@example.test' }), false)
  // The service key has no user; it does not need the answer (it bypasses RLS).
  assert.equal(await active('service_role'), false)
  await assertRefused('anon', 'SELECT public.is_active()')

  // It follows the profile at once, with the same token: B switched off by
  // an admin reads nothing in its very next request,
  const directory = () => rows(db, 'SELECT public.is_active() AS active, (SELECT count(*)::int FROM public.profiles) AS profiles')
  assert.deepEqual(await tryAs(db, ACTORS.B, directory), [{ active: true, profiles: 4 }])
  assert.deepEqual(
    await tryAfter(() => db.query('UPDATE public.profiles SET deactivated_at = now() WHERE id = $1', [ID.B]), ACTORS.B, directory),
    [{ active: false, profiles: 0 }])
  // gone switched back on reads again,
  assert.deepEqual(
    await tryAfter(() => db.query('UPDATE public.profiles SET deactivated_at = NULL WHERE id = $1', [ID.gone]), ACTORS.gone, directory),
    [{ active: true, profiles: 4 }])
  // and a profile deleted under a live token is the "no profile" case. B's
  // chat goes first: the ON DELETE SET NULL on messages.sender_id and
  // channel_messages.sender_id trips 024's guard_message_update and
  // guard_channel_message_update ("... cannot be moved, re-attributed or
  // re-dated"), so today a profile with chat messages cannot be deleted at
  // all. That is a schema issue for a later migration, not what this check
  // is about.
  assert.deepEqual(
    await tryAfter(async () => {
      await db.query('DELETE FROM public.messages WHERE sender_id = $1', [ID.B])
      await db.query('DELETE FROM public.channel_messages WHERE sender_id = $1', [ID.B])
      await db.query('DELETE FROM public.profiles WHERE id = $1', [ID.B])
    }, ACTORS.B, directory),
    [{ active: false, profiles: 0 }])
})

test('every table a signed-in account can reach carries the active_account_only policy', async () => {
  // The tables that have a permissive policy for authenticated (or for
  // PUBLIC). A new table with such a policy fails here until its migration
  // adds the restrictive one too.
  const reachable = await rows(db, `
    SELECT c.relname,
           EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'active_account_only') AS guarded
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND EXISTS (SELECT 1 FROM pg_policy p
                    WHERE p.polrelid = c.oid AND p.polpermissive
                      AND ('authenticated'::regrole::oid = ANY (p.polroles) OR 0 = ANY (p.polroles)))
     ORDER BY 1`)
  // 44 after 043/044; 046, 048 and 049 add form_responses, booking_attempts and emails;
  // 053 adds five admin-only Cube tables; 058 recording_folders and meeting_recordings;
  // 059 whiteboard_folders and whiteboards; 060 vault_key_slots.
  assert.equal(reachable.length, 58)
  assert.deepEqual(reachable.filter((t) => !t.guarded).map((t) => t.relname), [])

  // One shape everywhere: restrictive, every command, authenticated only,
  // and the call inside a scalar sub-select (once per statement, not per row).
  const shapes = await rows(db, `
    SELECT DISTINCT permissive, cmd, roles::text AS roles, qual, with_check
      FROM pg_policies WHERE schemaname = 'public' AND policyname = 'active_account_only'`)
  assert.deepEqual(shapes, [{
    permissive: 'RESTRICTIVE', cmd: 'ALL', roles: '{authenticated}',
    qual: '( SELECT is_active() AS is_active)', with_check: '( SELECT is_active() AS is_active)',
  }])
  const plan = await tryAs(db, ACTORS.B, () => rows(db, 'EXPLAIN SELECT * FROM public.profiles'))
  assert.match(plan.map((line) => line['QUERY PLAN']).join('\n'), /InitPlan/)

  // The tables without one have no policy at all: nothing to restrict.
  const unguarded = await rows(db, `
    SELECT c.relname, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'active_account_only')
     ORDER BY 1`)
  assert.deepEqual(unguarded, [
    'calendar_feed_tokens', 'google_connections', 'google_sync_outbox', 'google_workspace_link', 'signup_allowlist',
    'site_subscriber_attempts', 'vault_reset_codes',
  ].map((relname) => ({ relname, policies: 0 })))
})

test('a deactivated account is locked out of everything, with its token still valid', async () => {
  // Until 043 every statement in the first block went through: these
  // policies ask neither has_perm() nor is_admin(), which is all 032 changed.
  // gone still holds a valid token, is a participant of 'A and gone', and
  // its profile still says admin.
  await assertRefused('gone', `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'still here')`,
    [S.channel.general, ID.gone])
  await assertRefused('gone', `INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ($1, $2, 'still here')`,
    [S.conversation['A and gone'], ID.gone])
  await assertRefused('gone', 'INSERT INTO public.conversations (participant_ids, created_by) VALUES ($1::uuid[], $2)',
    [[ID.gone, ID.B], ID.gone])
  await assertRefused('gone', `INSERT INTO public.channels (name, created_by) VALUES ('made-after-leaving', $1)`, [ID.gone])
  await assertRefused('gone',
    `INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES ($1, $2, 'task_assigned', 'from a leaver')`, [ID.A, ID.gone])
  await assertRefused('gone', 'INSERT INTO public.channel_reads (channel_id, user_id) VALUES ($1, $2)', [S.channel.general, ID.gone])
  await assertNoRows('gone', `UPDATE public.profiles SET full_name = 'Renamed after leaving' WHERE id = $1`, [ID.gone])
  await assertNoRows('gone', 'UPDATE public.notifications SET read = true')
  await assertNoRows('gone', 'DELETE FROM public.notifications')
  await assertNoRows('gone', 'DELETE FROM public.conversation_reads')
  await assertNoRows('gone', 'DELETE FROM public.channels WHERE id = $1', [S.channel.general])
  await assertRefused('gone', `SELECT public.calendar_feed_rotate('all')`)

  // The control: the same account, switched back on, does these things. It
  // is the deactivation that refuses, not the statements.
  await tryAfter(() => db.query('UPDATE public.profiles SET deactivated_at = NULL WHERE id = $1', [ID.gone]), ACTORS.gone, async () => {
    const sent = await db.query(
      `INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ($1, $2, 'back')`, [S.conversation['A and gone'], ID.gone])
    assert.equal(sent.affectedRows, 1)
    const posted = await db.query(
      `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'back')`, [S.channel.general, ID.gone])
    assert.equal(posted.affectedRows, 1)
    assert.deepEqual((await rows(db, 'SELECT title FROM public.notifications')).map((r) => r.title), ['for gone'])
    assert.equal((await db.query(`UPDATE public.profiles SET full_name = 'Gil' WHERE id = $1`, [ID.gone])).affectedRows, 1)
  })

  // What is left to it are the helper functions' yes and no about ids it
  // already knows. They are opinions: every table they guard refused above.
  const answers = await tryAs(db, ACTORS.gone, () => one(db, `
    SELECT public.is_active() AS active, public.is_admin() AS is_admin, public.has_perm('clients', 'view') AS has_perm,
           public.can_manage_channel($1) AS manage, public.can_see_space($2) AS client_space,
           public.can_see_space(NULL) AS studio_space, public.can_view_channel($1) AS public_channel,
           public.is_conversation_participant($3) AS participant`,
  [S.channel.general, S.client, S.conversation['A and gone']]))
  assert.deepEqual(answers, {
    active: false, is_admin: false, has_perm: false, manage: false, client_space: false,
    studio_space: true, public_channel: true, participant: true,
  })
})

test('push: an account that is not active registers no device', async () => {
  const device = (name) => [`https://fcm.googleapis.com/fcm/send/${name}`, 'B'.repeat(87), 'a'.repeat(22), 'https://desk.example.test']
  const NOT_ACTIVE = { message: /This account is not active/ }
  // Until 043 the first of these went through: 032's trigger removes a
  // person's devices when they are deactivated, and the old function let the
  // same account put one back for as long as its token lived.
  await assertRefused('gone', 'SELECT public.upsert_push_subscription($1, $2, $3, $4)', device('after-leaving'), NOT_ACTIVE)
  await assertRefused('nobody', 'SELECT public.upsert_push_subscription($1, $2, $3, $4)', device('no-profile'), NOT_ACTIVE)
  await assertRefused('anon', 'SELECT public.upsert_push_subscription($1, $2, $3, $4)', device('no-session'))
  // Not by taking over a device an active person registered, either.
  await assertRefused('gone', 'SELECT public.upsert_push_subscription($1, $2, $3, $4)',
    ['https://push.example.test/A', 'B'.repeat(87), 'a'.repeat(22), 'https://desk.example.test'], NOT_ACTIVE)

  // The control: an active member registers, and re-registers the same device.
  await tryAs(db, ACTORS.B, async () => {
    await db.query('SELECT public.upsert_push_subscription($1, $2, $3, $4)', device('b-phone'))
    await db.query('SELECT public.upsert_push_subscription($1, $2, $3, $4)', device('b-phone'))
    assert.deepEqual((await rows(db, 'SELECT endpoint FROM public.push_subscriptions ORDER BY 1')).map((r) => r.endpoint),
      ['https://fcm.googleapis.com/fcm/send/b-phone', 'https://push.example.test/B'])
  })
  // Removing a device of its own stays open to a deactivated account:
  // sign-out does that, and it can only take away. (The row is put there by
  // the operator; the account itself can no longer make one.)
  const leftover = 'https://push.example.test/gone-leftover'
  await db.query(
    `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, app_base)
     VALUES ($1, $2, 'p256dh', 'auth', 'https://desk.example.test')`, [ID.gone, leftover])
  try {
    await tryAs(db, ACTORS.gone, async () => {
      await db.query('SELECT public.delete_push_subscription($1)', ['https://push.example.test/A'])
      await db.query('SELECT public.delete_push_subscription($1)', [leftover])
      assert.deepEqual(
        (await asOperatorInside(() => rows(db, `SELECT ${person('user_id')} AS who FROM public.push_subscriptions ORDER BY 1`)))
          .map((r) => r.who),
        ['A', 'B'])
    })
  } finally {
    await db.query('DELETE FROM public.push_subscriptions WHERE endpoint = $1', [leftover])
  }
})

test('043 applied again on a database in use: it removes the devices of deactivated accounts and changes nothing else', async () => {
  const state = () => one(db, `
    SELECT (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS policies,
           (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND policyname = 'active_account_only') AS lockouts,
           (SELECT count(*)::int FROM public.profiles) AS profiles,
           (SELECT count(*)::int FROM public.notifications) AS notifications,
           (SELECT count(*)::int FROM public.channels) AS channels,
           (SELECT md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text))
              FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) AS function_grants,
           (SELECT md5(string_agg(c.relname || coalesce(c.relacl::text, ''), ',' ORDER BY c.relname))
              FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')) AS table_grants`)
  const before = await state()
  assert.equal(before.lockouts, 58)

  // A device a deactivated account registered through the old function,
  // before this file was applied. The trigger of 032 has already run for it.
  await db.query(
    `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, app_base)
     VALUES ($1, 'https://push.example.test/gone-again', 'p256dh', 'auth', 'https://desk.example.test')`, [ID.gone])
  await applyMigration(db, MIGRATION_043)
  assert.deepEqual(
    (await rows(db, `SELECT ${person('user_id')} AS who FROM public.push_subscriptions ORDER BY 1`)).map((r) => r.who), ['A', 'B'])
  assert.deepEqual(await state(), before)
  // And what it closed is still closed, for the people it must not touch.
  assert.deepEqual(await seen(ACTORS.gone, 'profiles', 'full_name'), [])
  assert.equal((await seen(ACTORS.B, 'profiles', 'full_name')).length, 4)
  assert.deepEqual(await seen('anon', 'showcase_items', 'slug'), ['published-site'])
})

test('043 fails, and says where, when a grant it cannot take away is left', async () => {
  // Section 6 of the file. On a hosted project a REVOKE on an object that
  // belongs to another role only warns; the file must not look applied then.
  // The stand-in here is a grant its loops do not look for: a table opened
  // to PUBLIC, which anon is part of.
  await db.exec('GRANT SELECT ON public.job_postings TO PUBLIC')
  try {
    assert.deepEqual(await seen('anon', 'job_postings', 'title'), [], 'the grant reaches anon (RLS still returns nothing)')
    await assert.rejects(applyMigration(db, MIGRATION_043),
      /043: anon or authenticated still hold a table privilege they should not on: job_postings/)
  } finally {
    await db.exec('REVOKE SELECT ON public.job_postings FROM PUBLIC')
  }
  // A grant made straight to anon is one it does look for: applying closes it.
  await db.exec('GRANT ALL ON public.job_postings TO anon; GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC')
  await applyMigration(db, MIGRATION_043)
  assert.equal(await seen('anon', 'job_postings', 'title'), REFUSED)
  await assertRefused('anon', 'SELECT public.is_admin()')
  // And B, who calls is_admin() in half the policies, still reads.
  assert.equal((await seen(ACTORS.B, 'profiles', 'full_name')).length, 4)
})

// --------------------------------------- a creator outside its own channel

test('channels: the creator of a private channel does not manage it after being taken out of it', async () => {
  // "The creator is always included" (023) is only checked when the channel
  // is made; an admin can take the creator out of member_ids afterwards.
  // Until 043 channels_update and channels_delete still knew the creator as
  // the manager, and an UPDATE without a WHERE put it back in.
  const channel = (await one(db,
    `INSERT INTO public.channels (name, is_private, member_ids, created_by) VALUES ('left-by-its-creator', true, $1::uuid[], $2) RETURNING id`,
    [[ID.B], ID.A])).id
  try {
    const message = (await one(db,
      `INSERT INTO public.channel_messages (channel_id, sender_id, body) VALUES ($1, $2, 'after A left') RETURNING id`, [channel, ID.B])).id
    const readsIt = () => rows(db, 'SELECT body FROM public.channel_messages WHERE channel_id = $1', [channel])
    assert.deepEqual(await tryAs(db, ACTORS.A, readsIt), [])

    // With a WHERE, which is every statement PostgREST sends.
    await assertNoRows('A', 'UPDATE public.channels SET member_ids = member_ids || $2::uuid WHERE id = $1', [channel, ID.A])
    await assertNoRows('A', 'DELETE FROM public.channels WHERE id = $1', [channel])
    await assertNoRows('A', 'DELETE FROM public.channel_messages WHERE channel_id = $1', [channel])
    await assertNoRows('A', 'UPDATE public.channel_messages SET pinned_at = now() WHERE id = $1', [message])

    // Without one, only the UPDATE or DELETE policy is asked. A reaches the
    // three channels it made and is in, and not this one.
    await tryAs(db, ACTORS.A, async () => {
      const touched = (await db.query(`UPDATE public.channels SET member_ids = ARRAY['${ID.A}']::uuid[]`)).affectedRows
      assert.equal(touched, 3)
      assert.deepEqual(await readsIt(), [])
      const members = await asOperatorInside(() => one(db, 'SELECT member_ids::text AS ids FROM public.channels WHERE id = $1', [channel]))
      assert.equal(members.ids, `{${ID.B}}`)
    })
    await tryAs(db, ACTORS.A, async () => {
      assert.equal((await db.query('DELETE FROM public.channels')).affectedRows, 3)
      assert.equal((await asOperatorInside(() => one(db, 'SELECT count(*)::int AS n FROM public.channels WHERE id = $1', [channel]))).n, 1)
    })
    // The messages of the others in it are no longer A's to delete: one of
    // its own in each of its three channels, and that is all.
    await tryAs(db, ACTORS.A, async () => {
      assert.equal((await db.query('DELETE FROM public.channel_messages')).affectedRows, 3)
      assert.deepEqual(await asOperatorInside(readsIt), [{ body: 'after A left' }])
    })

    // What the helper says, for each kind of person.
    const manages = (who) => tryAs(db, ACTORS[who], () => one(db, 'SELECT public.can_manage_channel($1) AS manages', [channel]))
      .then((r) => r.manages)
    assert.equal(await manages('A'), false, 'the creator, taken out')
    assert.equal(await manages('B'), false, 'a member who did not make it')
    assert.equal(await manages('admin'), true, 'an admin')

    // -- the controls
    // An admin still manages it, member or not.
    await assertChanges('admin', 1, `UPDATE public.channels SET topic = 'by an admin' WHERE id = $1`, [channel])
    await assertChanges('admin', 1, 'DELETE FROM public.channel_messages WHERE id = $1', [message])
    // A creator who is in its private channel still manages it,
    await assertChanges('A', 1, `UPDATE public.channels SET topic = 'mine' WHERE id = $1`, [S.channel['a-private']])
    await assertChanges('A', 1, 'DELETE FROM public.channels WHERE id = $1', [S.channel['a-private']])
    // and a public channel needs no membership from its creator.
    await assertChanges('A', 1, `UPDATE public.channels SET topic = 'open' WHERE id = $1`, [S.channel.general])
    // Put back in by the admin, A is the manager again.
    await db.query('UPDATE public.channels SET member_ids = $2::uuid[] WHERE id = $1', [channel, [ID.B, ID.A]])
    assert.equal(await manages('A'), true)
    await assertChanges('A', 1, 'DELETE FROM public.channels WHERE id = $1', [channel])
  } finally {
    await db.query('DELETE FROM public.channels WHERE id = $1', [channel])
  }
})
