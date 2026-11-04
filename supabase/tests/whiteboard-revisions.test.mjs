import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { freshDatabase, addUser, asUser, one, applyMigration } from './harness.mjs'

let db, editor, viewer, stranger, client, task
before(async () => {
  db = await freshDatabase()
  editor = await addUser(db, { email: 'board-editor@example.test', permissions: { tasks: 'edit', growth: 'edit' } })
  viewer = await addUser(db, { email: 'board-viewer@example.test', permissions: { tasks: 'view', growth: 'view' } })
  stranger = await addUser(db, { email: 'board-stranger@example.test' })
  client = (await one(db, "INSERT INTO public.clients(name) VALUES('Board client') RETURNING id")).id
  task = (await one(db, "INSERT INTO public.tasks(client_id,title) VALUES($1,'Review board') RETURNING id", [client])).id
})
after(async () => { await db?.close() })

test('061: comment mentions notify only active task readers, once per person', async () => {
  await asUser(db, editor, () => db.query(`INSERT INTO public.task_activity(task_id,client_id,actor_id,action,detail)
    VALUES($1,$2,$3,'updated',$4::jsonb)`, [task, client, editor.id, JSON.stringify({ comment: `Hi <@${viewer.id}> <@${viewer.id}> <@${stranger.id}> <@${editor.id}>` })]))
  const rows = (await db.query("SELECT user_id,actor_id,type,entity_id FROM public.notifications WHERE entity_id=$1", [task])).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user_id, viewer.id)
  assert.equal(rows[0].actor_id, editor.id)
  assert.equal(rows[0].type, 'task_updated')
})

test('061: comments reject spoofed actors, mismatched clients, empty bodies and viewers', async () => {
  const another = (await one(db, "INSERT INTO public.clients(name) VALUES('Other board client') RETURNING id")).id
  for (const [who, actor, cid, comment] of [[editor, viewer.id, client, 'spoof'], [editor, editor.id, another, 'wrong client'], [editor, editor.id, client, ' '], [viewer, viewer.id, client, 'read only']]) {
    await assert.rejects(asUser(db, who, () => db.query(`INSERT INTO public.task_activity(task_id,client_id,actor_id,action,detail) VALUES($1,$2,$3,'updated',$4::jsonb)`, [task, cid, actor, JSON.stringify({ comment })])), /invalid task comment|row-level security/)
  }
})

test('061: replies cannot cross conversations, and deleting a parent keeps its replies', async () => {
  const first = (await one(db, 'INSERT INTO public.conversations(participant_ids) VALUES($1::uuid[]) RETURNING id', [`{${editor.id},${viewer.id}}`])).id
  const second = (await one(db, 'INSERT INTO public.conversations(participant_ids) VALUES($1::uuid[]) RETURNING id', [`{${editor.id},${stranger.id}}`])).id
  const original = await asUser(db, editor, () => one(db, "INSERT INTO public.messages(conversation_id,sender_id,body) VALUES($1,$2,'Hello') RETURNING id", [first, editor.id]))
  await assert.rejects(asUser(db, editor, () => db.query("INSERT INTO public.messages(conversation_id,sender_id,body,reply_to_id) VALUES($1,$2,'Cross thread',$3)", [second, editor.id, original.id])), /messages_reply_same_conversation/)
  const reply = await asUser(db, viewer, () => one(db, "INSERT INTO public.messages(conversation_id,sender_id,body,reply_to_id) VALUES($1,$2,'Reply',$3) RETURNING id", [first, viewer.id, original.id]))
  await asUser(db, editor, () => db.query('DELETE FROM public.messages WHERE id=$1', [original.id]))
  assert.equal((await one(db, 'SELECT reply_to_id FROM public.messages WHERE id=$1', [reply.id])).reply_to_id, null)
})

test('061: ordinary channel posts notify eligible readers, without mentioning them', async () => {
  const channel = (await one(db, "INSERT INTO public.channels(name,is_private,member_ids) VALUES('board-private',true,$1::uuid[]) RETURNING id", [`{${editor.id},${viewer.id}}`])).id
  await asUser(db, editor, () => db.query("INSERT INTO public.channel_messages(channel_id,sender_id,body) VALUES($1,$2,'Plain channel post')", [channel, editor.id]))
  const rows = (await db.query("SELECT user_id,actor_id,title FROM public.notifications WHERE entity_id=$1 AND type='channel_mention'", [channel])).rows
  assert.deepEqual(rows.map((row) => row.user_id), [viewer.id])
  assert.equal(rows[0].actor_id, editor.id)
  assert.match(rows[0].title, /posted in #board-private/)
})

test('061: task covers require HTTPS; OLJ imports require Growth edit and valid posting URLs', async () => {
  await asUser(db, editor, () => db.query("UPDATE public.tasks SET cover_url='https://example.test/cover.png' WHERE id=$1", [task]))
  await assert.rejects(db.query("UPDATE public.tasks SET cover_url='javascript:alert(1)' WHERE id=$1", [task]), /tasks_cover_url_check/)
  const url = 'https://www.onlinejobs.ph/jobseekers/job/Developer-12345'
  await asUser(db, editor, () => db.query("INSERT INTO public.job_postings(source,url,title,tag,application) VALUES('onlinejobs.ph',$1,'Developer','gig',$2::jsonb)", [url, JSON.stringify({ cv: 'Real work experience', status: 'reviewing' })]))
  await assert.rejects(asUser(db, viewer, () => db.query("INSERT INTO public.job_postings(source,url,title) VALUES('onlinejobs.ph',$1,'Nope')", [url + '2'])), /row-level security/)
  await assert.rejects(asUser(db, editor, () => db.query("INSERT INTO public.job_postings(source,url,title) VALUES('onlinejobs.ph','https://evil.test/job','Nope')")), /row-level security/)
  assert.equal((await asUser(db, viewer, () => one(db, 'SELECT application FROM public.job_postings WHERE url=$1', [url]))).application.cv, 'Real work experience')
})

test('061: migration is repeatable and preserves application drafts', async () => {
  await applyMigration(db, '061_whiteboard_revisions.sql')
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM public.job_postings WHERE application->>'status'='reviewing'")).n, 1)
})
