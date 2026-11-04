import type {
  User, ClientCategory, Client, ProjectCategory, Project,
  Task, TaskActivity, TimeEntry,
  CrmTable, CrmColumn, CrmRow,
  EventItem, Notification, EodReport, Campaign, JobPosting, Lead, LeadActivity,
  Course, CourseModule, CourseTopic, MeetingRecording, RecordingFolder,
  Conversation, ChatMessage, ConversationRead,
  ChannelCategory, Channel, ChannelMessage, ChannelReaction, ChannelRead,
  ShowcaseItem, EventAttendee, SiteSubscriber, AuditLogEntry, WorkspaceSettings, ProjectEngagement,
  FormResponse, Email,
} from './types'

// ─── Entity → table map ─────────────────────────────────────────────────────

export type EntityKey =
  | 'users'
  | 'clientCategories'
  | 'clients'
  | 'projectCategories'
  | 'projects'
  | 'projectEngagements'
  | 'tasks'
  | 'taskActivity'
  | 'timeEntries'
  | 'crmTables'
  | 'crmColumns'
  | 'crmRows'
  | 'events'
  | 'notifications'
  | 'eodReports'
  | 'campaigns'
  | 'jobPostings'
  | 'leads'
  | 'leadActivity'
  | 'courses'
  | 'courseModules'
  | 'courseTopics'
  | 'recordingFolders'
  | 'meetingRecordings'
  | 'conversations'
  | 'messages'
  | 'conversationReads'
  | 'channelCategories'
  | 'channels'
  | 'channelMessages'
  | 'channelReactions'
  | 'channelReads'
  | 'showcaseItems'
  | 'eventAttendees'
  | 'siteSubscribers'
  | 'formResponses'
  | 'emails'
  | 'auditLog'
  | 'workspaceSettings'

/** SQL table name for each app entity. Users live in `profiles`. */
export const TABLE_FOR: Record<EntityKey, string> = {
  users: 'profiles',
  clientCategories: 'client_categories',
  clients: 'clients',
  projectCategories: 'project_categories',
  projects: 'projects',
  projectEngagements: 'project_engagements',
  tasks: 'tasks',
  taskActivity: 'task_activity',
  timeEntries: 'time_entries',
  crmTables: 'crm_tables',
  crmColumns: 'crm_columns',
  crmRows: 'crm_rows',
  events: 'events',
  notifications: 'notifications',
  eodReports: 'eod_reports',
  campaigns: 'campaigns',
  jobPostings: 'job_postings',
  leads: 'leads',
  leadActivity: 'lead_activity',
  courses: 'courses',
  courseModules: 'course_modules',
  courseTopics: 'course_topics',
  recordingFolders: 'recording_folders',
  meetingRecordings: 'meeting_recordings',
  conversations: 'conversations',
  messages: 'messages',
  conversationReads: 'conversation_reads',
  channelCategories: 'channel_categories',
  channels: 'channels',
  channelMessages: 'channel_messages',
  channelReactions: 'channel_reactions',
  channelReads: 'channel_reads',
  showcaseItems: 'showcase_items',
  eventAttendees: 'event_attendees',
  siteSubscribers: 'site_subscribers',
  formResponses: 'form_responses',
  emails: 'emails',
  auditLog: 'audit_log',
  workspaceSettings: 'workspace_settings',
}

// ─── Generic key conversion (shallow — jsonb payloads pass through) ─────────

type Row = Record<string, unknown>

const snake = (key: string): string =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

const camel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function keysToSnake(obj: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    out[snake(k)] = v
  }
  return out
}

function keysToCamel(obj: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(obj)) {
    out[camel(k)] = v === null ? undefined : v
  }
  return out
}

// ─── Typed per-entity mappers ────────────────────────────────────────────────

/** Drop fields the database owns (generated columns, trigger stamps) from a write. */
function without(obj: Row, keys: readonly string[]): Row {
  const out = { ...obj }
  for (const k of keys) delete out[k]
  return out
}

export const rowToUser = (r: Row): User => keysToCamel(r) as unknown as User
/**
 * Never syncs the local-mode `password` field to the profiles table, nor the
 * deactivation stamps — offboarding goes through the admin-users function.
 */
