// ─── Auth & permissions ─────────────────────────────────────────────────────

export type Role = 'admin' | 'member'

export type PermFeature =
  | 'projects'
  | 'tasks'
  | 'clients'
  | 'crm'
  | 'calendar'
  | 'meetings'
  | 'growth'
  | 'courses'
  /** The public project library on /portfolio (037). Drafting needs edit; publishing is admin-only. */
  | 'showcase'

export type PermLevel = 'none' | 'view' | 'edit'

/** App user — mirrors the `profiles` table. `password` exists only in local mode. */
export interface User {
  id: string
  email?: string
  fullName: string
  phone?: string
  title?: string
  avatarColor?: string
  /**
   * Profile picture (052): a key in the 'avatars' bucket (profiles/<id>/…),
   * or a data URL in local mode. Admins set it; everyone sees it in place of
   * the initials.
   */
  avatarKey?: string
  role: Role
  permissions: Partial<Record<PermFeature, PermLevel>>
  /** Local (non-Supabase) mode only — never synced to the profiles table */
  password?: string
  /**
   * Set when an admin offboards the account (032). Login is blocked and the
   * row stays so history keeps its names; pickers hide these users.
   */
  deactivatedAt?: string
  deactivatedBy?: string
  createdAt: string
}

// ─── Audit log ──────────────────────────────────────────────────────────────

/**
 * One admin-relevant change (032): role or permission edits, deactivation,
 * vault reset approvals, showcase publishing. Written only by SECURITY
 * DEFINER triggers and the service role; admins can read it, nobody edits it.
 */
export interface AuditLogEntry {
  /** bigserial — the only numeric id in the app. */
  id: number
  at: string
  actorId?: string
  action: string
  entity: string
  entityId?: string
  detail: Record<string, unknown>
}

// ─── Clients ────────────────────────────────────────────────────────────────

export interface ClientCategory {
  id: string
  name: string
  color?: string
  sortOrder: number
  createdAt: string
}

export type Engagement = 'full_time' | 'part_time' | 'gig_on_call'
export type ClientStatus = 'active' | 'paused' | 'ended'

export interface Client {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  categoryId?: string
  engagement: Engagement
  status: ClientStatus
  timezone?: string
  color?: string
  /** The client's picture (052): a key in 'avatars' (clients/<id>/…), or a data URL in local mode. Admins set it. */
  avatarKey?: string
  notes?: string
  /** May the client's work appear on the public showcase (037)? Unset reads as 'unknown'. */
  showcaseConsent?: ClientShowcaseConsent
  createdAt: string
  updatedAt: string
}

export type ClientShowcaseConsent = 'unknown' | 'granted' | 'declined'

// ─── Projects ───────────────────────────────────────────────────────────────

export interface ProjectCategory {
  id: string
  clientId: string
  name: string
  color?: string
  sortOrder: number
}

export type ProjectStatus =
  | 'backlog'
  | 'planning'
  | 'in_progress'
  | 'waiting'
  | 'done'

/**
 * Where a project is in its life (046): onboarding (details gathered with the
 * client) → development → launched. Separate from `status`, which is the
 * kanban column of the work inside the current stage.
 */
export type ProjectPhase = 'onboarding' | 'development' | 'launched'

