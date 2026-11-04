import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'
import { TABLE_FOR, toRow, type EntityKey } from './mappers'
import {
  rowToUser, rowToClientCategory, rowToClient, rowToProjectCategory,
  rowToProjectEngagement, rowToProject, rowToTask, rowToTaskActivity, rowToTimeEntry,
  rowToCrmTable, rowToCrmColumn, rowToCrmRow, rowToEvent, rowToNotification,
  rowToEodReport, rowToCampaign, rowToJobPosting, rowToLead, rowToLeadActivity,
  rowToCourse, rowToCourseModule, rowToCourseTopic, rowToMeetingRecording, rowToRecordingFolder,
  rowToConversation, rowToChatMessage, rowToConversationRead,
  rowToChannelCategory, rowToChannel, rowToChannelMessage, rowToChannelReaction, rowToChannelRead,
  rowToShowcaseItem, rowToEventAttendee, rowToSiteSubscriber, rowToAuditLogEntry, rowToFormResponse, rowToEmail,
  rowToWorkspaceSettings, workspaceSettingsToRow,
} from './mappers'
import type {
  User, ClientCategory, Client, ProjectCategory, Project,
  Task, TaskActivity, TimeEntry,
  CrmTable, CrmColumn, CrmRow,
  EventItem, Notification, EodReport, Campaign, JobPosting, Lead, LeadActivity,
  Course, CourseModule, CourseTopic, MeetingRecording, RecordingFolder,
  Conversation, ChatMessage, ConversationRead,
  ChannelCategory, Channel, ChannelMessage, ChannelReaction, ChannelRead,
  ShowcaseItem, EventAttendee, SiteSubscriber, AuditLogEntry, WorkspaceSettings, FormResponse, Email,
  ConvertLeadResult, ProjectEngagement, EngagementTerms,
} from './types'

// Dual-mode persistence adapter. Store actions call these fire-and-forget:
// when Supabase is unconfigured every call is a no-op and the app runs purely
// on the persisted local store. Errors are logged with console.warn and
// reported through the write-error handler — never thrown into the UI.

// ─── Ordered write queue ────────────────────────────────────────────────────
// Store actions issue writes back-to-back without awaiting them: addTask
// inserts the task and then its 'created' activity row, addLead its lead
// then lead_activity, sendMessage a conversation then its first message.
// As independent requests those pairs race — PostgREST serves each on its
// own connection, and whenever the child row commits before its parent,
// Postgres rejects it ("violates foreign key constraint
// task_activity_task_id_fkey"). Chaining every write onto one promise keeps
// issue order equal to arrival order, so a parent row is always committed
// before anything that references it. It also stops an update from landing
// before the insert it patches, which used to update zero rows silently.
// A failed write reports and releases the chain — it never blocks the
// writes queued behind it.

let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run)
  queue = result.catch(() => undefined)
  return result
}

/**
 * Resolves once every write issued so far has been sent. hydrate() waits on
 * this, so a full pull can never snapshot the server from before a queued
 * insert landed and then erase the optimistic row with "older" data.
 */
export function flush(): Promise<void> {
  return queue.then(
    () => undefined,
    () => undefined,
  )
}

// ─── Write-failure reporting ────────────────────────────────────────────────
// Writes are fire-and-forget so the UI stays instant, but a silent failure is
// worse than a slow one: the optimistic row survives locally until the next
// hydrate() replaces state with the server's, and the edit vanishes with no
// explanation. Everything still logs to the console; this hook lets the app
// also tell the user. Platform-agnostic on purpose — web registers a toast.

export type WriteErrorHandler = (info: {
  table: string
  op: 'insert' | 'update' | 'delete'
  message: string
}) => void

let onWriteError: WriteErrorHandler | null = null

/** Register (or clear, with null) the handler for failed remote writes. */
export function setWriteErrorHandler(fn: WriteErrorHandler | null): void {
  onWriteError = fn
}

function reportWriteError(table: string, op: 'insert' | 'update' | 'delete', message: string): void {
  console.warn(`[db] ${table} ${op} failed:`, message)
  try {
    onWriteError?.({ table, op, message })
  } catch {
    /* a broken handler must never break the write path */
  }
}