export const userToRow = (u: Partial<User>): Row =>
  keysToSnake(without(u as Row, ['password', 'deactivatedAt', 'deactivatedBy']))

export const rowToClientCategory = (r: Row): ClientCategory => keysToCamel(r) as unknown as ClientCategory
export const clientCategoryToRow = (c: Partial<ClientCategory>): Row => keysToSnake(c)

export const rowToClient = (r: Row): Client => keysToCamel(r) as unknown as Client
export const clientToRow = (c: Partial<Client>): Row => keysToSnake(c)

export const rowToProjectCategory = (r: Row): ProjectCategory => keysToCamel(r) as unknown as ProjectCategory
export const projectCategoryToRow = (p: Partial<ProjectCategory>): Row => keysToSnake(p)

export const rowToProject = (r: Row): Project => keysToCamel(r) as unknown as Project
export const projectToRow = (p: Partial<Project>): Row => keysToSnake(p)

export const rowToProjectEngagement = (r: Row): ProjectEngagement => keysToCamel(r) as unknown as ProjectEngagement

export const rowToTask = (r: Row): Task => keysToCamel(r) as unknown as Task
export const taskToRow = (t: Partial<Task>): Row => keysToSnake(t)

export const rowToTaskActivity = (r: Row): TaskActivity => keysToCamel(r) as unknown as TaskActivity
export const taskActivityToRow = (a: Partial<TaskActivity>): Row => keysToSnake(a)

export const rowToTimeEntry = (r: Row): TimeEntry => keysToCamel(r) as unknown as TimeEntry
export const timeEntryToRow = (t: Partial<TimeEntry>): Row => keysToSnake(t)

export const rowToCrmTable = (r: Row): CrmTable => keysToCamel(r) as unknown as CrmTable
export const crmTableToRow = (t: Partial<CrmTable>): Row => keysToSnake(t)

export const rowToCrmColumn = (r: Row): CrmColumn => keysToCamel(r) as unknown as CrmColumn
export const crmColumnToRow = (c: Partial<CrmColumn>): Row => keysToSnake(c)

export const rowToCrmRow = (r: Row): CrmRow => keysToCamel(r) as unknown as CrmRow
export const crmRowToRow = (c: Partial<CrmRow>): Row => keysToSnake(c)

export const rowToEvent = (r: Row): EventItem => keysToCamel(r) as unknown as EventItem
/** The Google link fields are written by the sync function alone (040). */
const EVENT_SERVER_FIELDS = ['googleEventId', 'googleEtag', 'syncStatus', 'syncError'] as const
export const eventToRow = (e: Partial<EventItem>): Row => keysToSnake(without(e as Row, EVENT_SERVER_FIELDS))

export const rowToEventAttendee = (r: Row): EventAttendee => keysToCamel(r) as unknown as EventAttendee
export const eventAttendeeToRow = (a: Partial<EventAttendee>): Row => keysToSnake(a)

export const rowToNotification = (r: Row): Notification => keysToCamel(r) as unknown as Notification
export const notificationToRow = (n: Partial<Notification>): Row => keysToSnake(n)

export const rowToEodReport = (r: Row): EodReport => keysToCamel(r) as unknown as EodReport
export const eodReportToRow = (e: Partial<EodReport>): Row => keysToSnake(e)

export const rowToCampaign = (r: Row): Campaign => keysToCamel(r) as unknown as Campaign
export const campaignToRow = (c: Partial<Campaign>): Row => keysToSnake(c)

export const rowToJobPosting = (r: Row): JobPosting => keysToCamel(r) as unknown as JobPosting
export const jobPostingToRow = (j: Partial<JobPosting>): Row => keysToSnake(j)

export const rowToCourse = (r: Row): Course => keysToCamel(r) as unknown as Course
export const courseToRow = (c: Partial<Course>): Row => keysToSnake(c)

export const rowToCourseModule = (r: Row): CourseModule => keysToCamel(r) as unknown as CourseModule
export const courseModuleToRow = (m: Partial<CourseModule>): Row => keysToSnake(m)