export interface Project {
  id: string
  clientId: string
  categoryId?: string
  title: string
  status: ProjectStatus
  startDate?: string
  dueDate?: string
  budget?: number
  notes?: string
  assigneeId?: string
  position: number
  /**
   * The shipped site (https only, 037). A project reaching 'done' with one
   * set drafts a showcase item server-side.
   */
  liveUrl?: string
  /**
   * Lifecycle stage (046). Unset on rows from a database without 046, so read
   * it through lib/projectPhase.ts phaseOf(), never directly.
   */
  phase?: ProjectPhase
  phaseChangedAt?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

/** Internal records of external agreements and receipts; never an e-signature or payment processor. */
export interface EngagementMilestone {
  id: string
  title: string
  dueDate: string
  status: 'planned' | 'review' | 'approved'
  approvalEvidence: string
}

export interface EngagementInvoice {
  id: string
  reference: string
  amountMinor: number
  dueDate: string
}

export interface EngagementPayment {
  id: string
  invoiceId: string
  reference: string
  amountMinor: number
  receivedOn: string
}

export interface EngagementTerms {
  currency: 'USD' | 'PHP' | 'EUR' | 'GBP' | 'AUD' | 'CAD'
  feeMinor: number
  depositMinor: number
  scope: string
  acceptanceEvidence: string
  acceptedOn: string
  phase: 'planning' | 'active' | 'completed'
  milestones: EngagementMilestone[]
  invoices: EngagementInvoice[]
  payments: EngagementPayment[]
}

export interface ProjectEngagement {
  id: string
  projectId: string
  leadId?: string
  version: number
  terms: EngagementTerms
  updatedBy?: string
  createdAt: string
  updatedAt: string
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export type Priority = 'low' | 'med' | 'high'

export interface Task {
  id: string
  clientId: string
  projectId?: string
  /** Reuses the client's project categories (per-client taxonomy). */
  categoryId?: string
  /**
   * Set when this task is a subtask of another. Subtasks are ordinary tasks
   * (own assignee, due date and time log) that live under a parent instead of
   * on the board, are one level deep, and gate their parent: it cannot reach
   * 'done' while any unarchived subtask is still open. See lib/tasks.ts.
   */
  parentTaskId?: string
  title: string
  status: TaskStatus
  priority: Priority
  dueDate?: string
  assigneeId?: string
  /**
   * People working on it besides the assignee (054). Never holds the
   * assignee; the database dedupes and caps the list at 20.
   */
  collaboratorIds?: string[]
  notes?: string
  coverUrl?: string
  position: number
  archived: boolean
  completedAt?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export type TaskAction =
  | 'created'
  | 'status_changed'
  | 'updated'
  | 'assigned'
  | 'completed'
  | 'deleted'

export interface TaskActivity {
  id: string
  taskId?: string
  clientId: string
  actorId?: string
  action: TaskAction
  detail: Record<string, unknown>
  createdAt: string
}

/**
 * A persisted End-of-Day report. EOD reports are rendered client-side (see
 * lib/eod.ts) and were previously only copied to the clipboard; saving them
 * makes them queryable and lets n8n log/email them. One row per author per
 * client per day (re-saving the same day updates it).
 */
export interface EodReport {
  id: string
  authorId?: string
  clientId: string
  /** YYYY-MM-DD the report covers. */
  reportDate: string
  /** The rendered report text. */
  content: string
  totalMinutes: number
  createdAt: string
  updatedAt: string
}

// ─── Growth: outbound campaigns ─────────────────────────────────────────────

export type CampaignChannel = 'email' | 'linkedin' | 'cold_call'
export type CampaignStatus = 'active' | 'paused' | 'done'

/**
 * A manually-tracked outbound campaign. DeskDev has no integration with an email
 * sequencer, so volume/opens/replies are entered by hand in the Growth Hub. One
 * row per campaign per week (`weekOf`); the Growth Hub aggregates the current week.
 */
export interface Campaign {
  id: string
  name: string
  channel: CampaignChannel
  status: CampaignStatus
  /** Accounts contacted in this campaign/week. */
  contacted: number
  opens: number
  replies: number
  /** Positive/interested replies. */
  positive: number
  /** YYYY-MM-DD — the Monday of the week these numbers cover. */
  weekOf: string
  ownerId?: string
  createdAt: string
  updatedAt: string
}

// ─── Growth: leads (Growth Hub's own pipeline / mini-CRM) ───────────────────

export type LeadStage = 'new' | 'contacted' | 'proposal' | 'won' | 'lost'
/** Acquisition channel. Free-ish, but these power the source breakdown/ROI. */
export type LeadSource = 'seo' | 'referral' | 'linkedin' | 'outbound' | 'website' | 'other'

/**
 * Why a lead was lost. `no_decision` matters most: research (Dixon & McKenna,
 * HBR 2022 — 2.5M sales conversations) finds 40–60% of qualified B2B deals die
 * in "no decision" rather than to a competitor, so it needs its own bucket to be
 * visible at all.
 */
export type LeadLostReason =
  | 'competitor' | 'price' | 'timing' | 'no_decision' | 'unresponsive' | 'other'

export type LeadAction =
  | 'created' | 'stage_changed' | 'contacted' | 'note' | 'won' | 'lost'
  // 034: intake, triage and the agency workflow
  | 'submitted' | 'resubmitted' | 'assigned' | 'sla_breached'
  | 'spam_marked' | 'not_spam' | 'proposal_sent' | 'auto_reply_sent'
  | 'email_received' | 'email_sent' | 'meeting_booked' | 'converted'
  | 'followup_set' | 'booking_link_sent' | 'call_logged'
  // 047: the lead sent a quick form back
  | 'form_submitted'

/**
 * First/last touch captured on the site (UTM, referrer, landing page, gclid).
 * Free-form jsonb on the server, passed through the mappers untouched, so the
 * keys keep the URL-parameter spelling the site captures them in.
 */
export interface LeadAttribution {
  first?: LeadTouch
  last?: LeadTouch
  /** e.g. 'showcase:<slug>' from a "Start a project like this" button. */
  ref?: string
  [key: string]: unknown
}

export interface LeadTouch {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  referrer?: string
  landing_page?: string
  gclid?: string
  at?: string
  [key: string]: unknown
}

/**
 * Append-only event log for a lead — the same shape as TaskActivity, which is
 * the proven pattern in this app. Without it a lead has no history, so response
 * time, time-in-stage and stall detection are all unmeasurable.
 */
export interface LeadActivity {
  id: string
  leadId: string
  actorId?: string
  action: LeadAction
  detail: Record<string, unknown>
  createdAt: string
}

/**
 * A sales lead owned by the Growth Hub — independent of the shared CRM tables.
 * Inbound (site form) and the job-postings finder write here; a won lead can be
 * converted into a real Client (roster).
 */
export interface Lead {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  stage: LeadStage
  /** Estimated deal value. */
  value: number
  source: LeadSource
  /** YYYY-MM-DD next-touch date. */
  followUp?: string
  hot: boolean
  notes?: string
  ownerId?: string
  /** Set once converted — links the lead to the Client it became. */
  clientId?: string
  /** First outbound touch after the lead arrived — powers speed-to-lead. */
  firstRespondedAt?: string
  /** Most recent touch of any kind — powers "going cold" detection. */
  lastTouchAt?: string
  /** Only meaningful when stage === 'lost'. */
  lostReason?: LeadLostReason

