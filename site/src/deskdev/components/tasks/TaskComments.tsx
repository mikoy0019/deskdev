import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useCurrentUser, useStore } from '../../store/useStore'
import { can, isDeactivated } from '../../lib/permissions'
import { fmtRelative } from '../../lib/format'
import MessageBody from '../channels/MessageBody'

export default function TaskComments({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const user = useCurrentUser()
  const users = useStore((s) => s.users)
  const activity = useStore((s) => s.taskActivity)
  const addComment = useStore((s) => s.addTaskComment)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const comments = activity.filter((a) => a.taskId === taskId && typeof a.detail?.comment === 'string').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return <section className="space-y-3" aria-label="Task comments">
    <h3 className="section-title">Comments</h3>
    {comments.length === 0 && <p className="text-sm text-ink-300">Share context or mention a teammate.</p>}
    {comments.map((comment) => <article key={comment.id} className="border-b border-ink-600 pb-3">
      <p className="mb-1 text-xs text-ink-300">{users.find((u) => u.id === comment.actorId)?.fullName ?? 'Former member'} · {fmtRelative(comment.createdAt)}</p>
      <div className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]"><MessageBody body={String(comment.detail.comment)} users={users} meId={user?.id} /></div>
    </article>)}
    {canEdit && <div className="space-y-2">
      <label className="block text-xs text-ink-200">Add a comment
        <textarea ref={input} className="input mt-1 min-h-24 w-full" value={body} maxLength={10000} readOnly={sending} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment. Use @ to mention a teammate." />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-300">Mention <select aria-label="Mention teammate" className="input" value="" disabled={sending} onChange={(e) => {
          if (!e.target.value) return
          const start = input.current?.selectionStart ?? body.length
          const end = input.current?.selectionEnd ?? start
          const token = `<@${e.target.value}> `
          setBody(body.slice(0, start) + token + body.slice(end))
          requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + token.length, start + token.length) })
        }}><option value="">Choose teammate</option>{users.filter((u) => !isDeactivated(u) && can(u, 'tasks', 'view')).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></label>
        <button type="button" className="btn-primary ml-auto" disabled={sending || !body.trim()} onClick={async () => {
          if (sending) return
          setSending(true)
          try {
            if (await addComment(taskId, body)) setBody('')
            else toast.error('Comment could not be saved. Your draft is still here.')
          } finally { setSending(false); requestAnimationFrame(() => input.current?.focus()) }
        }}>{sending ? 'Posting…' : 'Post comment'}</button>
      </div>
    </div>}
  </section>
}