/**
 * Postgres reports an UPDATE or DELETE that RLS filtered out as a success
 * with zero rows — the same shape as "row already gone". Both mean the
 * change the user just saw did not happen on the server.
 */
const NO_ROW_MESSAGE =
  'The server did not accept this change — you may not have permission, or the record no longer exists.'

const SIGNED_OUT_MESSAGE = 'Your session has ended. Sign in again to keep your changes.'

const ACCOUNT_CHANGED_MESSAGE =
  'A different account is signed in on this browser now. Reload this page to continue as that account.'

const OFFLINE_MESSAGE = "You're offline, so this change wasn't saved. Reconnect and make it again."

/** Any app entity or patch — interfaces have no index signature, so accept `object`. */
type AppObject = object

const asRecord = (obj: AppObject): Record<string, unknown> =>
  obj as Record<string, unknown>

/**
 * A patch's explicit `undefined` means "clear this field". toRow() drops
 * undefined keys — right for an insert, where the column default applies —
 * so an update has to turn them into null first, or the server keeps the old
 * value while the UI shows it cleared (an unassigned task that keeps emailing
 * its old assignee, a due date that comes back on the next hydrate).
 */
function nullifyUndefined(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) out[key] = patch[key] === undefined ? null : patch[key]
  return out
}

export type Gate = 'local' | 'ok' | 'signed-out' | 'offline' | 'account-changed'

// ─── Whose writes these are ─────────────────────────────────────────────────
// Rows carry the app's current user (sender_id, user_id, created_by …) and RLS
// checks them against the session's. When another tab or window signs a
// different account in on this browser, supabase-js switches this tab's
// session too, and every write here became a bare "new row violates
// row-level security policy" (a channel message posted as the previous
// account with the new account's token). The store registers who it thinks is
// signed in; the gate stops such a write and says what happened. The store
// also switches over on the auth event (syncSessionUser), so this is the
// backstop for the moment in between.

let currentUserGetter: (() => string | null) | null = null

/** The store's current user id, read before every write (null: none yet). */
export function setCurrentUserGetter(fn: (() => string | null) | null): void {
  currentUserGetter = fn
}

