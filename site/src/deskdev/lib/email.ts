import type { Email } from './types'

// Pure email rules (049) shared by the store and the composer. DeskDev never
// sends mail itself: the store queues a row and n8n sends it through the
// studio's Gmail; replies come back through n8n's inbox check.

export const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>.]+$/
export const MAX_RECIPIENTS = 10
export const MAX_SUBJECT = 300
export const MAX_BODY = 50_000

/** "a@x.com, B@Y.com; c@z.com" → ['a@x.com', 'b@y.com', 'c@z.com'] (trimmed, lower-cased, de-duplicated). */
export function parseAddresses(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[,;\s]+/)
  return [...new Set(parts.map((a) => a.trim().toLowerCase()).filter(Boolean))]
}

/** The first problem with a draft, or null when it can be queued. */
export function draftError(draft: { to: string[]; cc: string[]; subject: string; body: string }): string | null {
  if (draft.to.length === 0) return 'Add at least one recipient.'
  if (draft.to.length > MAX_RECIPIENTS || draft.cc.length > MAX_RECIPIENTS) return `At most ${MAX_RECIPIENTS} addresses in To and in Cc.`
  const bad = [...draft.to, ...draft.cc].find((a) => a.length > 254 || !EMAIL_RE.test(a))
  if (bad) return `“${bad}” isn’t a valid email address.`
  const subject = draft.subject.trim()
  if (!subject) return 'Add a subject.'
  if (subject.length > MAX_SUBJECT) return `Keep the subject under ${MAX_SUBJECT} characters.`
  if (!draft.body.trim()) return 'Write a message.'
  if (draft.body.length > MAX_BODY) return 'The message is too long.'
  return null
}

/** "Re: …" once, however many replies deep. */
export function replySubject(subject: string): string {
  const s = subject.trim()
  return /^re:/i.test(s) ? s : `Re: ${s}`
}

/** The first line or two, for a collapsed message. */
export function snippet(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** When it happened: sent / received time, else when it was queued. */
export function emailTime(e: Pick<Email, 'sentAt' | 'receivedAt' | 'createdAt'>): string {
  return e.receivedAt ?? e.sentAt ?? e.createdAt
}

export interface EmailThread {
  /** gmail_thread_id, else the root email's id. */
  key: string
  subject: string
  /** Oldest first. */
  messages: Email[]
  last: Email
}

/**
 * Conversations, newest activity first. Messages group by Gmail thread; a
 * message n8n hasn't sent yet (no thread id) joins the thread of the email it
 * answers, else starts its own.
 */
export function threadsOf(emails: Email[]): EmailThread[] {
  const byId = new Map(emails.map((e) => [e.id, e]))
  const keyOf = (e: Email, depth = 0): string => {
    if (e.gmailThreadId) return e.gmailThreadId
    const parent = e.inReplyTo ? byId.get(e.inReplyTo) : undefined
    return parent && depth < 20 ? keyOf(parent, depth + 1) : e.id
  }
  const groups = new Map<string, Email[]>()
  for (const e of emails) {
    const key = keyOf(e)
    const list = groups.get(key)
    if (list) list.push(e)
    else groups.set(key, [e])
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const messages = list.sort((a, b) => emailTime(a).localeCompare(emailTime(b)))
      return { key, subject: messages[0].subject, messages, last: messages[messages.length - 1] }
    })
    .sort((a, b) => emailTime(b.last).localeCompare(emailTime(a.last)))
}
