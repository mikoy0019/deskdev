import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { freshDatabase, addUser, asUser, asAnon, one, rows, applyMigration } from './harness.mjs'

let db, admin, member, project, task, lead
const intake = patch => ({ contractReference: '', briefConfirmed: false, assetsConfirmed: false, creativeRequired: false, creativeApproved: false, qaConfirmed: false, evidence: '', ...patch })
const run = () => asUser(db, admin, () => db.query('SELECT public.cube_run()'))
const save = (version, patch) => asUser(db, admin, () => one(db,'SELECT * FROM public.cube_save_intake($1,$2,$3::jsonb)',[project,version,JSON.stringify(intake(patch))]))
before(async () => {
  db = await freshDatabase()
  admin = await addUser(db,{ email:'cube-admin@example.test',role:'admin' })
  await addUser(db,{ email:'cube-backup@example.test',role:'admin' })
  member = await addUser(db,{ email:'cube-member@example.test',permissions:{ projects:'edit',growth:'edit',tasks:'edit' } })
  const client = await one(db,"INSERT INTO public.clients(name) VALUES('Cube client') RETURNING id")
  project = (await one(db,"INSERT INTO public.projects(client_id,title,status) VALUES($1,'Cube project','planning') RETURNING id",[client.id])).id
  task = (await one(db,"INSERT INTO public.tasks(client_id,project_id,title,status,due_date) VALUES($1,$2,'Cube blocker','blocked',CURRENT_DATE-1) RETURNING id",[client.id,project])).id
  lead = (await one(db,"INSERT INTO public.leads(name,form,follow_up) VALUES('Cube lead','import',CURRENT_DATE-1) RETURNING id")).id
})
after(async () => { await db?.close() })