function looksOffline(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Local mode writes nowhere and says nothing. A configured app with no
 * session is a different case: the user thinks they are signed in, so
 * dropping their write quietly would lose it — report it instead. An expired
 * token that couldn't be refreshed for want of a network is not a sign-out:
 * say "offline", or a phone that just woke up tells people they were logged out.
 */
async function gate(): Promise<Gate> {
  if (!isSupabaseConfigured) return 'local'
  try {
    const { data, error } = await supabase.auth.getSession()
    if (data.session) {
      const me = currentUserGetter?.() ?? null
      return me !== null && me !== data.session.user.id ? 'account-changed' : 'ok'
    }
    return looksOffline(error) ? 'offline' : 'signed-out'
  } catch (error) {
    return looksOffline(error) ? 'offline' : 'signed-out'
  }
}

/** The message for a write the gate stopped, or null when it may go ahead. */
function blocked(g: Gate): string | null {
  if (g === 'signed-out') return SIGNED_OUT_MESSAGE
  if (g === 'offline') return OFFLINE_MESSAGE
  if (g === 'account-changed') return ACCOUNT_CHANGED_MESSAGE
  return null
}

/**
 * Whether a remote call may go ahead right now: 'local' (no Supabase), 'ok',
 * 'signed-out', 'offline' or 'account-changed'. For awaited calls outside the write queue
 * (uploads, RPCs that return data) that need to say why they didn't run.
 */
export function remoteGate(): Promise<Gate> {
  return gate()
}

// ─── Migrations not applied yet ─────────────────────────────────────────────
// The app ships ahead of its migrations: 032–040 exist as files long before
// someone applies them by hand. A table that isn't there yet must read as
// "feature not available" — not as a load failure on every page, and not as a
// realtime subscription that takes the whole sync channel down with it.

const missing = new Set<string>()

interface PgError {
  code?: string
  message?: string
}

/** PostgREST's "no such table" (PGRST205) or Postgres' (42P01). */
export function isMissingRelation(error: PgError | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /could not find the table|relation .* does not exist/i.test(error.message ?? '')
}

/** PostgREST's "no such function" (PGRST202) or Postgres' (42883). */
export function isMissingFunction(error: PgError | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /could not find the function/i.test(error.message ?? '')
}

/** A table the last pull found missing — realtime skips it until it exists. */
export function isTableMissing(table: string): boolean {
  return missing.has(table)
}

function markTable(table: string, isMissing: boolean): void {
  if (isMissing) missing.add(table)
  else missing.delete(table)
}

/** Insert an app object (camelCase) into its table. Fire-and-forget, in issue order. */
export function insert(entity: EntityKey, obj: AppObject): Promise<boolean> {
  if (entity === 'users') {
    // profiles has no INSERT policy — rows are created by the auth signup
    // trigger. Remote user creation goes through lib/adminUsers createUser.
    console.warn('[db] profiles insert blocked — use lib/adminUsers createUser')
    return Promise.resolve(false)
  }
  // Snapshot the payload now so a later store change can't leak into a
  // write that is still waiting its turn.
  const table = TABLE_FOR[entity]
  const row = toRow(entity, asRecord(obj))
  return enqueue(async () => {
    const g = await gate()
    if (g === 'local') return true
    const stop = blocked(g)
    if (stop) {
      reportWriteError(table, 'insert', stop)
      return false
    }
    try {
      const { error } = await supabase.from(table).insert([row])
      if (error) {
        reportWriteError(table, 'insert', error.message)
        return false
      }
      return true
    } catch {
      reportWriteError(table, 'insert', 'This change could not be saved. Check your connection and try again.')
      return false
    }
  })
}

/** Update a row by id with a camelCase patch. Fire-and-forget, in issue order. */
export function saveJobApplication(id: string, patch: Pick<JobPosting, 'application' | 'description'>): Promise<boolean> {
  return enqueue(async () => {
    const g = await gate()
    if (g === 'local') return true
    const stop = blocked(g)
    if (stop) { reportWriteError('job_postings', 'update', stop); return false }
    try {
      const { data, error } = await supabase.from('job_postings').update(toRow('jobPostings', patch)).eq('id', id).select('id')
      if (error || !data?.length) {
        reportWriteError('job_postings', 'update', error?.message ?? NO_ROW_MESSAGE)
        return false
      }
      return true
    } catch {
      reportWriteError('job_postings', 'update', 'Application could not be saved. Check your connection and try again.')
      return false
    }
  })
}

export function update(entity: EntityKey, id: string, patch: AppObject): Promise<void> {
  const table = TABLE_FOR[entity]
  const row = toRow(entity, nullifyUndefined(asRecord(patch)))
  return enqueue(async () => {
    const g = await gate()
    if (g === 'local') return
    const stop = blocked(g)
    if (stop) return reportWriteError(table, 'update', stop)
    const { data, error } = await supabase.from(table).update(row).eq('id', id).select('id')
    if (error) reportWriteError(table, 'update', error.message)
    else if (!data || data.length === 0) reportWriteError(table, 'update', NO_ROW_MESSAGE)
  })
}

/** Delete a row by id. Fire-and-forget, in issue order. */
export function remove(entity: EntityKey, id: string): Promise<void> {
  if (entity === 'users') {
    // profiles has no DELETE policy — rows cascade from auth.users. Remote
    // user deletion goes through lib/adminUsers deleteUser.
    console.warn('[db] profiles delete blocked — use lib/adminUsers deleteUser')
    return Promise.resolve()
  }
  const table = TABLE_FOR[entity]
  return enqueue(async () => {
    const g = await gate()
    if (g === 'local') return
    const stop = blocked(g)
    if (stop) return reportWriteError(table, 'delete', stop)
    const { data, error } = await supabase.from(table).delete().eq('id', id).select('id')
    if (error) reportWriteError(table, 'delete', error.message)
    else if (!data || data.length === 0) reportWriteError(table, 'delete', NO_ROW_MESSAGE)
  })
}

/** Confirm self-service profile edits before showing a saved state. */
export function updateProfileConfirmed(id: string, patch: AppObject): Promise<{ ok: boolean; error?: string }> {
  const row = toRow('users', nullifyUndefined(asRecord(patch)))
  return enqueue(async () => {
    const g = await gate()
    if (g === 'local') return { ok: true }
    const stop = blocked(g)
    if (stop) return { ok: false, error: stop }
    try {
      const { data, error } = await supabase.from('profiles').update(row).eq('id', id).select('id')
      if (error) return { ok: false, error: error.message }
      if (!data?.length) return { ok: false, error: NO_ROW_MESSAGE }
      return { ok: true }
    } catch {
      return { ok: false, error: 'Your profile could not be saved. Check your connection and try again.' }
    }
  })
}

/** Parent deletes can be refused by retained engagement records. Confirm before removing their local children. */
export async function removeConfirmed(entity: 'projects' | 'clients', id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await gate()
  if (g === 'local') return { ok: true }
  const stop = blocked(g)
  if (stop) return { ok: false, error: stop }
  await flush()
  try {
    const { data, error } = await supabase.from(TABLE_FOR[entity]).delete().eq('id', id).select('id')
    if (error) return { ok: false, error: error.code === '23503' ? 'This record has retained engagement history. Keep it and change its status instead.' : error.message }
    return data?.length ? { ok: true } : { ok: false, error: NO_ROW_MESSAGE }
  } catch {
    return { ok: false, error: 'Could not confirm deletion. Reconnect and retry.' }
  }
}

// ─── Full hydration pull ─────────────────────────────────────────────────────

/** Every list table hydrate() pulls, keyed by its store slice. */
export interface RemoteTables {
  users: User[]
  clientCategories: ClientCategory[]
  clients: Client[]
  projectCategories: ProjectCategory[]
  projects: Project[]
  projectEngagements: ProjectEngagement[]
  tasks: Task[]
  taskActivity: TaskActivity[]
  timeEntries: TimeEntry[]
  crmTables: CrmTable[]
  crmColumns: CrmColumn[]
  crmRows: CrmRow[]
  events: EventItem[]
  notifications: Notification[]
  eodReports: EodReport[]
  campaigns: Campaign[]
  jobPostings: JobPosting[]
  leads: Lead[]
  leadActivity: LeadActivity[]
  courses: Course[]
  courseModules: CourseModule[]
  courseTopics: CourseTopic[]
  recordingFolders: RecordingFolder[]
  meetingRecordings: MeetingRecording[]
  conversations: Conversation[]
  messages: ChatMessage[]
  conversationReads: ConversationRead[]
  channelCategories: ChannelCategory[]
  channels: Channel[]
  channelMessages: ChannelMessage[]
  channelReactions: ChannelReaction[]
  channelReads: ChannelRead[]
  showcaseItems: ShowcaseItem[]
  eventAttendees: EventAttendee[]
  siteSubscribers: SiteSubscriber[]
  formResponses: FormResponse[]
  emails: Email[]
}

/** Everything one pull returns: the list tables plus the settings singleton. */
export interface RemoteData extends RemoteTables {
  workspaceSettings: WorkspaceSettings
}

type Row = Record<string, unknown>

/**
 * Postgres table → store slice, mapper, whether it is an append-only log
 * (read newest-first), and whether its migration may not be applied yet
 * (missing reads as empty, not as a failure).
 */
const FETCHERS: { [K in keyof RemoteTables]: [EntityKey, (row: Row) => RemoteTables[K][number], boolean, boolean?] } = {
  users: ['users', rowToUser, false],
  clientCategories: ['clientCategories', rowToClientCategory, false],
  clients: ['clients', rowToClient, false],
  projectCategories: ['projectCategories', rowToProjectCategory, false],
  projects: ['projects', rowToProject, false],
  projectEngagements: ['projectEngagements', rowToProjectEngagement, false, true],
  tasks: ['tasks', rowToTask, false],
  taskActivity: ['taskActivity', rowToTaskActivity, true],
  timeEntries: ['timeEntries', rowToTimeEntry, true],
  crmTables: ['crmTables', rowToCrmTable, false],
  crmColumns: ['crmColumns', rowToCrmColumn, false],
  crmRows: ['crmRows', rowToCrmRow, false],
  events: ['events', rowToEvent, false],
  notifications: ['notifications', rowToNotification, true],
  eodReports: ['eodReports', rowToEodReport, true],
  campaigns: ['campaigns', rowToCampaign, false],
  jobPostings: ['jobPostings', rowToJobPosting, true],
  leads: ['leads', rowToLead, false],
  leadActivity: ['leadActivity', rowToLeadActivity, true],
  courses: ['courses', rowToCourse, false],
  courseModules: ['courseModules', rowToCourseModule, false],
  courseTopics: ['courseTopics', rowToCourseTopic, false],
  // RLS scopes all three to conversations the signed-in user belongs to.
  conversations: ['conversations', rowToConversation, false],
  messages: ['messages', rowToChatMessage, true],
  conversationReads: ['conversationReads', rowToConversationRead, false],
  // RLS hides private channels (and their rows) from non-members.
  channelCategories: ['channelCategories', rowToChannelCategory, false],
  channels: ['channels', rowToChannel, false],
  channelMessages: ['channelMessages', rowToChannelMessage, true],
  channelReactions: ['channelReactions', rowToChannelReaction, false],
  channelReads: ['channelReads', rowToChannelRead, false],
  // 037 / 040 / 039 — optional until those migrations are applied. RLS
  // returns showcase rows to showcase:view, subscribers to growth:view.
  showcaseItems: ['showcaseItems', rowToShowcaseItem, false, true],
  eventAttendees: ['eventAttendees', rowToEventAttendee, false, true],
  siteSubscribers: ['siteSubscribers', rowToSiteSubscriber, true, true],
  // 046 — optional until applied. RLS follows the row's project, lead or client.
  formResponses: ['formResponses', rowToFormResponse, false, true],
  // 049 — a log (newest first, the oldest fall off past MAX_ROWS); RLS by anchor.
  emails: ['emails', rowToEmail, true, true],
  // 058 — optional until applied. RLS: meetings:view.
  recordingFolders: ['recordingFolders', rowToRecordingFolder, false, true],
  meetingRecordings: ['meetingRecordings', rowToMeetingRecording, true, true],
}

/** PostgREST serves at most this many rows per request (its `max_rows`). */
const PAGE = 1000
/**
 * Ceiling per table for one hydrate. Log tables are read newest-first, so
 * what falls off the end is the oldest history, never today's rows.
 */
const MAX_ROWS = 5000

/**
 * Pull one table, paging past PostgREST's per-request cap. Returns null on
 * failure so the caller keeps the slice it already has — an empty array here
 * used to be indistinguishable from "the table really is empty", and one
 * transient error on `profiles` signed everybody out of every page. An
 * `optional` table that doesn't exist yet comes back empty instead.
 */
async function fetchTable<T>(
  entity: EntityKey,
  map: (row: Row) => T,
  newestFirst: boolean,
  optional = false,
): Promise<T[] | null> {
  const table = TABLE_FOR[entity]
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = supabase.from(table).select('*')
    // A stable order is what makes ranges disjoint; id breaks created_at ties.
    query = newestFirst ? query.order('created_at', { ascending: false }).order('id') : query.order('id')
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) {
      const gone = isMissingRelation(error)
      markTable(table, gone)
      if (gone && optional) return []
      console.warn(`[db] ${table} fetch failed:`, error.message)
      return null
    }
    markTable(table, false)
    const rows = (data as Row[]) ?? []
    for (const row of rows) out.push(map(row))
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * The workspace_settings singleton (033). 'missing' before the migration is
 * applied — the app then keeps its local defaults; null on any other failure.
 */
export async function fetchWorkspaceSettings(): Promise<WorkspaceSettings | 'missing' | null> {
  const table = TABLE_FOR.workspaceSettings
  const { data, error } = await supabase.from(table).select('*').limit(1).maybeSingle()
  if (error) {
    const gone = isMissingRelation(error)
    markTable(table, gone)
    if (gone) return 'missing'
    console.warn(`[db] ${table} fetch failed:`, error.message)
    return null
  }
  markTable(table, false)
  // The migration inserts the row; if it is somehow absent, the defaults hold.
  return rowToWorkspaceSettings((data as Row | null) ?? {})
}

export interface FetchAllResult {
  /** Every table that loaded, mapped to app objects. */
  data: Partial<RemoteData>
  /** Tables whose fetch failed — their slices keep what they had. */
  failed: (keyof RemoteData)[]
}

/**
 * Pull every table. A table whose fetch failed is left out of `data` and
 * named in `failed`, so the app keeps its old rows and can offer a retry
 * instead of passing a gap off as "nothing here". Returns null when remote
 * mode is unavailable (unconfigured, signed out or offline) so hydrate()
 * keeps the state it has.
 */
export async function fetchAllWithStatus(): Promise<FetchAllResult | null> {
  if ((await gate()) !== 'ok') return null
  const data: Partial<RemoteData> = {}
  const failed: (keyof RemoteData)[] = []
  await Promise.all([
    ...(Object.keys(FETCHERS) as (keyof RemoteTables)[]).map(async (key) => {
      const [entity, map, newestFirst, optional] = FETCHERS[key] as [EntityKey, (row: Row) => unknown, boolean, boolean?]
      const rows = await fetchTable(entity, map, newestFirst, optional)
      if (rows) (data as Record<string, unknown>)[key] = rows
      else failed.push(key)
    }),
    (async () => {
      const settings = await fetchWorkspaceSettings()
      if (settings === null) failed.push('workspaceSettings')
      else if (settings !== 'missing') data.workspaceSettings = settings
    })(),
  ])
  // Stable order: the store compares it, and people read it.
  const order: string[] = [...Object.keys(FETCHERS), 'workspaceSettings']
  failed.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return { data, failed }
}

/** fetchAllWithStatus() without the failure list. */
export async function fetchAll(): Promise<Partial<RemoteData> | null> {
  return (await fetchAllWithStatus())?.data ?? null
}

// ─── Targeted reads ─────────────────────────────────────────────────────────

/**
 * Rows of one table where `column` equals `value`, mapped to app objects —
 * for pulling just what a server-side operation (convert_lead) created,
 * rather than a full hydrate. Null when remote mode is unavailable or the
 * read failed.
 */
export async function fetchWhere<K extends keyof RemoteTables>(
  key: K,
  column: string,
  value: string,
): Promise<RemoteTables[K] | null> {
  if ((await gate()) !== 'ok') return null
  const [entity, map] = FETCHERS[key] as [EntityKey, (row: Row) => RemoteTables[K][number], boolean, boolean?]
  const table = TABLE_FOR[entity]
  const { data, error } = await supabase.from(table).select('*').eq(column, value)
  if (error) {
    console.warn(`[db] ${table} fetch failed:`, error.message)
    return null
  }
  return ((data as Row[]) ?? []).map(map) as RemoteTables[K]
}

export interface AuditLogPage {
  rows: AuditLogEntry[]
  /** Pass as `before` to load the next (older) page; unset at the end. */
  nextBefore?: number
  /** The audit_log table isn't there yet (032 not applied). */
  unavailable?: boolean
  error?: string
}

/**
 * Newest-first page of the audit log (032). Admins only — RLS returns no rows
 * to anyone else. Read on demand (Settings → Audit), never hydrated: it only
 * grows, and nobody else needs it.
 */
export async function fetchAuditLog(opts: { limit?: number; before?: number } = {}): Promise<AuditLogPage> {
  const g = await gate()
  if (g === 'local') return { rows: [], unavailable: true }
  const stop = blocked(g)
  if (stop) return { rows: [], error: stop }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), PAGE)
  let query = supabase.from(TABLE_FOR.auditLog).select('*').order('id', { ascending: false }).limit(limit)
  if (opts.before !== undefined) query = query.lt('id', opts.before)
  const { data, error } = await query
  if (error) {
    if (isMissingRelation(error)) return { rows: [], unavailable: true }
    return { rows: [], error: error.message }
  }
  const rows = ((data as Row[]) ?? []).map(rowToAuditLogEntry)
  return { rows, nextBefore: rows.length === limit ? rows[rows.length - 1].id : undefined }
}

