import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowBendUpLeftIcon, ArrowDownLeftIcon, ArrowUpRightIcon, CircleNotchIcon, EnvelopeSimpleIcon, PencilSimpleLineIcon, WarningCircleIcon,
} from '@phosphor-icons/react'
import EmailComposer, { type ComposeDefaults } from './EmailComposer'
import { useStore } from '../../store/useStore'
import { classNames, fmtDateTime, fmtRelative } from '../../lib/format'
import { emailTime, replySubject, snippet, threadsOf } from '../../lib/email'
import type { Email } from '../../lib/types'

const STATUS: Record<Email['status'], { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'badge-neutral' },
  sending: { label: 'Sending…', tone: 'badge-info' },
  sent: { label: 'Sent', tone: 'badge-success' },
  failed: { label: 'Failed', tone: 'badge-danger' },
  received: { label: 'Received', tone: 'badge-brand' },
}

function Message({ email, onRetry }: { email: Email; onRetry: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const users = useStore((s) => s.users)
  const inbound = email.direction === 'in'
  const sender = inbound
    ? email.fromName || email.fromEmail || 'Them'
    : users.find((u) => u.id === email.createdBy)?.fullName ?? email.fromName ?? 'Us'
  const status = STATUS[email.status]
  return (
    <li className="rounded-md border border-ink-600 px-3 py-2">
      <button type="button" className="flex w-full items-start gap-2 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {inbound ? (
          <ArrowDownLeftIcon size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" aria-label="Received" />
        ) : (
          <ArrowUpRightIcon size={14} className="mt-0.5 shrink-0 text-ink-400" aria-label="Sent" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[13px] font-medium text-ink-50">{sender}</span>
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-ink-400" title={fmtDateTime(emailTime(email))}>
              {fmtRelative(emailTime(email))}
            </span>
          </span>
          {!open && <span className="mt-0.5 block truncate text-[12px] text-ink-300">{snippet(email.bodyText)}</span>}
        </span>
        {!inbound && email.status !== 'sent' && (
          <span className={classNames('badge shrink-0 text-[10px]', status.tone)}>
            {email.status === 'sending' && <CircleNotchIcon size={10} className="animate-spin" aria-hidden />}
            {status.label}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-6">
          <p className="text-[11px] text-ink-400 [overflow-wrap:anywhere]">
            {inbound ? `From ${email.fromEmail ?? ''}` : `To ${email.toEmails.join(', ')}`}
            {email.ccEmails.length > 0 ? ` · Cc ${email.ccEmails.join(', ')}` : ''}
            {' · '}{fmtDateTime(emailTime(email))}
          </p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-100 [overflow-wrap:anywhere]">{email.bodyText}</p>
        </div>
      )}
      {email.status === 'failed' && (
        <div className="mt-2 flex items-center gap-2 pl-6 text-[12px] text-rose-700 dark:text-rose-400">
          <WarningCircleIcon size={13} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{email.error ?? 'Gmail refused it'}</span>
          <button type="button" className="btn-ghost px-2! py-0.5! text-xs" onClick={() => onRetry(email.id)}>Send again</button>
        </div>
      )}
    </li>
  )
}

/**
 * The email conversations on a lead, client or project (049): newest thread
 * first, each message collapsible, Reply on the latest one. Status follows
 * n8n's send over realtime; replies arrive from the inbox check.
 */
export default function EmailThreads({
  emails, leadId, clientId, projectId, person, canSend,
}: {
  emails: Email[]
  leadId?: string
  clientId?: string
  projectId?: string
  /** The person these threads are with: the default recipient. */
  person?: { name?: string; email?: string }
  canSend: boolean
}) {
  const retryEmail = useStore((s) => s.retryEmail)
  const threads = useMemo(() => threadsOf(emails), [emails])
  const [compose, setCompose] = useState<ComposeDefaults | null>(null)
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? threads : threads.slice(0, 3)

  const retry = async (id: string) => {
    const res = await retryEmail(id)
    if (res.ok) toast.success('Sending again…')
    else toast.error(res.error ?? 'Could not send it again')
  }

  const reply = (thread: (typeof threads)[number]) => {
    const last = thread.last
    const lastIn = [...thread.messages].reverse().find((m) => m.direction === 'in')
    const to = lastIn?.fromEmail ? [lastIn.fromEmail] : last.toEmails
    setCompose({ to, subject: replySubject(thread.subject), inReplyTo: (lastIn ?? last).id })
  }

  return (
    <div className="space-y-2">
      {threads.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-300">
          <EnvelopeSimpleIcon size={15} aria-hidden /> No emails yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((t) => (
            <li key={t.key} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-100">{t.subject}</span>
                {canSend && (
                  <button type="button" className="btn-ghost px-2! py-0.5! pointer-coarse:py-2! text-xs" onClick={() => reply(t)}>
                    <ArrowBendUpLeftIcon size={13} aria-hidden /> Reply
                  </button>
                )}
              </div>
              <ol className="space-y-1.5">
                {t.messages.map((m) => <Message key={m.id} email={m} onRetry={(id) => void retry(id)} />)}
              </ol>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        {canSend && (
          <button
            type="button"
            className="btn-secondary px-2.5! py-1! pointer-coarse:py-2! text-xs"
            onClick={() => setCompose({ to: person?.email ? [person.email] : [] })}
          >
            <PencilSimpleLineIcon size={13} aria-hidden /> Write email
          </button>
        )}
        {threads.length > 3 && (
          <button type="button" className="btn-ghost px-2! py-1! text-xs" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `All ${threads.length} conversations`}
          </button>
        )}
      </div>
      {compose && (
        <EmailComposer
          leadId={leadId}
          clientId={clientId}
          projectId={projectId}
          person={person}
          defaults={compose}
          title={compose.inReplyTo ? 'Reply' : 'New email'}
          onClose={() => setCompose(null)}
        />
      )}
    </div>
  )
}
