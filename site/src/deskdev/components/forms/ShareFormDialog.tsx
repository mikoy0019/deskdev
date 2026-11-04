import { useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CircleNotchIcon, CopySimpleIcon, EnvelopeSimpleIcon, LinkIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import EmailComposer from '../email/EmailComposer'
import { Field } from '../tasks/formBits'
import { useStore } from '../../store/useStore'
import { fmtDate } from '../../lib/format'
import { FORM_TEMPLATES, type Answers } from '../../lib/forms'
import { FORM_LINK_DAYS, quickFormEmail, quickFormMailto, quickFormState } from '../../lib/quickForm'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * "Send to customer": a private link to the form on nixgensolutions.com. The
 * customer sees only the questions meant for them (internal fields never leave
 * the server), pre-filled with what we know. The link is shown once: lose it
 * and create a new one, which closes the old.
 */
export default function ShareFormDialog({
  form, projectId, leadId, defaultTo, name, answers, onClose,
}: {
  form: string
  projectId?: string
  leadId?: string
  defaultTo?: string
  /** The customer's name, for the email greeting. */
  name?: string
  /** Starting answers when no response exists yet (the prefill). */
  answers?: Answers
  onClose: () => void
}) {
  const template = FORM_TEMPLATES[form]
  const createFormLink = useStore((s) => s.createFormLink)
  const revokeFormLink = useStore((s) => s.revokeFormLink)
  const me = useStore((s) => s.users.find((u) => u.id === s.currentUserId))
  const response = useStore((s) =>
    s.formResponses.find((r) => r.form === form && (projectId ? r.projectId === projectId : r.leadId === leadId && !r.projectId)),
  )
  const [to, setTo] = useState(defaultTo ?? '')
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [composing, setComposing] = useState(false)
  const state = quickFormState(response)
  const toError = to.trim() && !EMAIL.test(to.trim()) ? 'Enter a full email address' : null
  const title = template?.customer?.title ?? template?.title ?? 'Form'

  const create = async () => {
    if (busy || toError) return
    setBusy(true)
    const result = await createFormLink({ form, projectId, leadId, sharedTo: to, answers })
    setBusy(false)
    if (!result.ok || !result.url) {
      toast.error(result.error ?? 'Could not create the link')
      return
    }
    setUrl(result.url)
  }

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied')
    } catch {
      toast.error('Your browser blocked the clipboard — select the link and copy it')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Send “${title}”`}
      footer={
        url ? (
          <button type="button" className="btn-primary" onClick={onClose}>Done</button>
        ) : (
          <>
            {state === 'open' && response && (
              <button
                type="button"
                className="btn-ghost mr-auto"
                onClick={() => {
                  if (revokeFormLink(response.id)) toast.success('Link closed')
                }}
              >
                Close the current link
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy || Boolean(toError)} onClick={() => void create()}>
              {busy ? <CircleNotchIcon size={14} className="animate-spin" aria-hidden /> : <LinkIcon size={14} aria-hidden />}
              {state === 'open' ? 'Create a new link' : 'Create link'}
            </button>
          </>
        )
      }
    >
      {url ? (
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink-200">
            Send this to {to.trim() || 'the customer'}. It opens the form on nixgensolutions.com, works for{' '}
            {FORM_LINK_DAYS} days, and closes once they send their answers. It&apos;s shown only now: if you lose it, create a
            new one.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              className="input min-w-0 flex-1 font-mono text-xs"
              value={url}
              aria-label="Form link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn-secondary shrink-0" onClick={() => void copy()}>
              {copied ? <CheckIcon size={14} aria-hidden /> : <CopySimpleIcon size={14} aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" className="btn-primary w-full justify-center" onClick={() => setComposing(true)}>
            <PaperPlaneRightIcon size={14} aria-hidden /> Send from DeskDev
          </button>
          <a
            className="btn-ghost w-full justify-center"
            href={quickFormMailto({ to: to.trim() || undefined, name, formTitle: title, url, from: me?.fullName })}
          >
            <EnvelopeSimpleIcon size={14} aria-hidden /> Or open it in your email app
          </a>
          {composing && (
            <EmailComposer
              leadId={projectId ? undefined : leadId}
              projectId={projectId}
              person={{ name, email: to.trim() || undefined }}
              defaults={{ to: to.trim() ? [to.trim()] : [], ...quickFormEmail({ name, formTitle: title, url, from: me?.fullName }) }}
              title="Send the form"
              onClose={() => setComposing(false)}
            />
          )}
          <p className="text-[11px] text-ink-400">
            When they send it back you get a notification, and their answers wait in the form for you to review and complete.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink-200">
            They see only the questions meant for them, never your internal notes, with what we already know filled in.
          </p>
          {state === 'open' && response && (
            <p className="rounded-lg border border-ink-600 px-3 py-2 text-[13px] text-ink-200" role="status">
              A link went to {response.sharedTo ?? 'the customer'} on {fmtDate(response.sharedAt)} and is open until{' '}
              {fmtDate(response.shareExpiresAt)}. A new link closes that one.
            </p>
          )}
          <Field label="Send to (optional)" error={toError}>
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              className="input w-full"
              placeholder="customer@company.com"
              value={to}
              aria-invalid={Boolean(toError) || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}