// ─── Workspace settings + RPCs ──────────────────────────────────────────────

/**
 * Patch the workspace_settings singleton (admins only — RLS rejects anyone
 * else, which reports like any other refused write). In issue order with the
 * other writes.
 */
export function updateWorkspaceSettings(patch: Partial<WorkspaceSettings>): Promise<void> {
  const table = TABLE_FOR.workspaceSettings
  const row = workspaceSettingsToRow(nullifyUndefined(asRecord(patch)))
  return enqueue(async () => {
    const g = await gate()
    if (g === 'local') return
    const stop = blocked(g)
    if (stop) return reportWriteError(table, 'update', stop)
    const { data, error } = await supabase.from(table).update(row).eq('id', true).select('id')
    if (error) reportWriteError(table, 'update', error.message)
    else if (!data || data.length === 0) reportWriteError(table, 'update', NO_ROW_MESSAGE)
  })
}

export interface ConvertLeadRpcResult extends ConvertLeadResult {
  /** convert_lead isn't deployed (036 not applied) — the caller may fall back. */
  missing?: boolean
  /** Remote mode is off — the caller runs the local path. */
  local?: boolean
}

/**
 * email_retry(p_email_id) (049): a failed outbound email back to 'queued',
 * which re-posts it to n8n. Behind the write queue like every write.
 */