export const rowToCourseTopic = (r: Row): CourseTopic => keysToCamel(r) as unknown as CourseTopic
export const courseTopicToRow = (t: Partial<CourseTopic>): Row => keysToSnake(t)
export const rowToRecordingFolder = (r: Row): RecordingFolder => keysToCamel(r) as unknown as RecordingFolder
export const rowToMeetingRecording = (r: Row): MeetingRecording => keysToCamel(r) as unknown as MeetingRecording

export const rowToLead = (r: Row): Lead => keysToCamel(r) as unknown as Lead
/**
 * email_norm is a generated column (naming it in a write is an error), and
 * pii_scrubbed_at belongs to the retention job (039).
 */
const LEAD_SERVER_FIELDS = ['emailNorm', 'piiScrubbedAt'] as const
export const leadToRow = (l: Partial<Lead>): Row => keysToSnake(without(l as Row, LEAD_SERVER_FIELDS))

// ─── Showcase, subscribers, audit log, workspace settings ───────────────────

export const rowToShowcaseItem = (r: Row): ShowcaseItem => {
  const item = keysToCamel(r) as unknown as ShowcaseItem
  // NOT NULL on the server, but a row from an older select or a realtime
  // payload missing a column must not crash a .map() over the stack.
  return {
    ...item,
    stack: Array.isArray(item.stack) ? item.stack : [],
    linkPublic: item.linkPublic ?? true,
    featured: item.featured ?? false,
    homeFeatured: item.homeFeatured ?? false,
    sortOrder: item.sortOrder ?? 0,
    linkStatus: item.linkStatus ?? 'unknown',
    linkFailCount: item.linkFailCount ?? 0,
    consent: item.consent ?? 'unknown',
  }
}
/**
 * The guard trigger (037) stamps who published and when, and derives
 * public_url from url + link_public on every write.
 */
const SHOWCASE_SERVER_FIELDS = ['publishedAt', 'publishedBy', 'publicUrl'] as const
export const showcaseItemToRow = (i: Partial<ShowcaseItem>): Row =>
  keysToSnake(without(i as Row, SHOWCASE_SERVER_FIELDS))

export const rowToSiteSubscriber = (r: Row): SiteSubscriber => keysToCamel(r) as unknown as SiteSubscriber
/**
 * Staff may only change unsubscribed_at (039's column grant); everything else
 * is the intake function's. Any other key in a write would be refused.
 */
export const siteSubscriberToRow = (sub: Partial<SiteSubscriber>): Row =>
  'unsubscribedAt' in sub ? { unsubscribed_at: sub.unsubscribedAt ?? null } : {}

// Shallow, so `answers` (field keys, not columns) passes through as stored.
export const rowToFormResponse = (r: Row): FormResponse => keysToCamel(r) as unknown as FormResponse
/** to/cc arrive as Postgres arrays; a NULL cc is an empty list. */
export const rowToEmail = (r: Row): Email => {
  const e = keysToCamel(r) as unknown as Email
  return { ...e, toEmails: e.toEmails ?? [], ccEmails: e.ccEmails ?? [] }
}

export const rowToAuditLogEntry = (r: Row): AuditLogEntry => {
  const e = keysToCamel(r) as unknown as AuditLogEntry
  return { ...e, detail: e.detail ?? {} }
}

/**
 * The SQL column defaults of workspace_settings (033). Local mode starts
 * here, and a remote row missing a column falls back to the same value.
 */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  growthSlaMinutes: 60,
  growthEscalateMinutes: 240,
  growthBusinessHours: { tz: 'Asia/Manila', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  growthOwnerPool: [],
  growthNotifyAll: true,
  growthAutoReply: false,
  growthStaleDays: 14,
  showcaseAutoPublish: false,
  bookingEnabled: false,
  bookingTitle: 'Discovery call',
  bookingMinutes: 30,
  bookingNoticeMinutes: 240,
  bookingDaysAhead: 14,
  bookingBufferMinutes: 10,
  emailFromName: 'NixGen Solutions',
}

