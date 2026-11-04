import { useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopySimpleIcon, EnvelopeSimpleIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import EmailComposer from '../email/EmailComposer'
import { useStore } from '../../store/useStore'
import { bookingEmail, bookingMailto, bookingPageUrl } from '../../lib/booking'
import type { Lead } from '../../lib/types'

/**
 * "Send booking link": the website's booking page with this lead's name and
 * email filled in, so the call they book lands on this lead. Copying or
 * emailing it logs the touch (booking_link_sent), which stops the reply clock.
 */
export default function BookingLinkDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const logLeadTouch = useStore((s) => s.logLeadTouch)
  const title = useStore((s) => s.workspaceSettings.bookingTitle)
  const enabled = useStore((s) => s.workspaceSettings.bookingEnabled)
  const me = useStore((s) => s.users.find((u) => u.id === s.currentUserId))
  const [copied, setCopied] = useState(false)
  const [logged, setLogged] = useState(false)
  const [composing, setComposing] = useState(false)
  const url = bookingPageUrl({ name: lead.name, email: lead.email })

  const log = () => {
    if (logged) return
    if (logLeadTouch(lead.id, 'booking_link_sent', { url: bookingPageUrl() })) setLogged(true)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      log()
      toast.success('Link copied · touch logged')
    } catch {
      toast.error('Your browser blocked the clipboard — select the link and copy it')
    }
  }

  return (
    <Modal open onClose={onClose} title="Send booking link" footer={<button type="button" className="btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-4">
        {!enabled && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-[13px] text-ink-100" role="status">
            Online booking is off, so the page will say it isn’t open. Turn it on in Settings → Growth → Booking page.
          </p>
        )}
        <p className="text-[13px] leading-relaxed text-ink-200">
          {lead.name || 'They'} pick{lead.name ? 's' : ''} a free time for a {title.toLowerCase()}; the call lands on this lead
          with a Meet link and a calendar invite.
        </p>
        <div className="flex gap-2">
          <input readOnly className="input min-w-0 flex-1 font-mono text-xs" value={url} aria-label="Booking link" onFocus={(e) => e.currentTarget.select()} />
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
          href={bookingMailto({ to: lead.email, name: lead.name, url, title, from: me?.fullName })}
          onClick={log}
        >
          <EnvelopeSimpleIcon size={14} aria-hidden /> Or open it in your email app
        </a>
        {composing && (
          <EmailComposer
            leadId={lead.id}
            person={{ name: lead.name, email: lead.email }}
            defaults={{ to: lead.email ? [lead.email] : [], ...bookingEmail({ name: lead.name, url, title, from: me?.fullName }) }}
            title="Send the booking link"
            onSent={log}
            onClose={() => setComposing(false)}
          />
        )}
      </div>
    </Modal>
  )
}
