// The database side of the 2026-10-07 revision list (items 2–9): one section
// per migration, each against the full chain on PGlite.
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { freshDatabase, addUser, asUser, one, applyMigration } from './harness.mjs'

let db, admin, member, viewer, outsider, client, project

before(async () => {
  db = await freshDatabase()
  admin = await addUser(db, { email: 'rev-admin@example.test', role: 'admin' })
  member = await addUser(db, { email: 'rev-member@example.test', permissions: { tasks: 'edit', projects: 'edit', crm: 'edit', courses: 'edit', meetings: 'edit' } })
  viewer = await addUser(db, { email: 'rev-viewer@example.test', permissions: { tasks: 'view', crm: 'view', courses: 'view', meetings: 'view' } })
  outsider = await addUser(db, { email: 'rev-outsider@example.test' })
  client = (await one(db, "INSERT INTO public.clients(name) VALUES('Revision client') RETURNING id")).id
  project = (await one(db, "INSERT INTO public.projects(client_id,title) VALUES($1,'Revision project') RETURNING id", [client])).id
})
after(async () => { await db?.close() })

// ── 054 task collaborators ────────────────────────────────────────────────

test('054: collaborators are deduplicated, never the assignee, only real people, in order', async () => {
  const ghost = '00000000-0000-4000-8000-000000000001'
  const task = await asUser(db, member, () => one(db,
    `INSERT INTO public.tasks(client_id,title,assignee_id,collaborator_ids)
     VALUES($1,'Pair on it',$2,$3::uuid[]) RETURNING id, collaborator_ids`,
    [client, member.id, `{${viewer.id},${member.id},${ghost},${admin.id},${viewer.id}}`]))
  assert.deepEqual(task.collaborator_ids, [viewer.id, admin.id])

  // Becoming the assignee takes a person off the collaborator list.
  const moved = await asUser(db, member, () => one(db,
    'UPDATE public.tasks SET assignee_id=$2 WHERE id=$1 RETURNING collaborator_ids', [task.id, admin.id]))
  assert.deepEqual(moved.collaborator_ids, [viewer.id])

  const plain = await one(db, "INSERT INTO public.tasks(client_id,title) VALUES($1,'Solo') RETURNING collaborator_ids", [client])
  assert.deepEqual(plain.collaborator_ids, [])
})

test('054: at most 20 collaborators, and only tasks:edit may set them', async () => {
  const people = []
  for (let i = 0; i < 21; i++) people.push((await addUser(db, { email: `rev-c${i}@example.test` })).id)
  await assert.rejects(asUser(db, member, () => db.query(
    "INSERT INTO public.tasks(client_id,title,collaborator_ids) VALUES($1,'Crowd',$2::uuid[])", [client, `{${people.join(',')}}`])),
  /at most 20/)
  const task = (await one(db, "INSERT INTO public.tasks(client_id,title) VALUES($1,'Viewer try') RETURNING id", [client])).id
  const res = await asUser(db, viewer, () => db.query('UPDATE public.tasks SET collaborator_ids=$2::uuid[] WHERE id=$1', [task, `{${viewer.id}}`]))
  assert.equal(res.affectedRows ?? 0, 0)
  assert.deepEqual((await one(db, 'SELECT collaborator_ids FROM public.tasks WHERE id=$1', [task])).collaborator_ids, [])
  void outsider; void project
})

test('054: applying it again changes nothing', async () => {
  const before = await one(db, 'SELECT count(*)::int AS n FROM public.tasks')
  await applyMigration(db, '054_task_collaborators.sql')
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM public.tasks')).n, before.n)
})

// ── 055 course topic notes ────────────────────────────────────────────────

