import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarPlusIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { Field } from '../tasks/formBits'
import { useStore } from '../../store/useStore'
import { isSupabaseConfigured } from '../../lib/supabase'
import { bookingPageUrl } from '../../lib/booking'
import { draftError, parseAddresses } from '../../lib/email'

export interface ComposeDefaults {
  to?: string[]
  cc?: string[]
  subject?: string
  body?: string
  inReplyTo?: string
}

/**
 * Write an email about a lead, client or project. Send queues it; n8n sends
 * it from the studio's Gmail with the signature added (Settings → Integrations
 * → Email), and the thread on the profile shows it go from Sending to Sent.
 */
export default function EmailComposer({
  leadId, clientId, projectId, person, defaults, title = 'New email', onSent, onClose,
}: {
  leadId?: string
  clientId?: string
  projectId?: string
  /** Who it's to, for the booking-link insert. */
  person?: { name?: string; email?: string }
  defaults?: ComposeDefaults
  title?: string
  onSent?: (id: string) => void
  onClose: () => void
}) {
  const sendEmail = useStore((s) => s.sendEmail)
  const fromName = useStore((s) => s.workspaceSettings.emailFromName)
  const fromAddress = useStore((s) => s.workspaceSettings.emailFromAddress)
  const hasSignature = useStore((s) => Boolean(s.workspaceSettings.emailSignature?.trim()))
  const [to, setTo] = useState((defaults?.to ?? []).join(', '))
  const [cc, setCc] = useState((defaults?.cc ?? []).join(', '))
  const [showCc, setShowCc] = useState(Boolean(defaults?.cc?.length))
  const [subject, setSubject] = useState(defaults?.subject ?? '')
  const [body, setBody] = useState(defaults?.body ?? '')
  const [tried, setTried] = useState(false)

  const draft = { to: parseAddresses(to), cc: parseAddresses(cc), subject, body }
  const problem = draftError(draft)

  const send = () => {
    setTried(true)
    if (problem) return
    const result = sendEmail({ ...draft, leadId, clientId, projectId, inReplyTo: defaults?.inReplyTo })
    if (!result.ok || !result.id) {
      toast.error(result.error ?? 'Could not queue the email')
      return
    }
    toast.success(isSupabaseConfigured ? 'Sending…' : 'Queued — sending needs the live workspace')
    onSent?.(result.id)
    onClose()
  }

  const insertBookingLink = () => {
    const url = bookingPageUrl({ name: person?.name, email: person?.email })
    setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n\n' : ''}Pick a time for a call here: ${url}\n`)
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={title}
      footer={
        <>
          <span className="mr-auto min-w-0 truncate text-[11px] text-ink-400">
            From {fromName}{fromAddress ? ` <${fromAddress}>` : ''}{hasSignature ? ' · signature added' : ''}
          </span>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={send}>
            <PaperPlaneRightIcon size={14} aria-hidden /> Send
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="To" hint={<p className="text-[11px] text-ink-400">Separate addresses with commas.</p>}>
          <input
            type="email"
            multiple
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            className="input w-full"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        {showCc ? (
          <Field label="Cc">
            <input type="email" multiple inputMode="email" autoCapitalize="none" spellCheck={false} className="input w-full" value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
        ) : (
          <button type="button" className="-mt-2 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline" onClick={() => setShowCc(true)}>
            Add Cc
          </button>
        )}
        <Field label="Subject">
          <input className="input w-full" maxLength={300} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message">
          <textarea className="input w-full min-h-[220px] resize-y leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost px-2! py-1! text-xs" onClick={insertBookingLink}>
            <CalendarPlusIcon size={13} aria-hidden /> Insert booking link
          </button>
        </div>
        {tried && problem && (
          <p role="alert" className="text-xs font-medium text-rose-700 dark:text-rose-400">{problem}</p>
        )}
      </div>
    </Modal>
  )
}
