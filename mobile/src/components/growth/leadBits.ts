import { useEffect, useState } from 'react'

import type { Accent } from '@/lib/theme'
import type { LeadAction, LeadLostReason, LeadSource, LeadStage } from '@/lib/types'
import type { SlaState } from '@/lib/leads'

// Labels and colours for the Growth screens — the mobile counterpart of the
// web's components/growth/shared.tsx and LeadDrawer's ACTION_LABEL.

export const STAGES: LeadStage[] = ['new', 'contacted', 'proposal', 'won', 'lost']

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New', contacted: 'Contacted', proposal: 'Proposal', won: 'Won', lost: 'Lost',
}

export const STAGE_ACCENT: Record<LeadStage, Accent> = {
  new: 'sky', contacted: 'amber', proposal: 'brand', won: 'emerald', lost: 'rose',
}

export const SOURCE_LABEL: Record<LeadSource, string> = {
  seo: 'SEO', referral: 'Referral', linkedin: 'LinkedIn', outbound: 'Outbound', website: 'Website', other: 'Other',
}

export const LOST_REASONS: LeadLostReason[] = ['no_decision', 'competitor', 'price', 'timing', 'unresponsive', 'other']

export const LOST_REASON_LABEL: Record<LeadLostReason, string> = {
  no_decision: 'No decision', competitor: 'Competitor', price: 'Price',
  timing: 'Timing', unresponsive: 'Went quiet', other: 'Other',
}

export const ACTION_LABEL: Record<LeadAction, string> = {
  created: 'Created',
  stage_changed: 'Stage changed',
  contacted: 'Touch logged',
  note: 'Note',
  won: 'Won',
  lost: 'Lost',
  submitted: 'Sent a brief from the website',
  resubmitted: 'Wrote again from the website',
  assigned: 'Owner set',
  sla_breached: 'Reply deadline missed',
  spam_marked: 'Quarantined',
  not_spam: 'Released from quarantine',
  proposal_sent: 'Proposal sent',
  auto_reply_sent: 'Auto-reply sent',
  email_received: 'Email received',
  email_sent: 'Email sent',
  meeting_booked: 'Meeting booked',
  converted: 'Converted to a client',
  followup_set: 'Follow-up set',
  booking_link_sent: 'Booking link sent',
  call_logged: 'Call logged',
  form_submitted: 'Sent back a form',
}

/** The reply clock as a short line and an accent; null when there's nothing to say. */
export function slaLine(state: SlaState): { text: string; accent: Accent } | null {
  switch (state) {
    case 'breached':
      return { text: 'Reply overdue', accent: 'rose' }
    case 'due_soon':
      return { text: 'Reply due soon', accent: 'amber' }
    case 'ok':
      return { text: 'Awaiting reply', accent: 'sky' }
    default:
      return null
  }
}

/**
 * Wall-clock time, re-read every `stepMs` — the reply clock and "days cold"
 * need a now that moves on an open screen.
 */
export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs)
    return () => clearInterval(id)
  }, [stepMs])
  return now
}