test('055: a topic can be a note alone; courses:edit writes it, courses:view reads it', async () => {
  const course = (await one(db, "INSERT INTO public.courses(title) VALUES('Rev course') RETURNING id")).id
  const mod = (await one(db, "INSERT INTO public.course_modules(course_id,title) VALUES($1,'Rev module') RETURNING id", [course])).id
  const topic = await asUser(db, member, () => one(db,
    "INSERT INTO public.course_topics(module_id,title,notes) VALUES($1,'Checklist','1. Open the repo\n2. Run the build') RETURNING id, notes, sop_video_url", [mod]))
  assert.equal(topic.sop_video_url, null)
  assert.match(topic.notes, /Run the build/)
  const seen = await asUser(db, viewer, () => one(db, 'SELECT notes FROM public.course_topics WHERE id=$1', [topic.id]))
  assert.match(seen.notes, /Open the repo/)
  await assert.rejects(asUser(db, viewer, () => db.query(
    "INSERT INTO public.course_topics(module_id,title,notes) VALUES($1,'Nope','x')", [mod])), /row-level security/)
  await assert.rejects(db.query("UPDATE public.course_topics SET notes=repeat('x',100001) WHERE id=$1", [topic.id]), /course_topics_notes_length/)
  await applyMigration(db, '055_course_topic_notes.sql')
  assert.match((await one(db, 'SELECT notes FROM public.course_topics WHERE id=$1', [topic.id])).notes, /Open the repo/)
})

// ── 057 CRM people and formulas ───────────────────────────────────────────

test('057: person and formula columns, widths within 80–800, under crm RLS', async () => {
  const table = (await one(db, "INSERT INTO public.crm_tables(name) VALUES('Rev pipeline') RETURNING id")).id
  const person = await asUser(db, member, () => one(db,
    "INSERT INTO public.crm_columns(table_id,name,type,width) VALUES($1,'Owner','person',220) RETURNING id, width", [table]))
  assert.equal(person.width, 220)
  const formula = await asUser(db, member, () => one(db,
    "INSERT INTO public.crm_columns(table_id,name,type,formula) VALUES($1,'Fee','formula','{Deal value} * 0.1') RETURNING formula", [table]))
  assert.equal(formula.formula, '{Deal value} * 0.1')
  await assert.rejects(db.query("INSERT INTO public.crm_columns(table_id,name,type) VALUES($1,'Bad','rating')", [table]), /crm_columns_type_check/)
  await assert.rejects(db.query('UPDATE public.crm_columns SET width=20 WHERE id=$1', [person.id]), /crm_columns_width_check/)
  await assert.rejects(db.query("UPDATE public.crm_columns SET formula=repeat('x',2001) WHERE id=$1", [person.id]), /crm_columns_formula_check/)
  await assert.rejects(asUser(db, viewer, () => db.query(
    "INSERT INTO public.crm_columns(table_id,name,type) VALUES($1,'Viewer col','person')", [table])), /row-level security/)
  await applyMigration(db, '057_crm_columns_people_formulas.sql')
  assert.equal((await one(db, 'SELECT width FROM public.crm_columns WHERE id=$1', [person.id])).width, 220)
})

// ── 058 meeting recordings ────────────────────────────────────────────────