test('scheduler is registered and repeated migration preserves disabled configuration',async () => {
  assert.equal((await one(db,"SELECT schedule FROM cron.job WHERE jobname='cube-operations'")).schedule,'* * * * *')
  await asUser(db,admin,()=>db.query("SELECT public.cube_configure('creative',NULL,false)"))
  await applyMigration(db,'053_cube_operations.sql')
  assert.equal((await one(db,"SELECT enabled FROM public.cube_departments WHERE code='creative'")).enabled,false)
  await asUser(db,admin,()=>db.query("SELECT public.cube_configure('creative',NULL,true)"))
})
test('only active admins can operate queues; members cannot see financial or intake evidence',async () => {
  await assert.rejects(asAnon(db,()=>db.query('SELECT public.cube_run()')),/permission denied/)
  await assert.rejects(asUser(db,member,()=>db.query('SELECT public.cube_run()')),/active admin/)
  await assert.rejects(asUser(db,admin,()=>db.query('SELECT public.cube_tick()')),/permission denied/)
  await assert.rejects(asUser(db,member,()=>db.query("SELECT public.cube_configure('workspace',NULL,false)")),/active admin/)
  await assert.rejects(asUser(db,admin,()=>db.query("UPDATE public.cube_control SET enabled=false")),/permission denied/)
  await assert.rejects(asAnon(db,()=>db.query("SELECT nextval('public.cube_operation_history_id_seq')")),/permission denied/)
  await assert.rejects(asUser(db,admin,()=>db.query("SELECT nextval('public.cube_operation_history_id_seq')")),/permission denied/)
  for (const table of ['cube_departments','cube_control','cube_intakes','cube_work_items','cube_operation_history']) assert.equal((await asUser(db,member,()=>rows(db,`SELECT * FROM public.${table}`))).length,0)
})
test('automatic routing creates deduplicated work for recorded exceptions without changing source work',async () => {
  await run()
  assert.equal((await one(db,'SELECT last_error FROM public.cube_control')).last_error,null)
  const work = await rows(db,"SELECT * FROM public.cube_work_items WHERE status='open'")
  for (const department of ['growth','delivery','client_ops','finance','people','leadership']) assert.ok(work.some(w=>w.department===department),department)
  assert.ok(work.every(w=>w.owner_id===admin.id))
  const count = (await one(db,'SELECT count(*) AS count FROM public.cube_operation_history')).count
  await run()
  assert.equal((await one(db,'SELECT count(*) AS count FROM public.cube_operation_history')).count,count)
  assert.equal((await one(db,'SELECT status FROM public.tasks WHERE id=$1',[task])).status,'blocked')
  assert.match((await one(db,"SELECT instruction FROM public.cube_work_items WHERE key=$1",[`finance:project:${project}`])).instruction,/Contract pending/)
})
test('intake has version conflicts and evidence gates; a contract reference cannot invent acceptance',async () => {
  await assert.rejects(save(0,{briefConfirmed:true}),/evidence/)
  const saved = await save(0,{contractReference:'Agreement file pending signature',briefConfirmed:true,assetsConfirmed:true,creativeRequired:true,evidence:'Brief B1; asset folder A1'})
  assert.equal(saved.version,1)
  await assert.rejects(save(0,{}),/changed/)
  await assert.rejects(asUser(db,member,()=>db.query('SELECT public.cube_save_intake($1,1,$2::jsonb)',[project,JSON.stringify(intake({}))])),/active admin/)
  await run()
  assert.equal((await one(db,'SELECT last_error FROM public.cube_control')).last_error,null)
  assert.equal((await one(db,"SELECT status FROM public.cube_work_items WHERE key=$1",[`client_ops:project:${project}`])).status,'resolved')
  assert.equal((await one(db,"SELECT status FROM public.cube_work_items WHERE key=$1",[`creative:project:${project}`])).status,'open')
  assert.equal((await one(db,"SELECT count(*) AS count FROM public.cube_work_items WHERE key=$1",[`delivery:project:${project}`])).count,0)
})
test('pauses freeze queue states; source changes resolve on resume; urgent exceptions escalate once',async () => {
  await db.query("UPDATE public.cube_work_items SET first_seen_at=now()-interval '25 hours',urgent_since_at=now()-interval '25 hours' WHERE key=$1",[`delivery:task:${task}`])
  await run()
  assert.ok(await one(db,'SELECT key FROM public.cube_work_items WHERE key=$1',[`leadership:operation:delivery:task:${task}`]))
  await asUser(db,admin,()=>db.query("SELECT public.cube_configure('delivery',NULL,false)"))
  await db.query("UPDATE public.tasks SET status='done' WHERE id=$1",[task])
  await run()
  assert.equal((await one(db,'SELECT status FROM public.cube_work_items WHERE key=$1',[`delivery:task:${task}`])).status,'open')
  assert.equal((await one(db,'SELECT status FROM public.cube_work_items WHERE key=$1',[`leadership:operation:delivery:task:${task}`])).status,'open')
  await asUser(db,admin,()=>db.query("SELECT public.cube_configure('delivery',NULL,true)"))
  await run()
  assert.equal((await one(db,'SELECT status FROM public.cube_work_items WHERE key=$1',[`delivery:task:${task}`])).status,'resolved')
})
test('inactive admins cannot configure or run, and stale department owners get an active-admin fallback',async () => {
  const inactive = await addUser(db,{ email:'cube-inactive@example.test',role:'admin' })
  await db.query("UPDATE public.cube_departments SET owner_id=$1 WHERE code='finance'",[inactive.id])
  await db.query('UPDATE public.profiles SET deactivated_at=now() WHERE id=$1',[inactive.id])
  await assert.rejects(asUser(db,inactive,()=>db.query('SELECT public.cube_run()')),/active admin/)
  await run()
  assert.equal((await one(db,"SELECT owner_id FROM public.cube_departments WHERE code='finance'")).owner_id,admin.id)
})
test('delivery handoff waits for real acceptance and intake gates; it never starts delivery itself',async () => {
  await db.query('UPDATE public.projects SET assignee_id=$1 WHERE id=$2',[admin.id,project])
  const value={ currency:'USD',feeMinor:10000,depositMinor:0,scope:'Website delivery',acceptanceEvidence:'Signed agreement A1',acceptedOn:'2026-01-01',phase:'planning',milestones:[],invoices:[],payments:[] }
  await asUser(db,admin,()=>db.query('SELECT public.save_project_engagement($1,0,$2::jsonb)',[project,JSON.stringify(value)]))
  await run()
  assert.equal((await one(db,'SELECT count(*) AS count FROM public.cube_work_items WHERE key=$1',[`delivery:project:${project}`])).count,0)
  await save(1,{contractReference:'Agreement A1',briefConfirmed:true,assetsConfirmed:true,creativeRequired:true,creativeApproved:true,evidence:'Brief B1; approved design D1'})
  await run()
  assert.equal((await one(db,'SELECT status FROM public.cube_work_items WHERE key=$1',[`delivery:project:${project}`])).status,'open')
  assert.equal((await one(db,'SELECT status FROM public.cube_work_items WHERE key=$1',[`finance:project:${project}`])).status,'resolved')
  assert.equal((await one(db,'SELECT terms FROM public.project_engagements WHERE project_id=$1',[project])).terms.phase,'planning')
})
test('an unavailable source rolls back evaluation and preserves the queues with a visible failure',async () => {
  const before=await rows(db,'SELECT * FROM public.cube_work_items ORDER BY key')
  await db.exec('ALTER TABLE public.leads RENAME TO cube_test_missing_leads')
  try {
    await run()
    assert.match((await one(db,'SELECT last_error FROM public.cube_control')).last_error,/evaluation failed/)
    assert.deepEqual(await rows(db,'SELECT * FROM public.cube_work_items ORDER BY key'),before)
  } finally { await db.exec('ALTER TABLE public.cube_test_missing_leads RENAME TO leads') }
  await run()
  assert.equal((await one(db,'SELECT last_error FROM public.cube_control')).last_error,null)
})
test('overdue collection stays open after delivery is marked done',async () => {
  const saved=await one(db,'SELECT version,terms FROM public.project_engagements WHERE project_id=$1',[project])
  const value={...saved.terms,invoices:[{id:'invoice1',reference:'INV-CUBE-1',amountMinor:1000,dueDate:'2026-01-01'}]}
  await asUser(db,admin,()=>db.query('SELECT public.save_project_engagement($1,$2,$3::jsonb)',[project,saved.version,JSON.stringify(value)]))
  await db.query("UPDATE public.projects SET status='done' WHERE id=$1",[project])
  await run()
  assert.equal((await one(db,'SELECT last_error FROM public.cube_control')).last_error,null)
  const work=await one(db,'SELECT status,instruction FROM public.cube_work_items WHERE key=$1',[`finance:project:${project}`])
  assert.equal(work.status,'open')
  assert.match(work.instruction,/overdue invoice/)
})
test('reapplying account hardening preserves Cube table and sequence grants',async () => {
  const grants=()=>rows(db,"SELECT relname,coalesce(relacl::text,'') AS grants FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'cube_%' ORDER BY relname")
  const before=await grants()
  await applyMigration(db,'043_active_accounts_only.sql')
  assert.deepEqual(await grants(),before)
})