/** The singleton row → app object. Its `id` (always true) is dropped. */
export const rowToWorkspaceSettings = (r: Row): WorkspaceSettings => {
  const rest = without(keysToCamel(r), ['id']) as Partial<WorkspaceSettings>
  const merged = { ...DEFAULT_WORKSPACE_SETTINGS }
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v
  }
  return merged
}
/** id is the primary key (always true) and updated_at belongs to the trigger. */
export const workspaceSettingsToRow = (w: Partial<WorkspaceSettings>): Row =>
  keysToSnake(without(w as Row, ['id', 'updatedAt']))

export const rowToLeadActivity = (r: Row): LeadActivity => keysToCamel(r) as unknown as LeadActivity
export const leadActivityToRow = (a: Partial<LeadActivity>): Row => keysToSnake(a)

export const rowToConversation = (r: Row): Conversation => keysToCamel(r) as unknown as Conversation
export const conversationToRow = (c: Partial<Conversation>): Row => keysToSnake(c)

export const rowToChatMessage = (r: Row): ChatMessage => keysToCamel(r) as unknown as ChatMessage
export const chatMessageToRow = (m: Partial<ChatMessage>): Row => keysToSnake(m)

export const rowToConversationRead = (r: Row): ConversationRead => keysToCamel(r) as unknown as ConversationRead
export const conversationReadToRow = (c: Partial<ConversationRead>): Row => keysToSnake(c)

export const rowToChannelCategory = (r: Row): ChannelCategory => keysToCamel(r) as unknown as ChannelCategory
export const rowToChannel = (r: Row): Channel => keysToCamel(r) as unknown as Channel
export const rowToChannelMessage = (r: Row): ChannelMessage => keysToCamel(r) as unknown as ChannelMessage
export const rowToChannelReaction = (r: Row): ChannelReaction => keysToCamel(r) as unknown as ChannelReaction
export const rowToChannelRead = (r: Row): ChannelRead => keysToCamel(r) as unknown as ChannelRead

// ─── Generic dispatch used by the db adapter ─────────────────────────────────

const TO_ROW: Record<EntityKey, (obj: Row) => Row> = {
  users: (o) => userToRow(o as Partial<User>),
  clientCategories: keysToSnake,
  clients: keysToSnake,
  projectCategories: keysToSnake,
  projects: keysToSnake,
  projectEngagements: keysToSnake,
  tasks: keysToSnake,
  taskActivity: keysToSnake,
  timeEntries: keysToSnake,
  crmTables: keysToSnake,
  crmColumns: keysToSnake,
  crmRows: keysToSnake,
  events: (o) => eventToRow(o as Partial<EventItem>),
  notifications: keysToSnake,
  eodReports: keysToSnake,
  campaigns: keysToSnake,
  jobPostings: keysToSnake,
  leads: (o) => leadToRow(o as Partial<Lead>),
  leadActivity: keysToSnake,
  courses: keysToSnake,
  courseModules: keysToSnake,
  courseTopics: keysToSnake,
  recordingFolders: keysToSnake,
  meetingRecordings: keysToSnake,
  conversations: keysToSnake,
  messages: keysToSnake,
  conversationReads: keysToSnake,
  channelCategories: keysToSnake,
  channels: keysToSnake,
  channelMessages: keysToSnake,
  channelReactions: keysToSnake,
  channelReads: keysToSnake,
  showcaseItems: (o) => showcaseItemToRow(o as Partial<ShowcaseItem>),
  eventAttendees: keysToSnake,
  siteSubscribers: (o) => siteSubscriberToRow(o as Partial<SiteSubscriber>),
  formResponses: keysToSnake,
  emails: keysToSnake,
  auditLog: keysToSnake,
  workspaceSettings: (o) => workspaceSettingsToRow(o as Partial<WorkspaceSettings>),
}

/** Convert an app object (camelCase) into an SQL row (snake_case). */
export function toRow(entity: EntityKey, obj: Row): Row {
  return TO_ROW[entity](obj)
}

/** Convert an SQL row (snake_case) into an app object (camelCase). */
export function fromRow(entity: EntityKey, row: Row): Row {
  void entity
  return keysToCamel(row)
}