  // ── 034: site intake + triage. All optional: manual leads (and leads from
  // before 034) carry none of them, and an insert must never name a column
  // a not-yet-migrated database lacks.
  /** Generated by Postgres (lower(btrim(email))) — read-only, never written. */
  emailNorm?: string
  /** Service keys picked on the form (see lib/leads.ts LEAD_SERVICES). */
  services?: string[]
  budgetBand?: string
  timeline?: string
  /** The prospect's own words. */
  message?: string
  /** Which form produced it: 'contact' (default), 'email', 'import', … */
  form?: string
  attribution?: LeadAttribution
  consentAt?: string
  /** 0–100, rules in lib/leads.ts scoreLead (mirrors SQL lead_score). */
  score?: number
  scoreBreakdown?: Record<string, number>
  /** First reply due by — business-hours aware, set by intake. */
  slaDueAt?: string
  /** Quarantined: hidden from the pipeline, no notifications. */
  spam?: boolean
  spamReason?: string
  ipHash?: string
  /** The enquiry came from an existing client's email — upsell or support. */
  existingClientId?: string
  submissionCount?: number
  lastSubmittedAt?: string
  /**
   * 039 retention: a lost lead's personal data was scrubbed after 24 months.
   * Written by the retention job only; the UI says "details removed".
   */
  piiScrubbedAt?: string
  createdAt: string
  updatedAt: string
}

/** What convert_lead (036) hands back; the local fallback returns the same. */
export interface ConvertLeadResult {
  ok: boolean
  clientId?: string
  projectId?: string
  error?: string
}

// ─── Workspace settings (033 singleton) ─────────────────────────────────────

export interface BusinessHours {
  /** IANA zone, e.g. 'Asia/Manila'. */
  tz: string
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[]
  /** 'HH:MM' local to tz. */
  start: string
  end: string
}

/**
 * Server-side workspace configuration — one row for the whole workspace, so
 * the SLA sweep, intake and n8n read the same values the app shows. Replaces
 * the browser-local Settings.staleLeadDays / monthlyClientTarget. Everyone
 * reads it; only admins write it.
 */
export interface WorkspaceSettings {
  growthSlaMinutes: number
  growthEscalateMinutes: number
  growthBusinessHours: BusinessHours
  /** Round-robin pool for new leads; empty falls back to admins. */
  growthOwnerPool: string[]
  /** Notify every Growth editor about a new lead, not just its owner. */
  growthNotifyAll: boolean
  growthBookingUrl?: string
  growthAutoReply: boolean
  /** Days without a touch before an open lead counts as "going cold". */
  growthStaleDays: number
  /** Growth Hub goal: new clients to win this month. */
  growthMonthlyClientTarget?: number
  showcaseAutoPublish: boolean
  // 048: the public booking page (nixgensolutions.com/book). Slots come from
  // growthBusinessHours minus Google free/busy and DeskDev meetings.
  bookingEnabled: boolean
  /** The meeting's name, e.g. 'Discovery call'. */
  bookingTitle: string
  bookingMinutes: number
  /** No slot starts sooner than this after now. */
  bookingNoticeMinutes: number
  bookingDaysAhead: number
  /** Kept free before and after every meeting. */
  bookingBufferMinutes: number
  /** Who takes booked calls; unset → the lead's owner, else an admin. */
  bookingHostId?: string
  // 049: email sent through n8n's Gmail account.
  /** The name customers see in their inbox. */
  emailFromName: string
  /** The Gmail address n8n sends from (shown as the from line; our own mail is skipped on ingest). */
  emailFromAddress?: string
  /** Added under every email sent from DeskDev. */
  emailSignature?: string
  updatedAt?: string
  updatedBy?: string
}

// ─── Showcase (037: the public project library on /portfolio) ───────────────

export type ShowcaseKind = 'website' | 'web_app' | 'product'
export type ShowcaseStatus = 'draft' | 'ready' | 'published' | 'hidden' | 'archived'
/** legacy = live on the old portfolio before consent was tracked; internal = our own product. */
export type ShowcaseConsent = 'unknown' | 'granted' | 'declined' | 'legacy' | 'internal'
export type ShowcaseLinkStatus = 'unknown' | 'ok' | 'down'
/**
 * Where a card's picture comes from (037's image_source CHECK):
 * upload / capture — stored in the 'showcase' bucket; local — a file in the
 * site's /public; mshots — no stored image yet, a live capture of the URL;
 * mockup — show the themed app mockup; none — known broken, monogram.
 */
export type ShowcaseImageSource = 'upload' | 'capture' | 'local' | 'mshots' | 'mockup' | 'none'

/**
 * Case-study body for featured items. jsonb on the server; the public site
 * (site/src/lib/showcase.ts caseStudyOf) reads exactly these keys: metrics
 * capped at 6, and a quote shows only with both text and author.
 */
export interface ShowcaseCaseStudy {
  challenge?: string
  approach?: string
  outcome?: string
  metrics?: { label: string; value: string }[]
  quote?: { text: string; author: string; role?: string }
  [key: string]: unknown
}

export interface ShowcaseItem {
  id: string
  slug: string
  kind: ShowcaseKind
  title: string
  url?: string
  /** Show the live link publicly (some clients allow the card, not the link). */
  linkPublic: boolean
  /**
   * The only URL the public site can read: url when linkPublic, else unset.
   * Derived by the guard trigger on every write — never sent by the app.
   */
  publicUrl?: string
  industry?: string
  summary?: string
  resultTag?: string
  stack: string[]
  accent?: string
  mockupVariant?: string
  /** Storage keys in the public 'showcase' bucket (1280w / 640w webp). */
  imageKey?: string
  imageKeySmall?: string
  imageAlt?: string
  imageSource?: ShowcaseImageSource
  caseStudy?: ShowcaseCaseStudy
  status: ShowcaseStatus
  featured: boolean
  homeFeatured: boolean
  sortOrder: number
  /** YYYY-MM-DD */
  launchedOn?: string
  consent: ShowcaseConsent
  consentNote?: string
  consentAt?: string
  projectId?: string
  clientId?: string
  linkStatus: ShowcaseLinkStatus
  linkCheckedAt?: string
  linkFailCount: number
  /** Stamped by the publish-guard trigger; never written by the app. */
  publishedAt?: string
  publishedBy?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

// ─── Forms (046) ────────────────────────────────────────────────────────────

export type FormStatus = 'draft' | 'submitted'

/**
 * Answers to one form (template in lib/forms.ts, keyed by `form`) about a
 * project, a lead or a client. Phase 2 uses 'onboarding' per project.
 */
export interface FormResponse {
  id: string
  /** Template key, e.g. 'onboarding'. */
  form: string
  version: number
  projectId?: string
  clientId?: string
  leadId?: string
  /** Field key → value (string, string[], number or boolean). */
  answers: Record<string, unknown>
  status: FormStatus
  submittedAt?: string
  submittedBy?: string
  // 047: the customer quick-form link. Only the token's sha256 is stored; the
  // link itself exists once, in the dialog that created it.
  shareTokenHash?: string
  shareExpiresAt?: string
  sharedAt?: string
  sharedBy?: string
  /** The address the team meant to send the link to. */
  sharedTo?: string
  /** When the customer sent their answers (stamped by form_link_submit; reset by a new link). */
  customerSubmittedAt?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

// ─── Email (049) ────────────────────────────────────────────────────────────

export type EmailDirection = 'out' | 'in'
/** out: queued → sending → sent | failed (n8n sends it). in: received (n8n polls Gmail). */
export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'received'

/**
 * One email about a lead, client or project. DeskDev never talks to Gmail:
 * it queues outbound mail and n8n sends it through the studio's Gmail; n8n
 * also brings replies in (email_ingest), only from people DeskDev knows.
 */
export interface Email {
  id: string
  direction: EmailDirection
  status: EmailStatus
  leadId?: string
  clientId?: string
  projectId?: string
  fromEmail?: string
  fromName?: string
  toEmails: string[]
  ccEmails: string[]
  subject: string
  bodyText: string
  /** The email this one answers. */
  inReplyTo?: string
  gmailMessageId?: string
  gmailThreadId?: string
  error?: string
  sentAt?: string
  receivedAt?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

// ─── Site subscribers (039) ─────────────────────────────────────────────────

/** Newsletter sign-ups from the site — never leads (leads.source has no newsletter). */
export interface SiteSubscriber {
  id: string
  email: string
  /** Generated by Postgres (lower(btrim(email))) — read-only. */
  emailNorm?: string
  /** Where the sign-up box was, e.g. 'footer'. */
  source?: string
  consentAt?: string
  /** Kept, not deleted, so a later import can't re-add someone who said no. */
  unsubscribedAt?: string
  ipHash?: string
  createdAt: string
  updatedAt?: string
}

// ─── Growth: job postings (found by the n8n finder) ─────────────────────────

/** Whether a posting is a company to pitch (`lead`) or a gig to apply to (`gig`). */
export type JobTag = 'lead' | 'gig'

/**
 * A job posting surfaced by the n8n job-postings finder (Adzuna / onlinejobs.ph).
 * n8n writes these via the service key; the app reads them (Growth Hub → Inbound
 * "Job leads"). Deduped on `url`.
 */
export interface JobPosting {
  application?: { cv?: string; draft?: string; analysis?: string; status?: 'queued' | 'reviewing' | 'ready' | 'applied' }
  id: string
  source: string
  externalId?: string
  url: string
  title: string
  company?: string
  location?: string
  remote: boolean
  category?: string
  tag: JobTag
  salaryText?: string
  postedAt?: string
  description?: string
  dismissed: boolean
  createdAt: string
}

// ─── Time tracking ──────────────────────────────────────────────────────────

export interface TimeEntry {
  id: string
  taskId?: string
  clientId: string
  userId?: string
  /** YYYY-MM-DD */
  entryDate: string
  minutes: number
  note?: string
  createdAt: string
}

// ─── CRM (Notion-style tables) ──────────────────────────────────────────────

export interface CrmTable {
  id: string
  name: string
  clientId?: string
  color?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export type CrmColumnType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  /** A DeskDev user; the cell holds their id (057). */
  | 'person'
  /** Worked out per row from other cells (lib/crmFormula.ts); never stored in rows (057). */
  | 'formula'

export interface CrmSelectOption {
  id: string
  label: string
  color?: string
}

export interface CrmColumn {
  id: string
  tableId: string
  name: string
  type: CrmColumnType
  /** Choices for select / multi_select columns */
  options: CrmSelectOption[]
  sortOrder: number
  /** Width in px set by dragging the header edge (057); unset = the default. */
  width?: number
  /** The expression of a formula column (057), e.g. `{Deal value} * 0.1`. */
  formula?: string
}

export type CrmCellValue = string | number | boolean | string[] | null

export interface CrmRow {
  id: string
  tableId: string
  /** Keyed by column id */
  values: Record<string, CrmCellValue>
  position: number
  createdBy?: string
  createdAt: string
  updatedAt: string
}

// ─── Calendar & meetings ────────────────────────────────────────────────────

export type EventKind = 'event' | 'meeting'
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface EventItem {
  id: string
  kind: EventKind
  title: string
  description?: string
  clientId?: string
  startsAt: string
  endsAt?: string
  allDay: boolean
  location?: string
  meetingLink?: string
  /** Meeting notes */
  notes?: string
  color?: string
  recurrence: Recurrence
  /** YYYY-MM-DD — last date a recurring event repeats */
  recurrenceUntil?: string

  // ── 040: Team Calendar sync. Optional: unset reads as "not synced".
  /** IANA zone the event was planned in — recurrences expand in it, not the browser's. */
  timezone?: string
  /** Push this event to the shared Google calendar. */
  syncGoogle?: boolean
  /** Ask Google to attach a Meet link. */
  addMeet?: boolean
  /** Written by the sync function only — the app never sends these. */
  googleEventId?: string
  googleEtag?: string
  syncStatus?: string
  syncError?: string
  // ── 048: booking. A meeting about a lead (set by the app, or by the booking page).
  leadId?: string
  /** 'website' when the customer booked it on /book (set by the server only). */
  bookedVia?: 'website'
  /** 'deskdev' or 'google' (created on the Google side). */
  origin?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export type AttendeeResponse = 'needsAction' | 'accepted' | 'declined' | 'tentative'

/** A person invited to an event: a teammate (profileId) or anyone by email. */
export interface EventAttendee {
  id: string
  eventId: string
  profileId?: string
  email: string
  displayName?: string
  /** Invited as optional (Google's "optional guest"). */
  optional?: boolean
  /** Google owns RSVPs; the app only shows them. */
  responseStatus: AttendeeResponse
  createdAt?: string
  updatedAt?: string
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationType =
  | 'task_assigned'
  | 'task_updated'
  | 'project_updated'
  | 'client_updated'
  | 'crm_updated'
  | 'event_updated'
  | 'meeting_updated'
  | 'due_reminder'
  | 'channel_mention'
  | 'system'
  // 033: Growth + Showcase
  | 'lead_new'
  | 'lead_sla'
  | 'lead_followup'
  | 'lead_assigned'
  | 'showcase_ready'
  // 047: a customer sent a quick form back
  | 'form_submitted'
  // 048: a call was booked on the website's /book page
  | 'meeting_booked'
  // 049: a lead or client emailed back
  | 'email_received'

export interface Notification {
  id: string
  /** Recipient */
  userId: string
  actorId?: string
  type: NotificationType
  title: string
  body?: string
  entity?: string
  entityId?: string
  read: boolean
  createdAt: string
}

// ─── Chat (inbox + conversations) ───────────────────────────────────────────
// Open to every profile. A conversation is a DM (two people, no title) or a
// named group; unread state comes from each user's ConversationRead marker.

export interface Conversation {
  id: string
  /** Group name. Unset for direct messages — the UI shows the other person. */
  title?: string
  isGroup: boolean
  participantIds: string[]
  createdBy?: string
  /** Latest message time — orders the inbox. */
  lastMessageAt: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  replyToId?: string
  id: string
  conversationId: string
  senderId?: string
  body: string
  editedAt?: string
  createdAt: string
}

/** "Read up to" marker for one user in one conversation. */
export interface ConversationRead {
  id: string
  conversationId: string
  userId: string
  lastReadAt: string
}

// ─── Channels (Discord-style team rooms) ────────────────────────────────────
// Persistent rooms grouped into categories. Public channels are open to every
// profile; private ones to memberIds (and admins). The creator or an admin
// manages a channel. See lib/channels.ts for the rules, migration 023 for RLS.

export interface ChannelCategory {
  id: string
  /** The space this heading belongs to: a client, or the studio when unset. */
  clientId?: string
  name: string
  position: number
  createdBy?: string
  createdAt: string
  updatedAt: string
}

/** text: anyone who can see it posts. announcement: managers post, others read + react. */
export type ChannelKind = 'text' | 'announcement'

export interface Channel {
  id: string
  /**
   * The space this channel belongs to, like a Discord server: a client, or
   * the studio itself when unset. Deleting the client deletes its channels.
   */
  clientId?: string
  /** Unset = uncategorised (listed above the categories). */
  categoryId?: string
  /** Lowercase slug, e.g. "client-updates". */
  name: string
  topic?: string
  kind: ChannelKind
  isPrivate: boolean
  /** Who can see a private channel. Ignored for public ones. */
  memberIds: string[]
  position: number
  createdBy?: string
  lastMessageAt: string
  createdAt: string
  updatedAt: string
}

export interface ChannelMessage {
  id: string
  channelId: string
  senderId?: string
  /** Mentions live inline as `<@userId>` and `@everyone`. */
  body: string
  replyToId?: string
  pinnedAt?: string
  pinnedBy?: string
  editedAt?: string
  createdAt: string
}

export interface ChannelReaction {
  id: string
  messageId: string
  channelId: string
  userId: string
  emoji: string
  createdAt: string
}

/** "Read up to" marker for one user in one channel. */
export interface ChannelRead {
  id: string
  channelId: string
  userId: string
  lastReadAt: string
}

// ─── Meeting recordings (058) ───────────────────────────────────────────────

/** A client's own category of recordings. Its projects are folders too, without a row. */
export interface RecordingFolder {
  id: string
  clientId: string
  name: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

/**
 * A meeting recording (revision 8): a link to where the video lives, filed by
 * client, then by one of the client's projects or categories. Embeddable
 * links (lib/videoEmbed.ts) play in DeskDev; any other https link opens.
 */
export interface MeetingRecording {
  id: string
  clientId?: string
  projectId?: string
  folderId?: string
  title: string
  url: string
  thumbnailUrl?: string
  /** YYYY-MM-DD */
  recordedOn?: string
  notes?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

// ─── Courses (training library) ─────────────────────────────────────────────
// Course → Module → Topic. A topic optionally carries one SOP video, held as
// an external link (see lib/videoEmbed.ts) rather than an uploaded file.

export interface Course {
  id: string
  title: string
  description?: string
  position: number
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface CourseModule {
  id: string
  courseId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}

export interface CourseTopic {
  id: string
  moduleId: string
  title: string
  summary?: string
  /** SOP video link. Undefined when no SOP has been recorded yet. */
  sopVideoUrl?: string
  /** Poster cached from the provider's oEmbed response when the link was saved. */
  sopThumbnailUrl?: string
  /** A written note (055): plain text, shown as written. A topic may be a note alone. */
  notes?: string
  position: number
  createdAt: string
  updatedAt: string
}