test('058: recordings file under their client, project and category; meetings permission decides', async () => {
  const other = (await one(db, "INSERT INTO public.clients(name) VALUES('Other client') RETURNING id")).id
  const folder = await asUser(db, member, () => one(db,
    "INSERT INTO public.recording_folders(client_id,name) VALUES($1,'Kickoffs') RETURNING id", [client]))
  const rec = await asUser(db, member, () => one(db,
    `INSERT INTO public.meeting_recordings(client_id,project_id,folder_id,title,url,recorded_on)
     VALUES($1,$2,$3,'Kickoff call','https://www.loom.com/share/abc123','2026-10-01') RETURNING *`,
    [other, project, folder.id]))
  // The project decides the client; the category stays because it is that client's.
  assert.equal(rec.client_id, client)
  assert.equal(rec.folder_id, folder.id)
  const moved = await asUser(db, member, () => one(db,
    'UPDATE public.meeting_recordings SET project_id=NULL, client_id=$2 WHERE id=$1 RETURNING client_id, folder_id', [rec.id, other]))
  assert.equal(moved.client_id, other)
  assert.equal(moved.folder_id, null)

  await assert.rejects(asUser(db, member, () => db.query(
    "INSERT INTO public.meeting_recordings(title,url) VALUES('Bad','http://insecure.example')")), /meeting_recordings_url_check/)
  assert.equal((await asUser(db, viewer, () => one(db, 'SELECT count(*)::int AS n FROM public.meeting_recordings'))).n, 1)
  await assert.rejects(asUser(db, viewer, () => db.query(
    "INSERT INTO public.meeting_recordings(title,url) VALUES('Nope','https://example.com/v.mp4')")), /row-level security/)
  assert.equal((await asUser(db, outsider, () => one(db, 'SELECT count(*)::int AS n FROM public.meeting_recordings'))).n, 0)

  // A deleted client takes its categories and leaves its recordings unfiled.
  await db.query('DELETE FROM public.clients WHERE id=$1', [other])
  const left = await one(db, 'SELECT client_id, folder_id FROM public.meeting_recordings WHERE id=$1', [rec.id])
  assert.deepEqual(left, { client_id: null, folder_id: null })
  await applyMigration(db, '058_meeting_recordings.sql')
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM public.meeting_recordings')).n, 1)
})

// ── 059 whiteboards ───────────────────────────────────────────────────────

test('059: any active account draws; a stale save is refused; the maker or an admin deletes', async () => {
  const board = await asUser(db, outsider, () => one(db,
    "INSERT INTO public.whiteboards(title, created_by) VALUES('Flow', $1) RETURNING id, version, updated_by", [outsider.id]))
  assert.equal(board.version, 1)
  assert.equal(board.updated_by, outsider.id)

  // A save names the version it was based on; the trigger moves it on.
  const saved = await asUser(db, member, () => one(db,
    `UPDATE public.whiteboards SET scene='{"elements":[{"id":"a"}]}'::jsonb WHERE id=$1 AND version=1 RETURNING version, updated_by`, [board.id]))
  assert.deepEqual(saved, { version: 2, updated_by: member.id })
  const stale = await asUser(db, outsider, () => db.query(
    `UPDATE public.whiteboards SET scene='{"elements":[]}'::jsonb WHERE id=$1 AND version=1`, [board.id]))
  assert.equal(stale.affectedRows ?? 0, 0)
  // Renaming is not a new version of the drawing.
  assert.equal((await asUser(db, outsider, () => one(db, "UPDATE public.whiteboards SET title='Flow v2' WHERE id=$1 RETURNING version", [board.id]))).version, 2)

  await assert.rejects(asUser(db, member, () => db.query('UPDATE public.whiteboards SET created_by=$2 WHERE id=$1', [board.id, member.id])), /permission denied/)
  await assert.rejects(asUser(db, member, () => db.query(
    `UPDATE public.whiteboards SET scene=to_jsonb(repeat('x', 5300000)) WHERE id=$1`, [board.id])), /whiteboards_scene_check|check constraint/)

  const notMine = await asUser(db, member, () => db.query('DELETE FROM public.whiteboards WHERE id=$1', [board.id]))
  assert.equal(notMine.affectedRows ?? 0, 0)
  const byAdmin = await asUser(db, admin, () => db.query('DELETE FROM public.whiteboards WHERE id=$1', [board.id]))
  assert.equal(byAdmin.affectedRows, 1)
  await applyMigration(db, '059_whiteboards.sql')
})

// ── 060 vault accounts ────────────────────────────────────────────────────

