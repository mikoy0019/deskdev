import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { freshDatabase, addUser, asUser, asAnon, one } from './harness.mjs'

let db, admin, member, project, lead
const terms = () => ({ currency: 'USD', feeMinor: 100000, depositMinor: 25000, scope: 'Five pages',
  acceptanceEvidence: 'Signed agreement A-1', acceptedOn: '2026-01-01', phase: 'planning',
  milestones: [{ id: 'm1', title: 'Launch', dueDate: '2026-01-10', status: 'planned', approvalEvidence: '' }],
  invoices: [{ id: 'i1', reference: 'INV-1', amountMinor: 50000, dueDate: '2026-01-05' }], payments: [],
})
const save = (version, value) => asUser(db, admin, () => one(db,
  'SELECT * FROM public.save_project_engagement($1,$2,$3::jsonb)', [project, version, JSON.stringify(value)]))

before(async () => {
  db = await freshDatabase()
  admin = await addUser(db, { email: 'engagement-admin@example.test', role: 'admin' })
  await addUser(db, { email: 'engagement-backup-admin@example.test', role: 'admin' })
  member = await addUser(db, { email: 'engagement-member@example.test', permissions: { projects: 'edit' } })
  const client = await one(db, "INSERT INTO public.clients(name) VALUES('Engagement client') RETURNING id")
  project = (await one(db, "INSERT INTO public.projects(client_id,title) VALUES($1,'Engagement project') RETURNING id", [client.id])).id
  lead = (await one(db, "INSERT INTO public.leads(name,client_id,stage,form) VALUES('Source lead',$1,'won','import') RETURNING id", [client.id])).id
  await db.query("INSERT INTO public.lead_activity(lead_id,actor_id,action,detail) VALUES($1,$2,'converted',$3::jsonb)", [lead, admin.id, JSON.stringify({ project_id: project })])
})
after(async () => { await db?.close() })

test('only active admins can read and save; direct writes and anon calls are denied', async () => {
  await assert.rejects(asAnon(db, () => db.query('SELECT public.save_project_engagement($1,0,$2::jsonb)', [project, JSON.stringify(terms())])), /permission denied/)
  await assert.rejects(asUser(db, member, () => db.query('SELECT public.save_project_engagement($1,0,$2::jsonb)', [project, JSON.stringify(terms())])), /active admin/)
  await assert.rejects(asUser(db, admin, () => db.query('INSERT INTO public.project_engagements(project_id,terms) VALUES($1,$2::jsonb)', [project, JSON.stringify(terms())])), /permission denied/)
  const created = await save(0, terms())
  assert.equal(created.version, 1)
  assert.equal(created.lead_id, lead)
  assert.equal((await asUser(db, member, () => db.query('SELECT * FROM public.project_engagements'))).rows.length, 0)
})

test('stale saves are rejected and saved acceptance is immutable', async () => {
  await assert.rejects(save(0, terms()), /changed/)
  await assert.rejects(save(1, { ...terms(), scope: 'Unagreed scope' }), /locked/)
  const row = await one(db, 'SELECT * FROM public.project_engagements WHERE project_id=$1', [project])
  assert.equal(row.version, 1)
})

test('kickoff, receipts and completion are checked by the database', async () => {
  await assert.rejects(save(1, { ...terms(), phase: 'active' }), /deposit/)
  const paid = { ...terms(), phase: 'active', payments: [{ id: 'p1', invoiceId: 'i1', reference: 'TX-1', amountMinor: 25000, receivedOn: '2026-01-01' }] }
  assert.equal((await save(1, paid)).version, 2)
  await assert.rejects(save(2, { ...paid, payments: [] }), /cannot be changed/)
  await assert.rejects(save(2, { ...paid, payments: [...paid.payments, { ...paid.payments[0], id: 'p2', reference: 'TX-2', amountMinor: 25001 }] }), /exceed/)
  await assert.rejects(save(2, { ...paid, phase: 'completed' }), /Approve/)
  const completed = { ...paid, phase: 'completed', milestones: [{ ...paid.milestones[0], status: 'approved', approvalEvidence: 'Client email E-1' }] }
  assert.equal((await save(2, completed)).version, 3)
  const collectedLater = { ...completed, payments: [...completed.payments, { ...completed.payments[0], id: 'p2', reference: 'TX-2', amountMinor: 25000 }] }
  assert.equal((await save(3, collectedLater)).version, 4)
  const audit = await one(db, "SELECT count(*)::int AS n FROM public.audit_log WHERE entity='project_engagement'")
  assert.equal(audit.n, 4)
  await assert.rejects(db.query('DELETE FROM public.projects WHERE id=$1', [project]), /foreign key/)
})

test('a deactivated admin cannot read or save with an existing token', async () => {
  await db.query('UPDATE public.profiles SET deactivated_at=now() WHERE id=$1', [admin.id])
  assert.equal((await asUser(db, admin, () => db.query('SELECT * FROM public.project_engagements'))).rows.length, 0)
  await assert.rejects(save(4, terms()), /active admin/)
})