export function retryEmail(emailId: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    void enqueue(async () => {
      try {
        const g = await gate()
        if (g === 'local') return resolve({ ok: false, error: 'local' })
        const stop = blocked(g)
        if (stop) return resolve({ ok: false, error: stop })
        const { data, error } = await supabase.rpc('email_retry', { p_email_id: emailId })
        if (error) return resolve({ ok: false, error: error.message })
        const out = (data ?? {}) as { ok?: boolean; reason?: string }
        resolve(out.ok ? { ok: true } : { ok: false, error: out.reason ?? 'refused' })
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : 'failed' })
      }
    })
  })
}

/**
 * convert_lead(p_lead_id, p_service) (036): client + project + starter tasks
 * in one transaction, permission-checked and idempotent on the server. Runs
 * behind the write queue, so the lead (and any edits to it) has landed first.
 */
export function convertLead(leadId: string, service?: string): Promise<ConvertLeadRpcResult> {
  return new Promise((resolve) => {
    void enqueue(async () => {
      try {
        const g = await gate()
        if (g === 'local') return resolve({ ok: false, local: true })
        const stop = blocked(g)
        if (stop) return resolve({ ok: false, error: stop })
        const { data, error } = await supabase.rpc('convert_lead', {
          p_lead_id: leadId,
          p_service: service ?? null,
        })
        if (error) {
          if (isMissingFunction(error)) return resolve({ ok: false, missing: true })
          console.warn('[db] convert_lead failed:', error.message)
          return resolve({ ok: false, error: error.message })
        }
        const out = (data ?? {}) as { client_id?: string; project_id?: string }
        if (!out.client_id) return resolve({ ok: false, error: 'The server did not return the new client.' })
        resolve({ ok: true, clientId: out.client_id, projectId: out.project_id ?? undefined })
      } catch (err) {
        // A thrown fetch must still answer the caller, who is awaiting this.
        resolve({ ok: false, error: looksOffline(err) ? OFFLINE_MESSAGE : 'Could not reach the server.' })
      }
    })
  })
}

/** Awaited saves: an unconfirmed financial record must never look persisted. */
export async function saveProjectEngagement(projectId: string, version: number, terms: EngagementTerms): Promise<{ record?: ProjectEngagement; error?: string }> {
  const g = await gate()
  if (g !== 'ok') return { error: blocked(g) ?? 'Remote persistence is not configured.' }
  await flush()
  try {
    const { data, error } = await supabase.rpc('save_project_engagement', { p_project_id: projectId, p_version: version, p_terms: terms })
    if (error) return { error: isMissingFunction(error) ? 'Engagement tracking is not enabled on this database yet.' : error.message }
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || row.project_id !== projectId || row.version !== version + 1 || !row.terms || typeof row.terms !== 'object') return { error: 'The server did not confirm this save.' }
    return { record: rowToProjectEngagement(row) }
  } catch {
    return { error: 'Could not reach the server. Reconnect and retry.' }
  }
}