test('060: each admin keeps their own key slot, readable only by them at aal2; invites go to admins', async () => {
  const admin2 = await addUser(db, { email: 'rev-admin2@example.test', role: 'admin' })
  const meta = (await one(db, "INSERT INTO public.vault_meta(salt,iterations,wrapped_key) VALUES(repeat('b',32),210000,'ab') RETURNING id")).id
  const slot = (who, kind, userId) => db.query(
    `INSERT INTO public.vault_key_slots(meta_id,user_id,kind,salt,iterations,wrapped_key,created_by)
     VALUES($1,$2,$3,repeat('c',32),210000,'abcd',$4)`, [meta, userId, kind, who])
  const totp = (u) => ({ ...u, aal: 'aal2' })

  // Without the second factor nothing; with it, your own slot and an invite for another admin.
  await assert.rejects(asUser(db, admin, () => slot(admin.id, 'password', admin.id)), /row-level security/)
  await asUser(db, totp(admin), () => slot(admin.id, 'password', admin.id))
  await assert.rejects(asUser(db, totp(admin), () => slot(admin.id, 'invite', member.id)), /row-level security/)
  await asUser(db, totp(admin), () => slot(admin.id, 'invite', admin2.id))
  await assert.rejects(asUser(db, totp(member), () => slot(member.id, 'password', member.id)), /row-level security/)

  // Each reads only their own; the access list names both, without key material.
  const mine = await asUser(db, totp(admin), () => one(db, 'SELECT count(*)::int AS n FROM public.vault_key_slots'))
  assert.equal(mine.n, 1)
  assert.equal((await asUser(db, admin, () => one(db, 'SELECT count(*)::int AS n FROM public.vault_key_slots'))).n, 0)
  const list = await asUser(db, admin, () => db.query('SELECT user_id, kind FROM public.vault_access_list()'))
  assert.deepEqual(new Set(list.rows.map((r) => `${r.user_id}:${r.kind}`)), new Set([`${admin.id}:password`, `${admin2.id}:invite`]))
  assert.equal((await asUser(db, admin2, () => one(db, 'SELECT public.vault_my_access() AS k'))).k, 'invite')
  await assert.rejects(asUser(db, member, () => db.query('SELECT * FROM public.vault_access_list()')), /active admin/)

  // Claiming the invite turns it into a password slot; nobody edits someone else's.
  const claimed = await asUser(db, totp(admin2), () => db.query(
    "UPDATE public.vault_key_slots SET kind='password', salt=repeat('d',32), wrapped_key='beef' WHERE user_id=$1", [admin2.id]))
  assert.equal(claimed.affectedRows, 1)
  const other = await asUser(db, totp(admin2), () => db.query("UPDATE public.vault_key_slots SET wrapped_key='00' WHERE user_id=$1", [admin.id]))
  assert.equal(other.affectedRows ?? 0, 0)

  // Another admin's access goes through vault_remove_access(), at aal2, by an admin.
  const admin3 = await addUser(db, { email: 'rev-admin3@example.test', role: 'admin' })
  await asUser(db, totp(admin), () => slot(admin.id, 'invite', admin3.id))
  const blind = await asUser(db, totp(admin), () => db.query('DELETE FROM public.vault_key_slots WHERE user_id=$1', [admin3.id]))
  assert.equal(blind.affectedRows ?? 0, 0)
  await assert.rejects(asUser(db, admin, () => db.query('SELECT public.vault_remove_access($1)', [admin3.id])), /second factor/)
  await assert.rejects(asUser(db, totp(member), () => db.query('SELECT public.vault_remove_access($1)', [admin3.id])), /second factor/)
  assert.equal((await asUser(db, totp(admin), () => one(db, 'SELECT public.vault_remove_access($1) AS n', [admin3.id]))).n, 1)

  // Losing the admin role removes the slot; every step is in the audit log.
  await db.query("UPDATE public.profiles SET role='member' WHERE id=$1", [admin2.id])
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM public.vault_key_slots WHERE user_id=$1', [admin2.id])).n, 0)
  const actions = (await db.query("SELECT action FROM public.audit_log WHERE action LIKE 'vault.access%' ORDER BY id")).rows.map((r) => r.action)
  assert.deepEqual(actions.slice(-6), ['vault.access_created', 'vault.access_invited', 'vault.access_claimed', 'vault.access_invited', 'vault.access_removed', 'vault.access_removed'])
  await applyMigration(db, '060_vault_accounts.sql')
})
