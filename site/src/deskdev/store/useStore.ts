import { oljLinks } from '../lib/applications'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  User, ClientCategory, Client, ProjectCategory, Project,
  Task, TaskActivity, TimeEntry,
  CrmTable, CrmColumn, CrmRow, CrmCellValue,
  EventItem, Notification, NotificationType,
  EodReport, Campaign, JobPosting, Lead, LeadStage, LeadActivity, LeadLostReason, LeadAction,
  ProjectStatus, TaskStatus, PermFeature,
  Course, CourseModule, CourseTopic, MeetingRecording, RecordingFolder,
  Conversation, ChatMessage, ConversationRead,
  ChannelCategory, Channel, ChannelKind, ChannelMessage, ChannelReaction, ChannelRead,
  ShowcaseItem, ShowcaseStatus, EventAttendee, SiteSubscriber, AuditLogEntry,
  WorkspaceSettings, ConvertLeadResult, FormResponse, ProjectPhase, Email,
  ProjectEngagement, EngagementTerms,
} from '../lib/types'
import * as db from '../lib/db'
import { validateClient, validateProject, validateTask } from './entityValidation'
import { engagementError } from '../lib/engagements'
import * as adminUsers from '../lib/adminUsers'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { rowToUser, DEFAULT_WORKSPACE_SETTINGS } from '../lib/mappers'
import { DEFAULT_MEMBER_PERMISSIONS, can, isAdmin, isDeactivated } from '../lib/permissions'
import {
  HOT_SCORE, convertedProjectTitle, isOpenLead, isValidBusinessHours, normalizeService, scoreLead, starterTasksFor,
} from '../lib/leads'
import { consentAllowsPublishing, isHttpsUrl, showcaseStatusError, uniqueSlug } from '../lib/showcase'
import { canCompleteTask, cleanCollaborators } from '../lib/tasks'
import { FORM_TEMPLATES, bindingsOf, cleanAnswers, fieldError, formFields, missingRequired } from '../lib/forms'
import { PHASE_LABEL, phaseOf, statusConflict, statusOnEntering } from '../lib/projectPhase'
import { FORM_LINK_DAYS, formLinkUrl, newFormToken, sha256Hex } from '../lib/quickForm'
import { draftError, parseAddresses } from '../lib/email'
import { newId, persistStorage, signOutCleanup } from '../lib/platform'
import { findDirectConversation, lastMessageOf, lastReadAt, MAX_MESSAGE_LENGTH } from '../lib/chat'
import {
  canManageCategory, canManageChannel, canPostInChannel, canViewChannel, channelLastReadAt, channelMembers,
  encodeMentions, isValidChannelName, latestChannelMessage, mentionedUserIds, nextChannelPosition,
  plainPreview, slugifyChannelName, MAX_CHANNEL_MESSAGE_LENGTH, MAX_CHANNEL_TOPIC_LENGTH,
} from '../lib/channels'
import { isoDate, fmtRelative } from '../lib/format'
import {
  seedUsers, seedClientCategories, seedClients, seedProjectCategories,
  seedProjects, seedTasks, seedTaskActivity, seedTimeEntries,
  seedCrmTables, seedCrmColumns, seedCrmRows, seedEvents, seedNotifications,
  seedCampaigns, seedLeads, seedJobPostings, seedLeadActivity,
  seedChannelCategories, seedChannels, seedChannelMessages, seedShowcaseItems,
  seedRecordingFolders, seedMeetingRecordings,
} from '../data/seed'

// ─── Input types (create payloads — generated fields are optional) ──────────

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type NewUser = Optional<Omit<User, 'id' | 'createdAt'>, 'role' | 'permissions'>
export type NewClientCategory = Optional<Omit<ClientCategory, 'id' | 'createdAt'>, 'sortOrder'>
export type NewClient = Optional<Omit<Client, 'id' | 'createdAt' | 'updatedAt'>, 'engagement' | 'status'>
export type NewProjectCategory = Optional<Omit<ProjectCategory, 'id'>, 'sortOrder'>
export type NewProject = Optional<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>, 'status' | 'position'>
export type NewTask = Optional<
  Omit<Task, 'id' | 'createdAt' | 'updatedAt'>,
  'status' | 'priority' | 'position' | 'archived'
>
export type NewTimeEntry = Omit<TimeEntry, 'id' | 'createdAt'>
export type NewCrmTable = Omit<CrmTable, 'id' | 'createdAt' | 'updatedAt'>
export type NewCrmColumn = Optional<Omit<CrmColumn, 'id'>, 'options' | 'sortOrder'>
export type NewCrmRow = Optional<Omit<CrmRow, 'id' | 'createdAt' | 'updatedAt'>, 'values' | 'position'>
export type NewEvent = Optional<
  Omit<EventItem, 'id' | 'createdAt' | 'updatedAt'>,
  'kind' | 'allDay' | 'recurrence'
>
export type NewCampaign = Optional<
  Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>,
  'status' | 'contacted' | 'opens' | 'replies' | 'positive'
>
export type NewLead = Optional<
  Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>,
  'stage' | 'value' | 'source' | 'hot'
>

/** Every showcase field the server would default can be left out. */
export type NewShowcaseItem = Optional<
  Omit<ShowcaseItem, 'id' | 'createdAt' | 'updatedAt' | 'publishedAt' | 'publishedBy'>,
  | 'slug' | 'kind' | 'linkPublic' | 'stack' | 'status' | 'featured' | 'homeFeatured'
  | 'sortOrder' | 'consent' | 'linkStatus' | 'linkFailCount'
>

export type ShowcasePatch = Partial<Omit<ShowcaseItem, 'id' | 'createdAt' | 'publishedAt' | 'publishedBy'>>

/** An invitee for setEventAttendees: a teammate, or anyone by email. */
export interface AttendeeInput {
  profileId?: string
  email: string
}

/** What saveFormResponse takes: one response per form and target (project, else lead, else client). */
export interface SaveFormInput {
  form: string
  projectId?: string
  clientId?: string
  leadId?: string
  answers: Record<string, unknown>
  /** Mark it submitted: required answers are checked and bound answers written back. */
  submit?: boolean
}

/** What sendEmail takes. One anchor at least: the email lives on that lead / client / project. */
export interface SendEmailInput {
  to: string[]
  cc?: string[]
  subject: string
  body: string
  leadId?: string
  clientId?: string
  projectId?: string
  /** The email being answered (keeps the Gmail thread). */
  inReplyTo?: string
}

/** Outbound touches the LeadDrawer logs; each one stops the reply clock. */
export type LeadTouchAction = Extract<
  LeadAction,
  'contacted' | 'call_logged' | 'email_sent' | 'booking_link_sent' | 'proposal_sent' | 'meeting_booked'
>

/** Result of an awaited store action that can be refused. */
export interface ActionResult {
  ok: boolean
  error?: string
}

export type NewCourse = Optional<
  Omit<Course, 'id' | 'createdAt' | 'updatedAt'>,
  'description' | 'position' | 'createdBy'
>
export type NewCourseModule = Optional<
  Omit<CourseModule, 'id' | 'createdAt' | 'updatedAt'>,
  'position'
>
export type NewMeetingRecording = Omit<MeetingRecording, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>
export type NewCourseTopic = Optional<
  Omit<CourseTopic, 'id' | 'createdAt' | 'updatedAt'>,
  'summary' | 'sopVideoUrl' | 'sopThumbnailUrl' | 'notes' | 'position'
>

export interface NewChannel {
  /** Free text — slugified ("Client Updates" → "client-updates"). */
  name: string
  /** The space: a client id, or unset for the studio. */
  clientId?: string
  topic?: string
  kind?: ChannelKind
  categoryId?: string
  isPrivate?: boolean
  /** Private channels only; the creator is always added. */
  memberIds?: string[]
}

export type ChannelPatch = Partial<Pick<Channel, 'name' | 'topic' | 'kind' | 'categoryId' | 'isPrivate' | 'memberIds'>>

export interface NotifyInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  actorId?: string
  entity?: string
  entityId?: string
}

/** Mobile's theme override (the web app follows the site's theme instead). */
export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  autoArchiveDays: number
  workspaceName: string
  /** Mobile-only: theme override persisted with the store. */
  themeMode?: ThemeMode
  /**
   * Growth Hub goal: new clients to win this month.
   * @deprecated Mirror of workspaceSettings.growthMonthlyClientTarget, kept so
   * existing screens keep reading it; write through updateWorkspaceSettings.
   */
  monthlyClientTarget?: number
  /** Growth Hub goal: accounts to contact per week. (Still browser-local.) */
  weeklyOutreachTarget?: number
  /**
   * Days without a touch before an open lead counts as "going cold".
   * @deprecated Mirror of workspaceSettings.growthStaleDays (see above).
   */
  staleLeadDays?: number
  /**
   * This browser's old local Growth values have been carried into
   * workspace_settings (or were found to be already superseded there).
   */
  growthSettingsMigrated?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
}

export interface AdminActionResult {
  ok: boolean
  /** Id of the created/updated/deleted user — set on success. */
  id?: string
  error?: string
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

const nowIso = (): string => new Date().toISOString()

/**
 * A recording as 058 files it: a project decides the client, and a category
 * only holds its own client's recordings. Refuses a missing title or a link
 * that isn't https.
 */
function fileRecording<T extends NewMeetingRecording>(
  input: T,
  s: { projects: { id: string; clientId: string }[]; recordingFolders: RecordingFolder[] },
): T {
  const title = input.title.trim()
  const url = input.url.trim()
  if (!title || title.length > 200) throw new Error('Give the recording a title of up to 200 characters.')
  if (!/^https:\/\/\S+$/i.test(url) || url.length > 2000) throw new Error('Paste the full https:// link to the recording.')
  const project = input.projectId ? s.projects.find((p) => p.id === input.projectId) : undefined
  const clientId = project?.clientId ?? input.clientId
  const folder = input.folderId ? s.recordingFolders.find((f) => f.id === input.folderId) : undefined
  return { ...input, title, url, clientId, projectId: project?.id, folderId: folder && folder.clientId === clientId ? folder.id : undefined }
}
const uid = (): string => newId()

// ─── Store shape ─────────────────────────────────────────────────────────────

interface State {
  // auth
  users: User[]
  currentUserId: string | null

  // entities
  clients: Client[]
  clientCategories: ClientCategory[]
  projects: Project[]
  projectEngagements: ProjectEngagement[]
  saveEngagement: (projectId: string, version: number, terms: EngagementTerms) => Promise<ActionResult>
  projectCategories: ProjectCategory[]
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
  jobPostings: JobPosting[]
  leads: Lead[]
  leadActivity: LeadActivity[]
  showcaseItems: ShowcaseItem[]
  eventAttendees: EventAttendee[]
  siteSubscribers: SiteSubscriber[]
  formResponses: FormResponse[]
  emails: Email[]
  /** Admins only, loaded on demand by loadAuditLog() — newest first. */
  auditLog: AuditLogEntry[]

  /** The workspace_settings singleton (033): server-side, shared by everyone. */
  workspaceSettings: WorkspaceSettings
  settings: Settings
  /** The first hydrate() has finished — pages render, whatever it found. */
  hydrated: boolean
  /**
   * A pull has really reached the server (local mode: hydrate() ran). Unlike
   * `hydrated` it stays false through an offline start, so "what's new" logic
   * never mistakes the first real pull for a burst of news.
   */
  synced: boolean
  /** Tables the last pull couldn't load (RemoteData keys), or null — pages can offer a retry. */
  loadError: string[] | null
  lastReminderCheck: string | null
  remindedIds: string[]

  // lifecycle
  /** Pull everything. Single-flight: a call while one is running joins it. */
  hydrate: () => Promise<void>
  resetSeed: () => void
  /**
   * Browser-local preferences. The two Growth values in it (staleLeadDays,
   * monthlyClientTarget) are forwarded to updateWorkspaceSettings.
   */
  updateSettings: (patch: Partial<Settings>) => void
  /** Admins only. Returns false (and changes nothing) for anyone else. */
  updateWorkspaceSettings: (patch: Partial<WorkspaceSettings>) => boolean

  // auth
  login: (email: string, password: string) => Promise<LoginResult>
  /** Remote mode: make an established Supabase session (password sign-in or
   *  the site's Team-login handoff) the current user, loading their profile. */
  adoptSession: (userId: string) => Promise<void>
  /**
   * Remote mode: the session now belongs to a different user than the app's
   * current one (another tab or window signed another account in on this
   * browser). Drops the previous user's workspace and adopts the session's
   * user; the caller pulls again. True when it switched.
   */
  syncSessionUser: (sessionUserId: string) => Promise<boolean>
  /** Remote mode removes this device's push row, then signs out this device only. */
  logout: () => Promise<void>
  addUser: (input: NewUser) => string
  updateUser: (id: string, patch: Partial<User>) => void
  saveOwnProfile: (patch: Pick<User, 'fullName' | 'phone' | 'title' | 'avatarColor'>) => Promise<{ ok: boolean; error?: string }>
  /**
   * Admins only (052): set or clear (null) the picture of a profile or a
   * client. The upload itself is the caller's (lib/avatarImages on web).
   */
  setPicture: (owner: { kind: 'profiles' | 'clients'; id: string }, key: string | null) => ActionResult
  deleteUser: (id: string) => void
  // Admin user management (Settings → Users) — remote mode goes through the
  // admin-users edge function and rolls back on failure; local mode delegates
  // to the sync actions above.
  adminCreateUser: (input: NewUser) => Promise<AdminActionResult>
  adminUpdateUser: (id: string, patch: Partial<User>) => Promise<AdminActionResult>
  adminDeleteUser: (id: string) => Promise<AdminActionResult>
  /**
   * Offboard, keeping history (032): blocks sign-in, strips role and
   * permissions, stamps deactivatedAt. Hard delete stays for test accounts.
   */
  adminDeactivateUser: (id: string) => Promise<AdminActionResult>
  /** Lets them sign in again as a member with no permissions. */
  adminReactivateUser: (id: string) => Promise<AdminActionResult>
  /** Admins: pull the newest audit rows, or (`more`) the next older page. */
  loadAuditLog: (opts?: { more?: boolean }) => Promise<ActionResult & { hasMore: boolean; unavailable?: boolean }>

  // clients
  addClient: (input: NewClient) => string
  updateClient: (id: string, patch: Partial<Client>) => void
  deleteClient: (id: string) => Promise<ActionResult>
  addClientCategory: (input: NewClientCategory) => string
  updateClientCategory: (id: string, patch: Partial<ClientCategory>) => void
  deleteClientCategory: (id: string) => void

  // projects
  addProject: (input: NewProject) => string
  /** Refuses a status the project's stage rules out (lib/projectPhase statusConflict). */
  updateProject: (id: string, patch: Partial<Project>) => ActionResult
  /** Same stage rule as updateProject: Done comes from launching, not from a move. */
  moveProject: (id: string, status: ProjectStatus, position: number) => ActionResult
  deleteProject: (id: string) => Promise<ActionResult>
  addProjectCategory: (input: NewProjectCategory) => string
  updateProjectCategory: (id: string, patch: Partial<ProjectCategory>) => void
  deleteProjectCategory: (id: string) => void

  // tasks
  addTaskComment: (taskId: string, body: string) => Promise<boolean>
  addTask: (input: NewTask) => string
  updateTask: (id: string, patch: Partial<Task>) => void
  /**
   * Returns whether the task ended up in `status` — false when open subtasks
   * block completion (see lib/tasks.ts), true when it was already there.
   */
  setTaskStatus: (id: string, status: TaskStatus) => boolean
  /** Returns false (and moves nothing) when open subtasks block completion. */
  moveTask: (id: string, status: TaskStatus, position: number) => boolean
  deleteTask: (id: string) => void

  // time entries
  addTimeEntry: (input: NewTimeEntry) => string
  updateTimeEntry: (id: string, patch: Partial<TimeEntry>) => void
  deleteTimeEntry: (id: string) => void

  // crm
  addCrmTable: (input: NewCrmTable) => string
  updateCrmTable: (id: string, patch: Partial<CrmTable>) => void
  deleteCrmTable: (id: string) => void
  addCrmColumn: (input: NewCrmColumn) => string
  updateCrmColumn: (id: string, patch: Partial<CrmColumn>) => void
  deleteCrmColumn: (id: string) => void
  reorderColumns: (tableId: string, orderedIds: string[]) => void
  addCrmRow: (input: NewCrmRow) => string
  updateCrmRow: (id: string, patch: Partial<CrmRow>) => void
  deleteCrmRow: (id: string) => void
  setCellValue: (rowId: string, columnId: string, value: CrmCellValue) => void

  // events
  addEvent: (input: NewEvent) => string
  updateEvent: (id: string, patch: Partial<EventItem>) => void
  deleteEvent: (id: string) => void
  /**
   * Replace an event's invitee list: new people are added, missing ones
   * removed, existing RSVPs kept. Returns false without edit access.
   */
  setEventAttendees: (eventId: string, attendees: AttendeeInput[]) => boolean

  // notifications
  notify: (input: NotifyInput) => void
  markRead: (id: string) => void
  markAllRead: () => void
  deleteNotification: (id: string) => void

  // chat — open to every profile; rows are scoped to participants
  /**
   * Open a conversation with `participantIds` (the current user is added).
   * One other person and no title reuses the existing DM. Returns its id, or
   * null when signed out or nobody else was picked.
   */
  startConversation: (participantIds: string[], title?: string) => string | null
  /** Returns the new message id, or null for an empty body / non-member. */
  sendMessage: (conversationId: string, body: string, replyToId?: string) => string | null
  sendMessageConfirmed: (conversationId: string, body: string, replyToId?: string) => Promise<string | null>
  editMessage: (id: string, body: string) => void
  deleteMessage: (id: string) => void
  /** Move the current user's read marker to the latest message. */
  markConversationRead: (conversationId: string) => void
  renameConversation: (id: string, title: string) => void
  deleteConversation: (id: string) => void

  // channels — Discord-style rooms; see lib/channels.ts for who may do what
  /** Returns the new category id, or null for a blank name / signed out. */
  createChannelCategory: (name: string, clientId?: string) => string | null
  renameChannelCategory: (id: string, name: string) => void
  /** Its channels survive, uncategorised. */
  deleteChannelCategory: (id: string) => void
  /** Returns the new channel id, or null for an invalid name / signed out. */
  createChannel: (input: NewChannel) => string | null
  updateChannel: (id: string, patch: ChannelPatch) => void
  deleteChannel: (id: string) => void
  /** Returns the new message id, or null when empty or not allowed to post. */
  sendChannelMessage: (channelId: string, body: string, replyToId?: string) => string | null
  sendChannelMessageConfirmed: (channelId: string, body: string, replyToId?: string) => Promise<string | null>
  editChannelMessage: (id: string, body: string) => void
  deleteChannelMessage: (id: string) => void
  togglePinChannelMessage: (id: string) => void
  toggleChannelReaction: (messageId: string, emoji: string) => void
  /** Move the current user's read marker past the channel's latest message. */
  markChannelRead: (channelId: string) => void

  // eod reports — persist a rendered End-of-Day report (one per author/client/day)
  saveEodReport: (input: { clientId: string; reportDate: string; content: string; totalMinutes: number }) => void

  // courses: training library (Course → Module → Topic, topic carries one SOP video)
  addCourse: (input: NewCourse) => string
  updateCourse: (id: string, patch: Partial<Course>) => void
  deleteCourse: (id: string) => void
  addCourseModule: (input: NewCourseModule) => string
  updateCourseModule: (id: string, patch: Partial<CourseModule>) => void
  deleteCourseModule: (id: string) => void
  addCourseTopic: (input: NewCourseTopic) => string
  updateCourseTopic: (id: string, patch: Partial<CourseTopic>) => void
  deleteCourseTopic: (id: string) => void

  // Meeting recordings (058) — meetings:edit. A client's category; a recording.
  addRecordingFolder: (input: { clientId: string; name: string }) => string
  renameRecordingFolder: (id: string, name: string) => void
  deleteRecordingFolder: (id: string) => void
  addRecording: (input: NewMeetingRecording) => string
  updateRecording: (id: string, patch: Partial<NewMeetingRecording>) => void
  deleteRecording: (id: string) => void

  // growth: outbound campaigns (manual tracker)
  addCampaign: (input: NewCampaign) => string
  updateCampaign: (id: string, patch: Partial<Campaign>) => void
  deleteCampaign: (id: string) => void

  // growth: leads (Growth Hub's own pipeline)
  addLead: (input: NewLead) => string
  updateLead: (id: string, patch: Partial<Lead>) => void
  /** Moves stage AND logs the event; pass a reason when moving to 'lost'. */
  moveLeadStage: (id: string, stage: LeadStage, lostReason?: LeadLostReason) => void
  /** Log an outbound touch — stamps firstRespondedAt/lastTouchAt + an event. */
  touchLead: (id: string, note?: string) => void
  deleteLead: (id: string) => void
  /** @deprecated Use convertLead — kept for screens that don't await. */
  convertLeadToClient: (id: string) => void
  /**
   * Won lead → client + project "<Company> - <service>" + starter tasks, lead
   * linked and marked won. Remote mode runs convert_lead (036) atomically on
   * the server; local mode (or a database without 036) does it here. Needs
   * growth:edit and clients:edit. Converting twice returns the same client.
   */
  convertLead: (id: string, service?: string) => Promise<ConvertLeadResult>
  /** Change the owner (unset to unassign); logs 'assigned' and tells the new owner. */
  assignLead: (id: string, ownerId: string | undefined) => boolean
  /** Quarantine (spam) or release a lead; logs spam_marked / not_spam. */
  setLeadSpam: (id: string, spam: boolean, reason?: string) => boolean
  /** Set or clear the next-touch date; logs followup_set. */
  setLeadFollowUp: (id: string, date: string | undefined) => boolean
  /**
   * Log an outbound touch (reply, call, email, booking link, proposal,
   * booked meeting): stamps first-response/last-touch, which stops the SLA
   * clock. A proposal also moves a new/contacted lead to 'proposal'.
   */
  logLeadTouch: (id: string, action: LeadTouchAction, detail?: Record<string, unknown>) => boolean
  dismissJobPosting: (id: string) => void
  importOljLinks: (urls: string[]) => Promise<{ added: number; skipped: number; failed: number }>
  saveJobApplication: (id: string, patch: Pick<JobPosting, 'application' | 'description'>) => Promise<boolean>
  /** Undo a dismiss: the posting goes back on the Job leads list. */
  restoreJobPosting: (id: string) => void

  // showcase (037) — drafting needs showcase:edit; publishing is admin-only
  /** Returns the new id, or null without edit access. Never starts published. */
  addShowcaseItem: (input: NewShowcaseItem) => string | null
  /** False when refused (no access, or a status change the rules forbid). */
  updateShowcaseItem: (id: string, patch: ShowcasePatch) => boolean
  /** Status move with the publish rules applied; returns the reason when refused. */
  setShowcaseStatus: (id: string, status: ShowcaseStatus) => ActionResult
  /** Deletes the row and its stored screenshots. A published item needs an admin. */
  deleteShowcaseItem: (id: string) => boolean
  /** Resize + upload a screenshot and attach it (replacing and cleaning up the old one). */
  setShowcaseImage: (id: string, file: Blob, alt?: string) => Promise<ActionResult>

  // forms + project stages (046)
  /**
   * Create or update the answers to `form` (lib/forms.ts) for a project, lead
   * or client — one response per target. With `submit` (or once submitted)
   * the required answers are checked, and the template's bound answers are
   * written onto the client and project. Needs edit access to the target.
   */
  saveFormResponse: (input: SaveFormInput) => ActionResult & { id?: string }
  /**
   * Move a project to a stage. Development needs the onboarding form
   * submitted, unless an admin skips it (`force`). Launched marks the work
   * done and takes the live URL, which drafts its portfolio entry. Tells the
   * assignee and the admins.
   */
  setProjectPhase: (id: string, phase: ProjectPhase, opts?: { liveUrl?: string; force?: boolean }) => ActionResult
  /**
   * A customer quick-form link (047) for the form on this project or lead:
   * a new random token whose hash is stored on the response (created with
   * `answers` as its starting point when there is none yet). Any older link
   * stops working. Resolves to the URL — shown once, never stored. Live
   * workspace only: the public form needs the database.
   */
  createFormLink: (input: {
    form: string
    projectId?: string
    leadId?: string
    sharedTo?: string
    answers?: Record<string, unknown>
  }) => Promise<ActionResult & { url?: string }>
  /** Close a response's customer link. */
  revokeFormLink: (responseId: string) => boolean

  // email (049)
  /**
   * Queue an email about a lead, client or project. n8n sends it through the
   * studio's Gmail (status queued → sending → sent | failed, back over
   * realtime); a sent email to a lead stops its reply clock (server trigger).
   * In local mode it stays queued: there is no n8n to send it.
   */
  sendEmail: (input: SendEmailInput) => ActionResult & { id?: string }
  /** Queue a failed email again (email_retry). */
  retryEmail: (id: string) => Promise<ActionResult>

  // site subscribers (039) — sign-ups arrive through the site only; staff
  // with growth:edit can unsubscribe or delete (a "forget me" request)
  /** Stamp unsubscribedAt; the row stays so a later import can't re-add them. */
  unsubscribeSubscriber: (id: string) => boolean
  /** Puts an unsubscribed address back, on the person's own verified request. Needs growth:edit. */
  resubscribeSubscriber: (id: string) => boolean
  /** Delete-on-request. The server logs it to the audit log, without the address. */
  deleteSubscriber: (id: string) => boolean

  // automation
  checkDueReminders: () => void
  sweepAutoArchive: () => void
  sweepActivity: () => void
}

const seedState = () => ({
  users: seedUsers,
  clients: seedClients,
  clientCategories: seedClientCategories,
  projects: seedProjects,
  projectEngagements: [] as ProjectEngagement[],
  projectCategories: seedProjectCategories,
  tasks: seedTasks,
  taskActivity: seedTaskActivity,
  timeEntries: seedTimeEntries,
  crmTables: seedCrmTables,
  crmColumns: seedCrmColumns,
  crmRows: seedCrmRows,
  events: seedEvents,
  notifications: seedNotifications,
  eodReports: [] as EodReport[],
  campaigns: seedCampaigns,
  jobPostings: seedJobPostings,
  leads: seedLeads,
  leadActivity: seedLeadActivity,
  courses: [] as Course[],
  courseModules: [] as CourseModule[],
  courseTopics: [] as CourseTopic[],
  recordingFolders: seedRecordingFolders,
  meetingRecordings: seedMeetingRecordings,
  conversations: [] as Conversation[],
  messages: [] as ChatMessage[],
  conversationReads: [] as ConversationRead[],
  channelCategories: seedChannelCategories,
  channels: seedChannels,
  channelMessages: seedChannelMessages,
  channelReactions: [] as ChannelReaction[],
  channelReads: [] as ChannelRead[],
  showcaseItems: seedShowcaseItems,
  eventAttendees: [] as EventAttendee[],
  siteSubscribers: [] as SiteSubscriber[],
  formResponses: [] as FormResponse[],
  emails: [] as Email[],
  auditLog: [] as AuditLogEntry[],
})

/**
 * Where workspaceSettings starts. Remote mode: the SQL defaults, until the
 * first pull brings the real row. Local mode keeps the values this app always
 * had (7 days to "going cold", 4 clients a month), so the demo data — ld-2 is
 * stale at 9 days — still shows what it was built to show.
 */
const initialWorkspaceSettings = (): WorkspaceSettings =>
  isSupabaseConfigured
    ? { ...DEFAULT_WORKSPACE_SETTINGS }
    : { ...DEFAULT_WORKSPACE_SETTINGS, growthStaleDays: 7, growthMonthlyClientTarget: 4 }

/** [field, min, max] — 033's CHECK constraints on workspace_settings. */
const WORKSPACE_LIMITS = [
  ['growthSlaMinutes', 5, 10080],
  ['growthEscalateMinutes', 5, 43200],
  ['growthStaleDays', 1, 365],
] as const

/** The legacy Settings fields that mirror workspace settings, for screens still reading them. */
const legacyGrowthMirror = (w: WorkspaceSettings): Pick<Settings, 'staleLeadDays' | 'monthlyClientTarget'> => ({
  staleLeadDays: w.growthStaleDays,
  monthlyClientTarget: w.growthMonthlyClientTarget,
})

/**
 * persist migration v1 → v2: workspace_settings arrives. In local mode the
 * store is the database, so the old browser-local Growth values become the
 * local workspace settings here. Remote mode carries them to the server on
 * the first pull instead (hydrate → carryLegacyGrowthSettings), and only an
 * admin's browser may.
 */
export function migratePersistedState(persisted: unknown, version: number, local = !isSupabaseConfigured): unknown {
  if (!persisted || typeof persisted !== 'object') return persisted
  const state = { ...(persisted as Record<string, unknown>) }
  if (version < 2 && local && !state.workspaceSettings) {
    const settings = { ...((state.settings ?? {}) as Partial<Settings>) }
    state.workspaceSettings = {
      ...DEFAULT_WORKSPACE_SETTINGS,
      growthStaleDays: settings.staleLeadDays ?? 7,
      growthMonthlyClientTarget: settings.monthlyClientTarget ?? 4,
    } satisfies WorkspaceSettings
    state.settings = { ...settings, growthSettingsMigrated: true }
  }
  return state
}

/**
 * Remote mode starts empty and fills from Supabase: seeding demo rows there
 * would show someone else's fake clients until the first pull, and leave them
 * behind in localStorage after sign-out.
 */
const emptyState = (): ReturnType<typeof seedState> =>
  Object.fromEntries(Object.keys(seedState()).map((k) => [k, []])) as unknown as ReturnType<typeof seedState>

/** The pull in progress, which every hydrate() call joins. */
let hydrating: Promise<void> | null = null
/** The sign-out in progress, which a second logout() (SIGNED_OUT) joins. */
let loggingOut: Promise<void> | null = null

/** Waits for `work`, but never longer than `ms`; never rejects. */
function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    work.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      () => {
        clearTimeout(timer)
        resolve()
      },
    )
  })
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useStore = create<State>()(
  persist(
    (set, get) => {
      // ── internal helpers ─────────────────────────────────────────────────

      const currentUser = (): User | undefined => {
        const s = get()
        return s.users.find((u) => u.id === s.currentUserId)
      }

      const actorName = (): string => currentUser()?.fullName ?? 'Someone'

      /**
       * Defence in depth for destructive actions. The UI already hides the
       * controls and RLS rejects the write; this stops a stray call (devtools,
       * a stale tab) from also tearing the rows out of the local store.
       */
      const allowed = (feature: PermFeature): boolean => can(currentUser(), feature, 'edit')
      // convertLead's local path is authorised as a whole (growth + clients,
      // like 036), so the project and starter tasks it makes skip the
      // per-table check. The actions are synchronous; nothing else runs meanwhile.
      let converting = false
      const messageWrites = new Map<string, Promise<boolean>>()

      const trackMessageWrite = (row: ChatMessage | ChannelMessage, channel: boolean): void => {
        const actor = get().currentUserId
        const write = Promise.resolve(db.insert(channel ? 'channelMessages' : 'messages', row)).then((saved) => {
          if (saved === false && get().currentUserId === actor) {
            if (channel && 'channelId' in row) {
              set((s) => {
                const channelMessages = s.channelMessages.filter((m) => m.id !== row.id)
                return {
                  channelMessages,
                  channels: s.channels.map((c) => c.id === row.channelId
                    ? { ...c, lastMessageAt: latestChannelMessage(channelMessages, c.id)?.createdAt ?? c.createdAt } : c),
                }
              })
            } else if ('conversationId' in row) {
              set((s) => {
                const messages = s.messages.filter((m) => m.id !== row.id)
                return {
                  messages,
                  conversations: s.conversations.map((c) => c.id === row.conversationId
                    ? { ...c, lastMessageAt: lastMessageOf(messages, c.id)?.createdAt ?? c.createdAt } : c),
                }
              })
            }
          }
          return saved !== false && get().currentUserId === actor
        }).catch(() => false)
        messageWrites.set(row.id, write)
        void write.finally(() => messageWrites.delete(row.id))
      }

      const pushNotifications = (rows: Notification[]): void => {
        if (rows.length === 0) return
        set((s) => ({ notifications: [...rows, ...s.notifications] }))
        rows.forEach((n) => db.insert('notifications', n))
      }

      const makeNotification = (input: NotifyInput): Notification => ({
        id: uid(),
        read: false,
        createdAt: nowIso(),
        ...input,
      })

      /** Send to one user — skips self unless it's a self-notification by design. */
      const notifyUser = (input: NotifyInput): void => {
        if (input.userId === get().currentUserId) return
        pushNotifications([makeNotification(input)])
      }

      /**
       * Fan out to all admins except the actor — and except `exclude`, who
       * already got a more specific notification for the same change.
       */
      const notifyAdmins = (
        type: NotificationType,
        title: string,
        entity?: string,
        entityId?: string,
        exclude?: string,
      ): void => {
        const s = get()
        const actorId = s.currentUserId ?? undefined
        const rows = s.users
          .filter((u) => isAdmin(u) && u.id !== s.currentUserId && u.id !== exclude)
          .map((u) => makeNotification({ userId: u.id, actorId, type, title, entity, entityId }))
        pushNotifications(rows)
      }

      /** Tell the people just added to a task (never the actor; the database sends no copy). */
      const notifyCollaborators = (ids: string[], title: string, taskId: string): void => {
        for (const userId of ids) {
          notifyUser({
            userId,
            actorId: get().currentUserId ?? undefined,
            type: 'task_assigned',
            title: `${actorName()} added you to '${title}' as a collaborator`,
            entity: 'task',
            entityId: taskId,
          })
        }
      }

      const logActivity = (
        input: Omit<TaskActivity, 'id' | 'createdAt' | 'actorId'>,
      ): void => {
        const row: TaskActivity = {
          id: uid(),
          createdAt: nowIso(),
          actorId: get().currentUserId ?? undefined,
          ...input,
        }
        set((s) => ({ taskActivity: [...s.taskActivity, row] }))
        db.insert('taskActivity', row)
      }

      /** Lead equivalent of logActivity — the history leads previously lacked. */
      const logLeadActivity = (
        input: Omit<LeadActivity, 'id' | 'createdAt' | 'actorId'>,
      ): void => {
        const row: LeadActivity = {
          id: uid(),
          createdAt: nowIso(),
          actorId: get().currentUserId ?? undefined,
          ...input,
        }
        set((s) => ({ leadActivity: [...s.leadActivity, row] }))
        db.insert('leadActivity', row)
      }

      /** Rows fetched from the server, merged into a slice by id (new ones appended). */
      const mergeRows = <K extends 'clients' | 'projects' | 'tasks' | 'leads' | 'leadActivity'>(
        slice: K,
        rows: State[K] | null,
      ): void => {
        if (!rows || rows.length === 0) return
        set((s) => {
          const byId = new Map(rows.map((r) => [r.id, r]))
          const kept = (s[slice] as { id: string }[]).map((x) => byId.get(x.id) ?? x)
          const known = new Set(kept.map((x) => x.id))
          return { [slice]: [...kept, ...rows.filter((r) => !known.has(r.id))] } as Partial<State>
        })
      }

      /**
       * Local mode has no audit triggers; record the same events here so the
       * Settings → Audit view has something true to show. Remote mode never
       * writes audit rows from the app — the database does.
       */
      const auditLocal = (action: string, entity: string, entityId: string, detail: Record<string, unknown> = {}): void => {
        if (isSupabaseConfigured) return
        const s = get()
        const nextId = s.auditLog.reduce((max, e) => Math.max(max, e.id), 0) + 1
        const row: AuditLogEntry = { id: nextId, at: nowIso(), actorId: s.currentUserId ?? undefined, action, entity, entityId, detail }
        set({ auditLog: [row, ...s.auditLog] })
      }

      /** Lead edits that change the pipeline need growth:edit. */
      const growthEditor = (): boolean => allowed('growth')

      /** Stamp a first response (once) and the latest touch on a lead. */
      const touchStamp = (lead: Lead, at: string): Partial<Lead> =>
        lead.firstRespondedAt ? { lastTouchAt: at } : { lastTouchAt: at, firstRespondedAt: at }

      /**
       * Local mode's stand-in for the showcase_on_project() trigger (037): a
       * project that is done and has a live URL gets a draft showcase item
       * (once), consent copied from its client, and admins are told. Remote
       * mode leaves this to the database so every client behaves the same.
       */
      const localShowcaseOnProject = (projectId: string): void => {
        if (isSupabaseConfigured) return
        const s = get()
        const project = s.projects.find((p) => p.id === projectId)
        if (!project || project.status !== 'done' || !project.liveUrl) return
        if (s.showcaseItems.some((i) => i.projectId === projectId)) return
        const client = s.clients.find((c) => c.id === project.clientId)
        const consent = client?.showcaseConsent ?? 'unknown'
        const now = nowIso()
        // The card is the client's, as the trigger names it.
        const title = (client?.company?.trim() || client?.name.trim() || project.title).slice(0, 120)
        const item: ShowcaseItem = {
          id: uid(),
          slug: uniqueSlug(title, s.showcaseItems.map((i) => i.slug)),
          kind: 'website',
          title,
          url: project.liveUrl,
          linkPublic: true,
          publicUrl: project.liveUrl,
          stack: [],
          // Auto-publish never happens here: like the trigger, a granted
          // consent with the switch on files the item as 'ready' and only the
          // link check (B3) may put it live.
          status: consent === 'declined'
            ? 'hidden'
            : consent === 'granted' && s.workspaceSettings.showcaseAutoPublish ? 'ready' : 'draft',
          featured: false,
          homeFeatured: false,
          sortOrder: s.showcaseItems.length * 10,
          consent,
          ...(consent !== 'unknown' ? { consentAt: now } : {}),
          projectId,
          clientId: project.clientId,
          linkStatus: 'unknown',
          linkFailCount: 0,
          createdBy: s.currentUserId ?? undefined,
          createdAt: now,
          updatedAt: now,
        }
        set((st) => ({ showcaseItems: [...st.showcaseItems, item] }))
        if (consent !== 'declined') {
          notifyAdmins('showcase_ready', `Ready for the showcase: ${title}`, 'showcase', item.id)
        }
      }

      /** Remote mode on a database without 033 yet: the old local values still rule. */
      const workspaceTableMissing = (): boolean =>
        isSupabaseConfigured && db.isTableMissing('workspace_settings')

      /**
       * After a pull. Once per browser, an admin's old browser-local Growth
       * values become the workspace values — but only while nobody has saved
       * workspace settings yet (updatedBy unset), so a stale laptop can never
       * overwrite a newer choice. From then on the legacy Settings fields
       * only mirror the server.
       */
      const adoptWorkspaceSettings = (remote: WorkspaceSettings | undefined): void => {
        const s = get()
        if (!remote) {
          if (!workspaceTableMissing()) return
          // No table yet: keep workspaceSettings in step with the local values.
          set({
            workspaceSettings: {
              ...s.workspaceSettings,
              growthStaleDays: s.settings.staleLeadDays ?? s.workspaceSettings.growthStaleDays,
              growthMonthlyClientTarget: s.settings.monthlyClientTarget ?? s.workspaceSettings.growthMonthlyClientTarget,
            },
          })
          return
        }
        let next = remote
        const me = currentUser()
        if (!s.settings.growthSettingsMigrated && me && isAdmin(me)) {
          const patch: Partial<WorkspaceSettings> = {}
          if (!remote.updatedBy) {
            const { staleLeadDays, monthlyClientTarget } = s.settings
            if (staleLeadDays !== undefined && staleLeadDays !== remote.growthStaleDays) patch.growthStaleDays = staleLeadDays
            if (monthlyClientTarget !== undefined && monthlyClientTarget !== remote.growthMonthlyClientTarget) {
              patch.growthMonthlyClientTarget = monthlyClientTarget
            }
          }
          if (Object.keys(patch).length > 0) {
            next = { ...remote, ...patch, updatedBy: me.id, updatedAt: nowIso() }
            void db.updateWorkspaceSettings({ ...patch, updatedBy: me.id })
          }
          set((st) => ({ settings: { ...st.settings, growthSettingsMigrated: true } }))
        }
        set((st) => ({ workspaceSettings: next, settings: { ...st.settings, ...legacyGrowthMirror(next) } }))
      }

      // ── store ────────────────────────────────────────────────────────────

      const startWorkspace = initialWorkspaceSettings()

      return {
        currentUserId: null,
        ...(isSupabaseConfigured ? emptyState() : seedState()),
        workspaceSettings: startWorkspace,
        settings: {
          autoArchiveDays: 30,
          workspaceName: 'DeskDev Studio',
          weeklyOutreachTarget: 50,
          ...legacyGrowthMirror(startWorkspace),
        },
        hydrated: false,
        synced: false,
        loadError: null,
        lastReminderCheck: null,
        remindedIds: [],

        // ── lifecycle ────────────────────────────────────────────────────

        saveEngagement: async (projectId, version, terms) => {
          const me = currentUser()
          if (!me || !isAdmin(me)) return { ok: false, error: 'Only an active admin can manage engagements.' }
          if (!get().projects.some((p) => p.id === projectId)) return { ok: false, error: 'Project not found.' }
          const previous = get().projectEngagements.find((e) => e.projectId === projectId)
          if (version !== (previous?.version ?? 0)) return { ok: false, error: 'This engagement changed. Reload it before saving.' }
          const snapshot = structuredClone(terms)
          const error = engagementError(snapshot, previous?.terms)
          if (error) return { ok: false, error }
          let record: ProjectEngagement
          if (isSupabaseConfigured) {
            const result = await db.saveProjectEngagement(projectId, version, snapshot)
            if (get().currentUserId !== me.id) return { ok: false, error: 'Your session changed. Sign in and reload.' }
            if (!result.record) return { ok: false, error: result.error ?? 'Could not save engagement.' }
            record = result.record
          } else {
            record = { id: previous?.id ?? uid(), projectId,
              leadId: previous?.leadId ?? get().leadActivity.find((a) => a.action === 'converted' && a.detail.project_id === projectId)?.leadId,
              version: version + 1, terms: snapshot,
              updatedBy: me.id, createdAt: previous?.createdAt ?? nowIso(), updatedAt: nowIso() }
          }
          set((s) => {
            const latest = s.projectEngagements.find((e) => e.projectId === projectId)
            if (latest && latest.version > record.version) return {}
            return { projectEngagements: [...s.projectEngagements.filter((e) => e.projectId !== projectId), record] }
          })
          return { ok: true }
        },

        hydrate: () => {
          // Start-up, sign-in, a resume and a realtime reconnect can all ask
          // at once; one pull of every table serves them all.
          if (hydrating) return hydrating
          const pull = async (attempt: number): Promise<void> => {
            const who = get().currentUserId
            // A pull that snapshots the server before a queued insert lands
            // would erase the optimistic row it is about to confirm. Bounded:
            // one hung request must not leave the app on skeletons forever.
            await Promise.race([db.flush(), new Promise<void>((r) => setTimeout(r, 4000))])
            const remote = await db.fetchAllWithStatus()
            // Signed out (or someone else signed in) mid-pull: these rows
            // belong to a session that's over.
            const now = get().currentUserId
            const stale = who !== null && now !== who
            // An account switch: SIGNED_IN starts this pull under the old
            // persisted id, then adoptSession sets the new one. Nobody else
            // pulls again, so do it here (capped) rather than leave the new
            // user on an empty store. A sign-out (now === null) just discards.
            if (stale && now !== null && attempt < 2) return pull(attempt + 1)
            if (remote && !stale) {
              const loaded = Object.keys(remote.data).length > 0
              const { workspaceSettings: remoteSettings, ...tables } = remote.data
              set({
                ...tables,
                ...(loaded ? { synced: true } : {}),
                loadError: remote.failed.length > 0 ? remote.failed : null,
              })
              adoptWorkspaceSettings(remoteSettings)
            } else if (!isSupabaseConfigured) {
              // Local mode: the store is the data.
              set({ synced: true })
            }
            set({ hydrated: true })
            get().sweepAutoArchive()
            // NOTE: sweepActivity() (48h hard-delete) is intentionally NOT called
            // yet. Until the n8n `log-to-sheets` workflow is active, there is no
            // Sheets backup, so deleting would lose data. The Home view already
            // HIDES activity older than 48h. Re-enable this line once the Sheets
            // logger is live — see sweepActivity() below.
            // get().sweepActivity()
            get().checkDueReminders()
          }
          hydrating = pull(0).finally(() => {
            hydrating = null
          })
          return hydrating
        },

        resetSeed: () => {
          // Demo data has non-UUID ids; on Supabase it would only break writes.
          if (isSupabaseConfigured) return
          const ws = initialWorkspaceSettings()
          set((s) => ({
            ...seedState(),
            workspaceSettings: ws,
            settings: { ...s.settings, ...legacyGrowthMirror(ws) },
            lastReminderCheck: null,
            remindedIds: [],
          }))
        },

        updateSettings: (patch) => {
          set((s) => ({ settings: { ...s.settings, ...patch } }))
          // The Growth values moved to the server (033). Forward them; for a
          // non-admin the next pull puts the workspace value back.
          const forward: Partial<WorkspaceSettings> = {}
          if (patch.staleLeadDays !== undefined) forward.growthStaleDays = patch.staleLeadDays
          if ('monthlyClientTarget' in patch) forward.growthMonthlyClientTarget = patch.monthlyClientTarget
          if (Object.keys(forward).length > 0) get().updateWorkspaceSettings(forward)
        },

        updateWorkspaceSettings: (patch) => {
          const me = currentUser()
          if (!me || !isAdmin(me)) return false
          const clean: Partial<WorkspaceSettings> = { ...patch }
          delete clean.updatedAt
          delete clean.updatedBy
          // Whole numbers, clamped to 033's CHECK ranges, so a save is never
          // shown here and then refused by the server.
          for (const [key, min, max] of WORKSPACE_LIMITS) {
            if (key in clean) {
              const n = Number(clean[key])
              if (!Number.isFinite(n)) return false
              clean[key] = Math.min(max, Math.max(min, Math.round(n)))
            }
          }
          if ('growthMonthlyClientTarget' in clean && clean.growthMonthlyClientTarget !== undefined) {
            const n = Number(clean.growthMonthlyClientTarget)
            if (!Number.isFinite(n)) return false
            clean.growthMonthlyClientTarget = Math.min(10000, Math.max(0, Math.round(n)))
          }
          if (clean.growthBookingUrl !== undefined) {
            const url = clean.growthBookingUrl.trim()
            if (url && (!isHttpsUrl(url) || url.length > 2048)) return false
            clean.growthBookingUrl = url || undefined
          }
          if (clean.growthBusinessHours !== undefined && !isValidBusinessHours(clean.growthBusinessHours)) return false
          if (clean.growthOwnerPool !== undefined) {
            // The round-robin order, minus duplicates and people who left
            // (the server's guard drops them too).
            const known = new Map(get().users.map((u) => [u.id, u]))
            clean.growthOwnerPool = [...new Set(clean.growthOwnerPool)]
              .filter((id) => known.has(id) && !isDeactivated(known.get(id)))
              .slice(0, 50)
          }
          const merged = { ...get().workspaceSettings, ...clean }
          // Escalation can't come before the SLA it escalates (033's CHECK).
          if (merged.growthEscalateMinutes < merged.growthSlaMinutes) return false
          const next: WorkspaceSettings = { ...merged, updatedAt: nowIso(), updatedBy: me.id }
          set((s) => ({ workspaceSettings: next, settings: { ...s.settings, ...legacyGrowthMirror(next) } }))
          if (!workspaceTableMissing()) void db.updateWorkspaceSettings({ ...clean, updatedBy: me.id })
          return true
        },

        // ── auth ─────────────────────────────────────────────────────────

        login: async (email, password) => {
          const normalized = email.trim().toLowerCase()
          if (isSupabaseConfigured) {
            const { data, error } = await supabase.auth.signInWithPassword({
              email: normalized,
              password,
            })
            if (error || !data.user) {
              return { ok: false, error: error?.message ?? 'Sign-in failed' }
            }
            await get().adoptSession(data.user.id)
            return { ok: true }
          }
          // Local mode — check the users slice
          const user = get().users.find(
            (u) => u.email?.toLowerCase() === normalized && u.password === password,
          )
          if (!user) return { ok: false, error: 'Invalid email or password' }
          // Remote mode bans the auth account; local mode has only this check.
          if (isDeactivated(user)) return { ok: false, error: 'This account has been deactivated' }
          set({ currentUserId: user.id })
          return { ok: true }
        },

        adoptSession: async (userId) => {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single()
          if (profileError) {
            console.warn('[auth] profile load failed:', profileError.message)
          }
          if (profile) {
            const user = rowToUser(profile as Record<string, unknown>)
            set((s) => ({
              users: [...s.users.filter((u) => u.id !== user.id), user],
              currentUserId: user.id,
            }))
          } else {
            set({ currentUserId: userId })
          }
        },

        syncSessionUser: async (sessionUserId) => {
          const current = get().currentUserId
          // Nobody signed in here (AuthGate shows the login), or already them.
          if (current === null || current === sessionUserId) return false
          // Nothing of the previous account's workspace may carry over, and no
          // row may be stamped with its id under the new account's token.
          set({
            ...emptyState(),
            workspaceSettings: initialWorkspaceSettings(),
            hydrated: false,
            synced: false,
            loadError: null,
          })
          await get().adoptSession(sessionUserId)
          return true
        },

        logout: () => {
          if (!isSupabaseConfigured) {
            set({ currentUserId: null })
            return Promise.resolve()
          }
          // signOut() emits SIGNED_OUT, whose handler calls logout() again.
          if (loggingOut) return loggingOut
          loggingOut = (async () => {
            // This device's push row and badge go first, while the session can
            // still delete them — afterwards pushes would keep arriving for an
            // account nobody is signed in to here (lib/platform.ts, bounded).
            await signOutCleanup()
            // 'local': signing out here must not sign out the user's phone,
            // laptop and every other device too (the default, 'global', does).
            await withTimeout(supabase.auth.signOut({ scope: 'local' }), 3000)
            // Nothing of the workspace stays on a shared machine after
            // sign-out. Local mode keeps its data — it has nowhere else.
            set({
              currentUserId: null,
              ...emptyState(),
              workspaceSettings: initialWorkspaceSettings(),
              hydrated: false,
              synced: false,
              loadError: null,
            })
          })().finally(() => {
            loggingOut = null
          })
          return loggingOut
        },

        addUser: (input) => {
          const row: User = {
            role: 'member',
            permissions: { ...DEFAULT_MEMBER_PERMISSIONS },
            ...input,
            id: uid(),
            createdAt: nowIso(),
          }
          set((s) => ({ users: [...s.users, row] }))
          // No db.insert — profiles has no INSERT policy (rows come from the
          // auth signup trigger); remote creation goes through adminCreateUser.
          return row.id
        },

        updateUser: (id, patch) => {
          set((s) => ({
            users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
          }))
          // Direct profile patch — RLS allows own-row updates (ProfileSection)
          // and admin updates. Auth-level changes (email/password) and the
          // Settings → Users flow go through adminUpdateUser instead.
          db.update('users', id, patch)
        },

        saveOwnProfile: async (input) => {
          const me = currentUser()
          if (!me || isDeactivated(me)) return { ok: false, error: 'Sign in again to save your profile.' }
          const patch = {
            fullName: input.fullName.trim(), phone: input.phone?.trim() || undefined,
            title: input.title?.trim() || undefined, avatarColor: input.avatarColor,
          }
          if (!patch.fullName) return { ok: false, error: 'Full name is required.' }
          const result = await db.updateProfileConfirmed(me.id, patch)
          if (!result.ok) return result
          if (get().currentUserId !== me.id) return { ok: false, error: 'Your session changed. Reload this page.' }
          set((s) => ({ users: s.users.map((u) => u.id === me.id ? { ...u, ...patch } : u) }))
          return { ok: true }
        },

        setPicture: (owner, key) => {
          const me = currentUser()
          // The database refuses anyone else too (052's guard).
          if (!me || !isAdmin(me)) return { ok: false, error: 'Only admins can change pictures.' }
          const avatarKey = key ?? undefined
          if (owner.kind === 'profiles') {
            if (!get().users.some((u) => u.id === owner.id)) return { ok: false, error: 'That person is not in this workspace.' }
            set((s) => ({ users: s.users.map((u) => (u.id === owner.id ? { ...u, avatarKey } : u)) }))
            db.update('users', owner.id, { avatarKey })
            return { ok: true }
          }
          if (!get().clients.some((c) => c.id === owner.id)) return { ok: false, error: 'That client is not in this workspace.' }
          const updatedAt = nowIso()
          set((s) => ({ clients: s.clients.map((c) => (c.id === owner.id ? { ...c, avatarKey, updatedAt } : c)) }))
          db.update('clients', owner.id, { avatarKey, updatedAt })
          return { ok: true }
        },

        deleteUser: (id) => {
          set((s) => ({
            users: s.users.filter((u) => u.id !== id),
            currentUserId: s.currentUserId === id ? null : s.currentUserId,
            notifications: s.notifications.filter((n) => n.userId !== id),
          }))
          // No db.remove — profiles has no DELETE policy; remote deletion goes
          // through adminDeleteUser (auth.users delete cascades to profiles).
        },

        // ── admin user management (dual mode) ────────────────────────────

        adminCreateUser: async (input) => {
          if (!adminUsers.isRemoteMode()) {
            return { ok: true, id: get().addUser(input) }
          }
          const { password, ...rest } = input
          if (!rest.email || !password) {
            return { ok: false, error: 'Email and password are required' }
          }
          const res = await adminUsers.createUser({
            email: rest.email,
            password,
            fullName: rest.fullName,
            role: rest.role,
            permissions: rest.permissions,
            phone: rest.phone,
            title: rest.title,
            avatarColor: rest.avatarColor,
          })
          if (!res.ok || !res.userId) {
            return { ok: false, error: res.error ?? 'Could not create user' }
          }
          // Only touch the local store on success — with the server-issued id
          // (the auth user id). The password never lives in the remote store.
          const row: User = {
            role: 'member',
            permissions: { ...DEFAULT_MEMBER_PERMISSIONS },
            ...rest,
            id: res.userId,
            createdAt: nowIso(),
          }
          set((s) => ({ users: [...s.users.filter((u) => u.id !== row.id), row] }))
          return { ok: true, id: row.id }
        },

        adminUpdateUser: async (id, patch) => {
          if (!adminUsers.isRemoteMode()) {
            const before = get().users.find((u) => u.id === id)
            get().updateUser(id, patch)
            if (before && patch.role !== undefined && patch.role !== before.role) {
              auditLocal('profile.role_changed', 'profile', id, { from: before.role, to: patch.role })
            }
            if (before && patch.permissions && JSON.stringify(patch.permissions) !== JSON.stringify(before.permissions)) {
              auditLocal('profile.permissions_changed', 'profile', id, { from: before.permissions, to: patch.permissions })
            }
            return { ok: true, id }
          }
          const before = get().users.find((u) => u.id === id)
          if (!before) return { ok: false, error: 'User not found' }
          const { password, ...localPatch } = patch
          // Optimistic local apply — no direct db write; the edge function is
          // the single writer for admin-managed profile changes.
          set((s) => ({
            users: s.users.map((u) => (u.id === id ? { ...u, ...localPatch } : u)),
          }))
          const res = await adminUsers.updateUser(id, {
            email: patch.email,
            password,
            fullName: patch.fullName,
            role: patch.role,
            permissions: patch.permissions,
            // `null` clears the field remotely; absent keys stay untouched
            phone: 'phone' in patch ? patch.phone ?? null : undefined,
            title: 'title' in patch ? patch.title ?? null : undefined,
            avatarColor: 'avatarColor' in patch ? patch.avatarColor ?? null : undefined,
          })
          if (!res.ok) {
            set((s) => ({ users: s.users.map((u) => (u.id === id ? before : u)) }))
            return { ok: false, error: res.error ?? 'Could not update user' }
          }
          return { ok: true, id }
        },

        adminDeleteUser: async (id) => {
          if (!adminUsers.isRemoteMode()) {
            get().deleteUser(id)
            return { ok: true, id }
          }
          const s = get()
          const snapshot = {
            users: s.users,
            notifications: s.notifications,
            currentUserId: s.currentUserId,
          }
          get().deleteUser(id) // optimistic — pure local mutation
          const res = await adminUsers.deleteUser(id)
          if (!res.ok) {
            set(snapshot) // rollback
            return { ok: false, error: res.error ?? 'Could not delete user' }
          }
          return { ok: true, id }
        },

        adminDeactivateUser: async (id) => {
          const s = get()
          const me = currentUser()
          if (!me || !isAdmin(me)) return { ok: false, error: 'Only an admin can deactivate users' }
          const before = s.users.find((u) => u.id === id)
          if (!before) return { ok: false, error: 'User not found' }
          if (id === me.id) return { ok: false, error: 'Cannot deactivate your own account' }
          if (isDeactivated(before)) return { ok: true, id }
          // The same guard as the function: never leave the workspace without an admin.
          const otherAdmins = s.users.filter((u) => u.id !== id && u.role === 'admin' && !isDeactivated(u))
          if (before.role === 'admin' && otherAdmins.length === 0) {
            return { ok: false, error: 'The workspace needs at least one admin' }
          }
          // Mirrors what the function does server-side: no role, no permissions, stamped.
          const after: User = {
            ...before,
            role: 'member',
            permissions: {},
            deactivatedAt: nowIso(),
            deactivatedBy: me.id,
          }
          set((st) => ({ users: st.users.map((u) => (u.id === id ? after : u)) }))
          if (!adminUsers.isRemoteMode()) {
            auditLocal('profile.deactivated', 'profile', id, { role: before.role })
            return { ok: true, id }
          }
          const res = await adminUsers.deactivateUser(id)
          if (!res.ok) {
            set((st) => ({ users: st.users.map((u) => (u.id === id ? before : u)) }))
            return { ok: false, error: res.error ?? 'Could not deactivate the user' }
          }
          return { ok: true, id }
        },

        adminReactivateUser: async (id) => {
          const me = currentUser()
          if (!me || !isAdmin(me)) return { ok: false, error: 'Only an admin can reactivate users' }
          const before = get().users.find((u) => u.id === id)
          if (!before) return { ok: false, error: 'User not found' }
          if (!isDeactivated(before)) return { ok: true, id }
          // Back as a member with no permissions; access is granted separately.
          const after: User = { ...before, deactivatedAt: undefined, deactivatedBy: undefined }
          set((st) => ({ users: st.users.map((u) => (u.id === id ? after : u)) }))
          if (!adminUsers.isRemoteMode()) {
            auditLocal('profile.reactivated', 'profile', id)
            return { ok: true, id }
          }
          const res = await adminUsers.reactivateUser(id)
          if (!res.ok) {
            set((st) => ({ users: st.users.map((u) => (u.id === id ? before : u)) }))
            return { ok: false, error: res.error ?? 'Could not reactivate the user' }
          }
          return { ok: true, id }
        },

        loadAuditLog: async (opts) => {
          if (!isAdmin(currentUser())) return { ok: false, error: 'Only admins can read the audit log', hasMore: false }
          // Local mode keeps its rows in the store (auditLocal); nothing to fetch.
          if (!isSupabaseConfigured) return { ok: true, hasMore: false }
          const current = get().auditLog
          const before = opts?.more && current.length > 0 ? current[current.length - 1].id : undefined
          const page = await db.fetchAuditLog({ limit: 100, before })
          if (page.error) return { ok: false, error: page.error, hasMore: false }
          if (page.unavailable) return { ok: true, hasMore: false, unavailable: true }
          set((st) => {
            const base = before === undefined ? [] : st.auditLog
            const seen = new Set(base.map((e) => e.id))
            return { auditLog: [...base, ...page.rows.filter((r) => !seen.has(r.id))] }
          })
          return { ok: true, hasMore: page.nextBefore !== undefined }
        },

        // ── clients ──────────────────────────────────────────────────────

        addClient: (input) => {
          if (!allowed('clients')) throw new Error('You do not have permission to create clients.')
          validateClient(input, get())
          const now = nowIso()
          // Consent on a new client is an admin's call too (037 refuses the
          // whole insert otherwise), so anyone else's is dropped.
          const me = currentUser()
          const fields = input.showcaseConsent !== undefined && !(me && isAdmin(me))
            ? Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'showcaseConsent')) as typeof input
            : input
          const row: Client = {
            engagement: 'gig_on_call',
            status: 'active',
            ...fields,
            name: input.name.trim(),
            email: input.email?.trim() || undefined,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ clients: [...s.clients, row] }))
          db.insert('clients', row)
          notifyAdmins('client_updated', `${actorName()} added client '${row.name}'`, 'client', row.id)
          return row.id
        },

        updateClient: (id, input) => {
          if (!allowed('clients')) throw new Error('You do not have permission to edit clients.')
          const before = get().clients.find((c) => c.id === id)
          if (!before) throw new Error('This client is no longer available.')
          validateClient({ ...before, ...input }, get())
          // Consent is what lets a client's work onto the public site, so
          // only an admin may change it (the database refuses it too, 037).
          const me = currentUser()
          // The picture is admin-only too (052): it goes through setPicture.
          const adminOnly = me && isAdmin(me) ? [] : ['showcaseConsent', 'avatarKey']
          const patch = Object.keys(input).some((k) => adminOnly.includes(k))
            ? Object.fromEntries(Object.entries(input).filter(([k]) => !adminOnly.includes(k))) as Partial<Client>
            : input
          const full = { ...patch, updatedAt: nowIso() }
          if (full.name !== undefined) full.name = full.name.trim()
          if ('email' in full) full.email = full.email?.trim() || undefined
          set((s) => ({
            clients: s.clients.map((c) => (c.id === id ? { ...c, ...full } : c)),
          }))
          db.update('clients', id, full)
          const name = get().clients.find((c) => c.id === id)?.name ?? 'client'
          notifyAdmins('client_updated', `${actorName()} updated client '${name}'`, 'client', id)
        },

        deleteClient: async (id) => {
          if (!allowed('clients')) return { ok: false, error: 'You do not have permission to delete this record.' }
          if (get().projectEngagements.some((e) => get().projects.some((p) => p.id === e.projectId && p.clientId === id))) return { ok: false, error: 'This client has retained engagement history. Change its status instead.' }
          if (isSupabaseConfigured) {
            const who = get().currentUserId
            const result = await db.removeConfirmed('clients', id)
            if (!result.ok) return result
            if (get().currentUserId !== who) return { ok: false, error: 'Your session changed. Reload this page.' }
          }
          const name = get().clients.find((c) => c.id === id)?.name ?? 'client'
          set((s) => {
            const deadTables = s.crmTables.filter((t) => t.clientId === id).map((t) => t.id)
            const deadChannels = new Set(s.channels.filter((c) => c.clientId === id).map((c) => c.id))
            return {
              clients: s.clients.filter((c) => c.id !== id),
              projects: s.projects.filter((p) => p.clientId !== id),
              projectCategories: s.projectCategories.filter((p) => p.clientId !== id),
              tasks: s.tasks.filter((t) => t.clientId !== id),
              taskActivity: s.taskActivity.filter((a) => a.clientId !== id),
              timeEntries: s.timeEntries.filter((t) => t.clientId !== id),
              crmTables: s.crmTables.filter((t) => t.clientId !== id),
              crmColumns: s.crmColumns.filter((c) => !deadTables.includes(c.tableId)),
              crmRows: s.crmRows.filter((r) => !deadTables.includes(r.tableId)),
              events: s.events.map((e) =>
                e.clientId === id ? { ...e, clientId: undefined } : e,
              ),
              // The client's channel space goes with it (025: ON DELETE CASCADE).
              channelCategories: s.channelCategories.filter((c) => c.clientId !== id),
              channels: s.channels.filter((c) => c.clientId !== id),
              channelMessages: s.channelMessages.filter((m) => !deadChannels.has(m.channelId)),
              channelReactions: s.channelReactions.filter((r) => !deadChannels.has(r.channelId)),
              channelReads: s.channelReads.filter((r) => !deadChannels.has(r.channelId)),
            }
          })
          notifyAdmins('client_updated', `${actorName()} deleted client '${name}'`, 'client', id)
          return { ok: true }
        },

        addClientCategory: (input) => {
          const row: ClientCategory = {
            sortOrder: get().clientCategories.length,
            ...input,
            id: uid(),
            createdAt: nowIso(),
          }
          set((s) => ({ clientCategories: [...s.clientCategories, row] }))
          db.insert('clientCategories', row)
          return row.id
        },

        updateClientCategory: (id, patch) => {
          set((s) => ({
            clientCategories: s.clientCategories.map((c) =>
              c.id === id ? { ...c, ...patch } : c,
            ),
          }))
          db.update('clientCategories', id, patch)
        },

        deleteClientCategory: (id) => {
          if (!allowed('clients')) return
          set((s) => ({
            clientCategories: s.clientCategories.filter((c) => c.id !== id),
            clients: s.clients.map((c) =>
              c.categoryId === id ? { ...c, categoryId: undefined } : c,
            ),
          }))
          db.remove('clientCategories', id)
        },

        // ── projects ─────────────────────────────────────────────────────

        addProject: (input) => {
          if (!converting && !allowed('projects')) throw new Error('You do not have permission to create projects.')
          validateProject(input, get())
          const now = nowIso()
          const row: Project = {
            status: 'backlog',
            phase: 'onboarding',
            position: get().projects.filter((p) => p.clientId === input.clientId).length,
            createdBy: get().currentUserId ?? undefined,
            ...input,
            title: input.title.trim(),
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          // https only (037's CHECK) — a bad link must not sink the whole insert.
          if (row.liveUrl !== undefined && !isHttpsUrl(row.liveUrl)) delete row.liveUrl
          set((s) => ({ projects: [...s.projects, row] }))
          // 046's column default starts it in onboarding too; naming the
          // column would sink every insert on a database without 046.
          const insertRow: Partial<Project> = { ...row }
          delete insertRow.phase
          delete insertRow.phaseChangedAt
          db.insert('projects', insertRow)
          notifyAdmins('project_updated', `${actorName()} added project '${row.title}'`, 'project', row.id)
          return row.id
        },

        updateProject: (id, patch) => {
          // A result, not a throw: the modal, the showcase panel and the form
          // bindings all read it.
          if (!allowed('projects')) return { ok: false, error: 'You do not have permission to edit projects.' }
          const before = get().projects.find((p) => p.id === id)
          if (!before) return { ok: false, error: 'This project is no longer available.' }
          try {
            validateProject({ ...before, ...patch }, get(), before)
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'This project could not be saved.' }
          }
          if (patch.status !== undefined && patch.status !== before.status) {
            const conflict = statusConflict(before, patch.status)
            if (conflict) return { ok: false, error: conflict }
          }
          const full = { ...patch, updatedAt: nowIso() }
          if (full.title !== undefined) full.title = full.title.trim()
          // https only (037's CHECK); unset clears it, anything else is dropped.
          if (full.liveUrl !== undefined && !isHttpsUrl(full.liveUrl)) delete full.liveUrl
          set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? { ...p, ...full } : p)),
          }))
          db.update('projects', id, full)
          const title = get().projects.find((p) => p.id === id)?.title ?? 'project'
          notifyAdmins('project_updated', `${actorName()} updated project '${title}'`, 'project', id)
          localShowcaseOnProject(id)
          return { ok: true }
        },

        moveProject: (id, status, position) => {
          if (!allowed('projects')) return { ok: false, error: 'You need edit access to projects.' }
          const project = get().projects.find((p) => p.id === id)
          if (!project) return { ok: false, error: 'Project not found.' }
          const conflict = statusConflict(project, status)
          if (conflict) return { ok: false, error: conflict }
          const full = { status, position, updatedAt: nowIso() }
          set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? { ...p, ...full } : p)),
          }))
          db.update('projects', id, full)
          const title = get().projects.find((p) => p.id === id)?.title ?? 'project'
          notifyAdmins('project_updated', `${actorName()} moved project '${title}'`, 'project', id)
          localShowcaseOnProject(id)
          return { ok: true }
        },

        deleteProject: async (id) => {
          if (!allowed('projects')) return { ok: false, error: 'You do not have permission to delete this record.' }
          if (get().projectEngagements.some((e) => e.projectId === id)) return { ok: false, error: 'This project has retained engagement history. Change its status instead.' }
          if (isSupabaseConfigured) {
            const who = get().currentUserId
            const result = await db.removeConfirmed('projects', id)
            if (!result.ok) return result
            if (get().currentUserId !== who) return { ok: false, error: 'Your session changed. Reload this page.' }
          }
          const title = get().projects.find((p) => p.id === id)?.title ?? 'project'
          set((s) => ({
            projects: s.projects.filter((p) => p.id !== id),
            tasks: s.tasks.map((t) =>
              t.projectId === id ? { ...t, projectId: undefined } : t,
            ),
          }))
          notifyAdmins('project_updated', `${actorName()} deleted project '${title}'`, 'project', id)
          return { ok: true }
        },

        addProjectCategory: (input) => {
          const row: ProjectCategory = {
            sortOrder: get().projectCategories.filter((p) => p.clientId === input.clientId).length,
            ...input,
            id: uid(),
          }
          set((s) => ({ projectCategories: [...s.projectCategories, row] }))
          db.insert('projectCategories', row)
          return row.id
        },

        updateProjectCategory: (id, patch) => {
          set((s) => ({
            projectCategories: s.projectCategories.map((p) =>
              p.id === id ? { ...p, ...patch } : p,
            ),
          }))
          db.update('projectCategories', id, patch)
        },

        deleteProjectCategory: (id) => {
          if (!allowed('projects')) return
          set((s) => ({
            projectCategories: s.projectCategories.filter((p) => p.id !== id),
            projects: s.projects.map((p) =>
              p.categoryId === id ? { ...p, categoryId: undefined } : p,
            ),
            tasks: s.tasks.map((t) =>
              t.categoryId === id ? { ...t, categoryId: undefined } : t,
            ),
          }))
          db.remove('projectCategories', id)
        },

        // ── tasks ────────────────────────────────────────────────────────

        addTask: (input) => {
          if (!converting && !allowed('tasks')) throw new Error('You do not have permission to create tasks.')
          validateTask(input, get())
          const now = nowIso()
          const status = input.status ?? 'todo'
          const row: Task = {
            status,
            priority: 'med',
            // Positions are scoped per client board column (clientId + status),
            // and separately per parent for subtasks — subtasks never appear on
            // the board, so the two orderings don't share a number space.
            position: input.parentTaskId
              ? get().tasks.filter((t) => t.parentTaskId === input.parentTaskId).length
              : get().tasks.filter(
                  (t) =>
                    t.clientId === input.clientId &&
                    t.status === status &&
                    !t.parentTaskId,
                ).length,
            archived: false,
            createdBy: get().currentUserId ?? undefined,
            ...input,
            title: input.title.trim(),
            completedAt: status === 'done' ? now : undefined,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          row.collaboratorIds = cleanCollaborators(row.collaboratorIds, row.assigneeId)
          set((s) => ({ tasks: [...s.tasks, row] }))
          // An empty list is the column's default; leaving it out keeps the
          // insert working on a database without 054.
          const insertRow: Partial<Task> = { ...row }
          if (!row.collaboratorIds.length) delete insertRow.collaboratorIds
          db.insert('tasks', insertRow)
          logActivity({
            taskId: row.id,
            clientId: row.clientId,
            action: 'created',
            detail: { title: row.title },
          })
          notifyCollaborators(row.collaboratorIds, row.title, row.id)
          if (row.assigneeId) {
            notifyUser({
              userId: row.assigneeId,
              actorId: get().currentUserId ?? undefined,
              type: 'task_assigned',
              title: `${actorName()} assigned you '${row.title}'`,
              entity: 'task',
              entityId: row.id,
            })
          }
          notifyAdmins('task_updated', `${actorName()} added task '${row.title}'`, 'task', row.id, row.assigneeId)
          // Open work under a finished parent means the parent isn't finished
          // after all — reopen it instead of leaving the gate contradicted.
          if (row.parentTaskId && row.status !== 'done') {
            const parent = get().tasks.find((t) => t.id === row.parentTaskId)
            if (parent?.status === 'done') get().setTaskStatus(parent.id, 'in_progress')
          }
          return row.id
        },

        updateTask: (id, patch) => {
          if (!allowed('tasks')) throw new Error('You do not have permission to edit tasks.')
          const before = get().tasks.find((t) => t.id === id)
          if (!before) return
          validateTask({ ...before, ...patch }, get(), before)
          if (patch.status !== undefined && patch.status !== before.status && !get().setTaskStatus(id, patch.status)) {
            throw new Error('Finish the open subtasks before completing this task.')
          }
          // Status and completion stamps belong to setTaskStatus, including activity and notifications.
          const { status: ignoredStatus, completedAt: ignoredCompleted, ...fields } = patch
          void ignoredStatus
          void ignoredCompleted
          patch = fields
          if (patch.title !== undefined) patch.title = patch.title.trim()
          if ('collaboratorIds' in patch || ('assigneeId' in patch && before.collaboratorIds?.length)) {
            patch.collaboratorIds = cleanCollaborators(
              patch.collaboratorIds ?? before.collaboratorIds,
              'assigneeId' in patch ? patch.assigneeId : before.assigneeId,
            )
          }
          // The modal sends every field on save. A save that changed nothing
          // used to log an "updated" activity and notify every admin anyway.
          // Lists compare by content: the modal sends a new array each time.
          const same = (a: unknown, b: unknown) =>
            Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : a === b
          const changed = (Object.keys(patch) as (keyof Task)[]).filter((k) => !same(patch[k], before[k]))
          if (changed.length === 0) return
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...full } : t)),
          }))
          db.update('tasks', id, full)
          const assigneeChanged =
            'assigneeId' in patch && patch.assigneeId !== before.assigneeId
          if (assigneeChanged) {
            logActivity({
              taskId: id,
              clientId: before.clientId,
              action: 'assigned',
              detail: { assigneeId: patch.assigneeId ?? null },
            })
            if (patch.assigneeId) {
              notifyUser({
                userId: patch.assigneeId,
                actorId: get().currentUserId ?? undefined,
                type: 'task_assigned',
                title: `${actorName()} assigned you '${before.title}'`,
                entity: 'task',
                entityId: id,
              })
            }
          } else {
            logActivity({
              taskId: id,
              clientId: before.clientId,
              action: 'updated',
              detail: { fields: changed },
            })
          }
          if (changed.includes('collaboratorIds')) {
            const had = new Set(before.collaboratorIds ?? [])
            notifyCollaborators((patch.collaboratorIds ?? []).filter((c) => !had.has(c)), before.title, id)
          }
          notifyAdmins(
            'task_updated',
            `${actorName()} updated task '${before.title}'`,
            'task',
            id,
            assigneeChanged ? patch.assigneeId : undefined,
          )
        },

        setTaskStatus: (id, status) => {
          if (!allowed('tasks')) return false
          const task = get().tasks.find((t) => t.id === id)
          if (!task) return false
          if (task.status === status) return true
          // Subtasks gate their parent. Refused here rather than in the UI so
          // every path — board drag, modal, quick actions — obeys the same rule.
          if (status === 'done' && !canCompleteTask(get().tasks, id)) return false
          const now = nowIso()
          const completedAt = status === 'done' ? now : undefined
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === id ? { ...t, status, completedAt, updatedAt: now } : t,
            ),
          }))
          db.update('tasks', id, {
            status,
            completedAt: completedAt ?? null,
            updatedAt: now,
          })
          logActivity({
            taskId: id,
            clientId: task.clientId,
            action: 'status_changed',
            detail: { from: task.status, to: status },
          })
          if (status === 'done') {
            logActivity({
              taskId: id,
              clientId: task.clientId,
              action: 'completed',
              detail: { title: task.title },
            })
          }
          notifyAdmins(
            'task_updated',
            `${actorName()} moved task '${task.title}' to ${TASK_STATUS_LABEL[status]}`,
            'task',
            id,
          )
          return true
        },

        moveTask: (id, status, position) => {
          const before = get().tasks.find((t) => t.id === id)
          if (!before) return false
          // Reposition nothing when the status change is refused — a card that
          // can't enter Done must not be renumbered into that column either.
          if (!get().setTaskStatus(id, status)) return false
          const now = nowIso()

          // Positions are scoped per client board column (clientId + status):
          // renumber the target column with the task inserted at `position`
          // (clamped), and close the gap left in the source column when the
          // status changed — orderings stay independent per client and gapless.
          // Subtasks are excluded: they're ordered under their parent, not on
          // the board, so they must not consume board positions.
          const byBoardOrder = (a: Task, b: Task) =>
            a.position - b.position || a.createdAt.localeCompare(b.createdAt)
          const all = get().tasks
          const moved = all.find((t) => t.id === id)!
          const target = all
            .filter(
              (t) =>
                t.clientId === before.clientId &&
                t.status === status &&
                t.id !== id &&
                !t.parentTaskId,
            )
            .sort(byBoardOrder)
          const at = Math.max(0, Math.min(position, target.length))
          const positions = new Map<string, number>()
          const renumber = (column: Task[]) =>
            column.forEach((t, i) => {
              if (t.position !== i || t.id === id) positions.set(t.id, i)
            })
          renumber([...target.slice(0, at), moved, ...target.slice(at)])
          if (before.status !== status) {
            renumber(
              all
                .filter(
                  (t) =>
                    t.clientId === before.clientId &&
                    t.status === before.status &&
                    !t.parentTaskId,
                )
                .sort(byBoardOrder),
            )
          }

          set((s) => ({
            tasks: s.tasks.map((t) => {
              const pos = positions.get(t.id)
              if (pos === undefined) return t
              return t.id === id ? { ...t, position: pos, updatedAt: now } : { ...t, position: pos }
            }),
          }))
          positions.forEach((pos, taskId) =>
            db.update(
              'tasks',
              taskId,
              taskId === id ? { position: pos, updatedAt: now } : { position: pos },
            ),
          )
          return true
        },

        deleteTask: (id) => {
          if (!allowed('tasks')) return
          const task = get().tasks.find((t) => t.id === id)
          if (!task) return
          // Subtasks go with their parent — this mirrors the ON DELETE CASCADE
          // on tasks.parent_task_id (migration 015), so local and Supabase
          // modes agree. Subtasks are one level deep, so one pass is enough.
          const subtaskIds = get()
            .tasks.filter((t) => t.parentTaskId === id)
            .map((t) => t.id)
          const removed = new Set([id, ...subtaskIds])
          set((s) => ({
            tasks: s.tasks.filter((t) => !removed.has(t.id)),
            taskActivity: s.taskActivity.filter(
              (a) => !a.taskId || !removed.has(a.taskId),
            ),
            timeEntries: s.timeEntries.map((e) =>
              e.taskId && removed.has(e.taskId) ? { ...e, taskId: undefined } : e,
            ),
          }))
          db.remove('tasks', id)
          // Supabase cascades the children off the parent row; local mode has
          // no FKs, so remove them explicitly.
          subtaskIds.forEach((subId) => db.remove('tasks', subId))
          // Logged without taskId so the record survives the FK cascade
          logActivity({
            clientId: task.clientId,
            action: 'deleted',
            detail: { taskId: id, title: task.title },
          })
          notifyAdmins('task_updated', `${actorName()} deleted task '${task.title}'`, 'task', id)
        },

        // ── time entries ─────────────────────────────────────────────────

        addTimeEntry: (input) => {
          const row: TimeEntry = {
            userId: get().currentUserId ?? undefined,
            ...input,
            id: uid(),
            createdAt: nowIso(),
          }
          set((s) => ({ timeEntries: [...s.timeEntries, row] }))
          db.insert('timeEntries', row)
          return row.id
        },

        updateTimeEntry: (id, patch) => {
          set((s) => ({
            timeEntries: s.timeEntries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
          }))
          db.update('timeEntries', id, patch)
        },

        deleteTimeEntry: (id) => {
          if (!allowed('tasks')) return
          set((s) => ({ timeEntries: s.timeEntries.filter((e) => e.id !== id) }))
          db.remove('timeEntries', id)
        },

        // ── crm ──────────────────────────────────────────────────────────

        addCrmTable: (input) => {
          const now = nowIso()
          const row: CrmTable = {
            createdBy: get().currentUserId ?? undefined,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ crmTables: [...s.crmTables, row] }))
          db.insert('crmTables', row)
          notifyAdmins('crm_updated', `${actorName()} created CRM table '${row.name}'`, 'crm_table', row.id)
          return row.id
        },

        updateCrmTable: (id, patch) => {
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            crmTables: s.crmTables.map((t) => (t.id === id ? { ...t, ...full } : t)),
          }))
          db.update('crmTables', id, full)
          const name = get().crmTables.find((t) => t.id === id)?.name ?? 'table'
          notifyAdmins('crm_updated', `${actorName()} updated CRM table '${name}'`, 'crm_table', id)
        },

        deleteCrmTable: (id) => {
          if (!allowed('crm')) return
          const name = get().crmTables.find((t) => t.id === id)?.name ?? 'table'
          set((s) => ({
            crmTables: s.crmTables.filter((t) => t.id !== id),
            crmColumns: s.crmColumns.filter((c) => c.tableId !== id),
            crmRows: s.crmRows.filter((r) => r.tableId !== id),
          }))
          db.remove('crmTables', id)
          notifyAdmins('crm_updated', `${actorName()} deleted CRM table '${name}'`, 'crm_table', id)
        },

        addCrmColumn: (input) => {
          // A given sortOrder inserts there (the header's left/right "+"): the
          // columns from that place on move one along, and only they are written.
          const siblings = get().crmColumns.filter((c) => c.tableId === input.tableId)
          const end = siblings.reduce((m, c) => Math.max(m, c.sortOrder + 1), 0)
          const at = input.sortOrder ?? end
          const shifted = new Set(input.sortOrder === undefined ? [] : siblings.filter((c) => c.sortOrder >= at).map((c) => c.id))
          const row: CrmColumn = {
            options: [],
            ...input,
            sortOrder: at,
            id: uid(),
          }
          set((s) => ({
            crmColumns: [
              ...s.crmColumns.map((c) => (shifted.has(c.id) ? { ...c, sortOrder: c.sortOrder + 1 } : c)),
              row,
            ],
          }))
          for (const c of siblings) if (shifted.has(c.id)) db.update('crmColumns', c.id, { sortOrder: c.sortOrder + 1 })
          db.insert('crmColumns', row)
          notifyAdmins('crm_updated', `${actorName()} added column '${row.name}'`, 'crm_column', row.id)
          return row.id
        },

        updateCrmColumn: (id, patch) => {
          set((s) => ({
            crmColumns: s.crmColumns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          }))
          db.update('crmColumns', id, patch)
        },

        deleteCrmColumn: (id) => {
          if (!allowed('crm')) return
          set((s) => ({
            crmColumns: s.crmColumns.filter((c) => c.id !== id),
            crmRows: s.crmRows.map((r) => {
              if (!(id in r.values)) return r
              const values = { ...r.values }
              delete values[id]
              return { ...r, values }
            }),
          }))
          db.remove('crmColumns', id)
        },

        reorderColumns: (tableId, orderedIds) => {
          const before = new Map(get().crmColumns.map((c) => [c.id, c.sortOrder]))
          set((s) => ({
            crmColumns: s.crmColumns.map((c) =>
              c.tableId === tableId && orderedIds.includes(c.id)
                ? { ...c, sortOrder: orderedIds.indexOf(c.id) }
                : c,
            ),
          }))
          // Only the columns whose place changed are written.
          orderedIds.forEach((id, index) => {
            if (before.get(id) !== index) db.update('crmColumns', id, { sortOrder: index })
          })
        },

        addCrmRow: (input) => {
          const now = nowIso()
          const row: CrmRow = {
            values: {},
            position: get().crmRows.filter((r) => r.tableId === input.tableId).length,
            createdBy: get().currentUserId ?? undefined,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ crmRows: [...s.crmRows, row] }))
          db.insert('crmRows', row)
          notifyAdmins('crm_updated', `${actorName()} added a CRM row`, 'crm_row', row.id)
          return row.id
        },

        updateCrmRow: (id, patch) => {
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            crmRows: s.crmRows.map((r) => (r.id === id ? { ...r, ...full } : r)),
          }))
          db.update('crmRows', id, full)
          notifyAdmins('crm_updated', `${actorName()} updated a CRM row`, 'crm_row', id)
        },

        deleteCrmRow: (id) => {
          if (!allowed('crm')) return
          set((s) => ({ crmRows: s.crmRows.filter((r) => r.id !== id) }))
          db.remove('crmRows', id)
          notifyAdmins('crm_updated', `${actorName()} deleted a CRM row`, 'crm_row', id)
        },

        setCellValue: (rowId, columnId, value) => {
          const row = get().crmRows.find((r) => r.id === rowId)
          if (!row) return
          const values = { ...row.values, [columnId]: value }
          const full = { values, updatedAt: nowIso() }
          set((s) => ({
            crmRows: s.crmRows.map((r) => (r.id === rowId ? { ...r, ...full } : r)),
          }))
          db.update('crmRows', rowId, full)
        },

        // ── events & meetings ────────────────────────────────────────────

        addEvent: (input) => {
          const now = nowIso()
          const row: EventItem = {
            kind: 'event',
            allDay: false,
            recurrence: 'none',
            createdBy: get().currentUserId ?? undefined,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ events: [...s.events, row] }))
          db.insert('events', row)
          notifyAdmins(
            row.kind === 'meeting' ? 'meeting_updated' : 'event_updated',
            `${actorName()} added ${row.kind} '${row.title}'`,
            'event',
            row.id,
          )
          return row.id
        },

        updateEvent: (id, patch) => {
          const before = get().events.find((e) => e.id === id)
          if (!before) return
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            events: s.events.map((e) => (e.id === id ? { ...e, ...full } : e)),
          }))
          db.update('events', id, full)
          const kind = patch.kind ?? before.kind
          notifyAdmins(
            kind === 'meeting' ? 'meeting_updated' : 'event_updated',
            `${actorName()} updated ${kind} '${before.title}'`,
            'event',
            id,
          )
        },

        deleteEvent: (id) => {
          const before = get().events.find((e) => e.id === id)
          if (!before) return
          set((s) => ({
            events: s.events.filter((e) => e.id !== id),
            // event_attendees cascades with its event (040).
            eventAttendees: s.eventAttendees.filter((a) => a.eventId !== id),
          }))
          db.remove('events', id)
          notifyAdmins(
            before.kind === 'meeting' ? 'meeting_updated' : 'event_updated',
            `${actorName()} deleted ${before.kind} '${before.title}'`,
            'event',
            id,
          )
        },

        setEventAttendees: (eventId, attendees) => {
          const s = get()
          const event = s.events.find((e) => e.id === eventId)
          if (!event) return false
          if (!allowed(event.kind === 'meeting' ? 'meetings' : 'calendar')) return false
          // One row per address; a teammate's profile email wins over a typed one.
          const wanted = new Map<string, AttendeeInput>()
          for (const a of attendees) {
            const email = a.email.trim().toLowerCase()
            if (!email.includes('@')) continue
            wanted.set(email, { email, profileId: a.profileId })
          }
          const current = s.eventAttendees.filter((a) => a.eventId === eventId)
          const keep = current.filter((a) => wanted.has(a.email.toLowerCase()))
          const drop = current.filter((a) => !wanted.has(a.email.toLowerCase()))
          const have = new Set(keep.map((a) => a.email.toLowerCase()))
          const add: EventAttendee[] = [...wanted.values()]
            .filter((a) => !have.has(a.email))
            .map((a) => ({
              id: uid(),
              eventId,
              profileId: a.profileId,
              email: a.email,
              responseStatus: 'needsAction',
              createdAt: nowIso(),
            }))
          if (add.length === 0 && drop.length === 0) return true
          const dropIds = new Set(drop.map((a) => a.id))
          set((st) => ({
            eventAttendees: [...st.eventAttendees.filter((a) => !dropIds.has(a.id)), ...add],
          }))
          drop.forEach((a) => db.remove('eventAttendees', a.id))
          add.forEach((a) => db.insert('eventAttendees', a))
          return true
        },

        // ── notifications ────────────────────────────────────────────────

        notify: (input) => pushNotifications([makeNotification(input)]),

        markRead: (id) => {
          set((s) => ({
            notifications: s.notifications.map((n) =>
              n.id === id ? { ...n, read: true } : n,
            ),
          }))
          db.update('notifications', id, { read: true })
        },

        markAllRead: () => {
          const s = get()
          const unread = s.notifications.filter(
            (n) => !n.read && n.userId === s.currentUserId,
          )
          set((st) => ({
            notifications: st.notifications.map((n) =>
              n.userId === st.currentUserId ? { ...n, read: true } : n,
            ),
          }))
          unread.forEach((n) => db.update('notifications', n.id, { read: true }))
        },

        deleteNotification: (id) => {
          set((s) => {
            const gone = s.notifications.find((n) => n.id === id)
            const notifications = s.notifications.filter((n) => n.id !== id)
            // A dismissed due reminder stays dismissed for the day: with its
            // row gone, checkDueReminders would otherwise write it again on
            // the next pull (a seeded one, or one another device created).
            if (gone?.type !== 'due_reminder' || !gone.entityId || s.lastReminderCheck !== isoDate()) {
              return { notifications }
            }
            const key = dismissedReminderKey(gone.userId, gone.entityId)
            return {
              notifications,
              remindedIds: s.remindedIds.includes(key) ? s.remindedIds : [...s.remindedIds, key],
            }
          })
          db.remove('notifications', id)
        },

        // ── chat ─────────────────────────────────────────────────────────

        startConversation: (participantIds, title) => {
          const s = get()
          const me = s.currentUserId
          if (!me || !currentUser() || isDeactivated(currentUser())) return null
          const others = [...new Set(participantIds)].filter(
            (id) => id !== me && s.users.some((u) => u.id === id && !isDeactivated(u)),
          )
          if (others.length === 0) return null
          const name = title?.trim().slice(0, 80) || undefined
          const isGroup = others.length > 1 || Boolean(name)
          if (!isGroup) {
            const existing = findDirectConversation(s.conversations, me, others[0])
            if (existing) return existing.id
          }
          const now = nowIso()
          const row: Conversation = {
            id: uid(),
            title: name,
            isGroup,
            participantIds: [me, ...others],
            createdBy: me,
            lastMessageAt: now,
            createdAt: now,
            updatedAt: now,
          }
          set((st) => ({ conversations: [...st.conversations, row] }))
          db.insert('conversations', row)
          return row.id
        },

        addTaskComment: async (taskId, body) => {
          const s = get()
          const me = currentUser()
          const task = s.tasks.find((t) => t.id === taskId)
          if (!me || !can(me, 'tasks', 'edit') || !task) return false
          const people = s.users.filter((u) => can(u, 'tasks', 'view') && !isDeactivated(u))
          const comment = encodeMentions(body.trim(), people)
          if (!comment || comment.length > 10000) return false
          const row: TaskActivity = { id: uid(), taskId, clientId: task.clientId, actorId: me.id, action: 'updated', detail: { comment }, createdAt: nowIso() }
          if (!await db.insert('taskActivity', row)) return false
          if (get().currentUserId !== me.id) return true
          set((st) => ({ taskActivity: [...st.taskActivity.filter((a) => a.id !== row.id), row] }))
          if (!isSupabaseConfigured) {
            const ids = new Set(mentionedUserIds(comment))
            pushNotifications(people.filter((u) => u.id !== me.id && ids.has(u.id)).map((u) => makeNotification({
              userId: u.id, actorId: me.id, type: 'task_updated', title: `${me.fullName} mentioned you on '${task.title}'`,
              body: plainPreview(comment, people, 140), entity: 'task', entityId: taskId,
            })))
          }
          return true
        },

        sendMessage: (conversationId, body, replyToId) => {
          if (replyToId && !get().messages.some((m) => m.id === replyToId && m.conversationId === conversationId)) return null
          const s = get()
          const me = s.currentUserId
          const text = body.trim()
          const conv = s.conversations.find((c) => c.id === conversationId)
          if (!me || !currentUser() || isDeactivated(currentUser()) || !text || text.length > MAX_MESSAGE_LENGTH || !conv || !conv.participantIds.includes(me)) return null
          // Never stamp a message before the thread's latest one — a skewed
          // clock would otherwise sort the reply above what it answers.
          const latest = lastMessageOf(s.messages, conversationId)
          const nowMs = Math.max(Date.now(), latest ? new Date(latest.createdAt).getTime() + 1 : 0)
          const createdAt = new Date(nowMs).toISOString()
          const row: ChatMessage = { id: uid(), conversationId, senderId: me, body: text, createdAt, ...(replyToId ? { replyToId } : {}) }
          set((st) => ({
            messages: [...st.messages, row],
            // Local mirror of the server trigger that bumps last_message_at.
            conversations: st.conversations.map((c) =>
              c.id === conversationId ? { ...c, lastMessageAt: createdAt } : c,
            ),
          }))
          trackMessageWrite(row, false)
          get().markConversationRead(conversationId)
          return row.id
        },

        sendMessageConfirmed: async (conversationId, body, replyToId) => {
          const id = get().sendMessage(conversationId, body, replyToId)
          if (!id) return null
          const write = messageWrites.get(id)
          return await write ? id : null
        },

        editMessage: (id, body) => {
          const text = body.trim()
          const msg = get().messages.find((m) => m.id === id)
          const me = currentUser()
          const conv = msg && get().conversations.find((c) => c.id === msg.conversationId)
          if (!me || isDeactivated(me) || !conv?.participantIds.includes(me.id) || !text || text.length > MAX_MESSAGE_LENGTH || !msg || msg.senderId !== me.id || msg.body === text) return
          const patch = { body: text, editedAt: nowIso() }
          set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
          db.update('messages', id, patch)
        },

        deleteMessage: (id) => {
          const msg = get().messages.find((m) => m.id === id)
          const me = currentUser()
          const conv = msg && get().conversations.find((c) => c.id === msg.conversationId)
          if (!me || isDeactivated(me) || !conv?.participantIds.includes(me.id) || !msg || msg.senderId !== me.id) return
          set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }))
          db.remove('messages', id)
        },

        markConversationRead: (conversationId) => {
          const s = get()
          const me = s.currentUserId
          if (!me || !currentUser() || isDeactivated(currentUser()) || !s.conversations.some((c) => c.id === conversationId && c.participantIds.includes(me))) return
          const latest = lastMessageOf(s.messages, conversationId)
          if (!latest) return
          const current = lastReadAt(s.conversationReads, conversationId, me)
          if (current && current >= latest.createdAt) return
          // Read "up to" the newest message even if this clock runs behind it.
          const at = latest.createdAt
          const existing = s.conversationReads.find(
            (r) => r.conversationId === conversationId && r.userId === me,
          )
          if (existing) {
            set((st) => ({
              conversationReads: st.conversationReads.map((r) =>
                r.id === existing.id ? { ...r, lastReadAt: at } : r,
              ),
            }))
            db.update('conversationReads', existing.id, { lastReadAt: at })
            return
          }
          const row: ConversationRead = { id: uid(), conversationId, userId: me, lastReadAt: at }
          set((st) => ({ conversationReads: [...st.conversationReads, row] }))
          db.insert('conversationReads', row)
        },

        renameConversation: (id, title) => {
          const conv = get().conversations.find((c) => c.id === id)
          const me = currentUser()
          if (!conv || !conv.isGroup || !me || isDeactivated(me) || !conv.participantIds.includes(me.id)) return
          const patch = { title: title.trim().slice(0, 80) || undefined, updatedAt: nowIso() }
          set((s) => ({
            conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          }))
          // undefined keys are dropped when mapping to a row — send null to clear.
          db.update('conversations', id, { ...patch, title: patch.title ?? null })
        },

        deleteConversation: (id) => {
          const me = currentUser()
          const conv = get().conversations.find((c) => c.id === id)
          if (!me || isDeactivated(me) || !conv || !conv.participantIds.includes(me.id) || (conv.createdBy !== me.id && !isAdmin(me))) return
          set((s) => ({
            conversations: s.conversations.filter((c) => c.id !== id),
            messages: s.messages.filter((m) => m.conversationId !== id),
            conversationReads: s.conversationReads.filter((r) => r.conversationId !== id),
          }))
          db.remove('conversations', id) // messages + reads cascade
        },

        // ── channels ─────────────────────────────────────────────────────

        createChannelCategory: (name, clientId) => {
          const s = get()
          const me = s.currentUserId
          const label = name.trim().slice(0, 60)
          if (!me || !label) return null
          const space = s.clients.some((c) => c.id === clientId) ? clientId : undefined
          const now = nowIso()
          const position = s.channelCategories
            .filter((c) => c.clientId === space)
            .reduce((max, c) => Math.max(max, c.position + 1), 0)
          const row: ChannelCategory = {
            id: uid(), clientId: space, name: label, position, createdBy: me, createdAt: now, updatedAt: now,
          }
          set((s) => ({ channelCategories: [...s.channelCategories, row] }))
          db.insert('channelCategories', row)
          return row.id
        },

        renameChannelCategory: (id, name) => {
          const s = get()
          const cat = s.channelCategories.find((c) => c.id === id)
          const me = s.users.find((u) => u.id === s.currentUserId)
          const label = name.trim().slice(0, 60)
          if (!cat || !label || label === cat.name || !canManageCategory(cat, me)) return
          const patch = { name: label, updatedAt: nowIso() }
          set((st) => ({
            channelCategories: st.channelCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          }))
          db.update('channelCategories', id, patch)
        },

        deleteChannelCategory: (id) => {
          const s = get()
          const cat = s.channelCategories.find((c) => c.id === id)
          const me = s.users.find((u) => u.id === s.currentUserId)
          if (!cat || !canManageCategory(cat, me)) return
          set((st) => ({
            channelCategories: st.channelCategories.filter((c) => c.id !== id),
            // Local mirror of ON DELETE SET NULL.
            channels: st.channels.map((c) => (c.categoryId === id ? { ...c, categoryId: undefined } : c)),
          }))
          db.remove('channelCategories', id)
        },

        createChannel: (input) => {
          const s = get()
          const me = s.currentUserId
          const name = slugifyChannelName(input.name)
          if (!me || !isValidChannelName(name)) return null
          const isPrivate = Boolean(input.isPrivate)
          const clientId = s.clients.some((c) => c.id === input.clientId) ? input.clientId : undefined
          // A category only counts if it lives in the same space.
          const categoryId = s.channelCategories.some((c) => c.id === input.categoryId && c.clientId === clientId)
            ? input.categoryId
            : undefined
          const now = nowIso()
          const row: Channel = {
            id: uid(),
            clientId,
            categoryId,
            name,
            topic: input.topic?.trim().slice(0, MAX_CHANNEL_TOPIC_LENGTH) || undefined,
            kind: input.kind ?? 'text',
            isPrivate,
            memberIds: isPrivate ? [...new Set([me, ...(input.memberIds ?? [])])] : [],
            position: nextChannelPosition(s.channels.filter((c) => c.clientId === clientId), categoryId),
            createdBy: me,
            lastMessageAt: now,
            createdAt: now,
            updatedAt: now,
          }
          set((st) => ({ channels: [...st.channels, row] }))
          db.insert('channels', row)
          return row.id
        },

        updateChannel: (id, patch) => {
          const s = get()
          const channel = s.channels.find((c) => c.id === id)
          const me = s.users.find((u) => u.id === s.currentUserId)
          if (!channel || !me || !canManageChannel(channel, me)) return
          const next: Partial<Channel> = { updatedAt: nowIso() }
          if (patch.name !== undefined) {
            const name = slugifyChannelName(patch.name)
            if (!isValidChannelName(name)) return
            next.name = name
          }
          if (patch.topic !== undefined) next.topic = patch.topic.trim().slice(0, MAX_CHANNEL_TOPIC_LENGTH) || undefined
          if (patch.kind !== undefined) next.kind = patch.kind
          if ('categoryId' in patch) {
            const categoryId = s.channelCategories.some((c) => c.id === patch.categoryId && c.clientId === channel.clientId)
              ? patch.categoryId
              : undefined
            if (categoryId !== channel.categoryId) {
              next.categoryId = categoryId
              next.position = nextChannelPosition(s.channels.filter((c) => c.id !== id), categoryId)
            }
          }
          const isPrivate = patch.isPrivate ?? channel.isPrivate
          if (patch.isPrivate !== undefined) next.isPrivate = isPrivate
          if (patch.memberIds !== undefined || patch.isPrivate !== undefined) {
            // The manager doing the edit can never lock themselves out.
            const members = patch.memberIds ?? channel.memberIds
            next.memberIds = isPrivate ? [...new Set([me.id, ...members])] : []
          }
          set((st) => ({ channels: st.channels.map((c) => (c.id === id ? { ...c, ...next } : c)) }))
          // undefined keys are dropped when mapping to a row — send null to clear.
          db.update('channels', id, {
            ...next,
            ...('topic' in next ? { topic: next.topic ?? null } : {}),
            ...('categoryId' in next ? { categoryId: next.categoryId ?? null } : {}),
          })
        },

        deleteChannel: (id) => {
          const s = get()
          const channel = s.channels.find((c) => c.id === id)
          const me = s.users.find((u) => u.id === s.currentUserId)
          if (!channel || !canManageChannel(channel, me)) return
          set((st) => ({
            channels: st.channels.filter((c) => c.id !== id),
            channelMessages: st.channelMessages.filter((m) => m.channelId !== id),
            channelReactions: st.channelReactions.filter((r) => r.channelId !== id),
            channelReads: st.channelReads.filter((r) => r.channelId !== id),
          }))
          db.remove('channels', id) // messages, reactions and reads cascade
        },

        sendChannelMessage: (channelId, body, replyToId) => {
          const s = get()
          const me = s.users.find((u) => u.id === s.currentUserId)
          const channel = s.channels.find((c) => c.id === channelId)
          if (!me || !channel || !canPostInChannel(channel, me)) return null
          const text = encodeMentions(body.trim(), channelMembers(channel, s.users))
          if (!text || text.length > MAX_CHANNEL_MESSAGE_LENGTH) return null
          // Never stamp a message before the channel's latest one — a skewed
          // clock would otherwise sort the reply above what it answers.
          const latest = latestChannelMessage(s.channelMessages, channelId)
          const nowMs = Math.max(Date.now(), latest ? new Date(latest.createdAt).getTime() + 1 : 0)
          const createdAt = new Date(nowMs).toISOString()
          const parent = replyToId
            ? s.channelMessages.find((m) => m.id === replyToId && m.channelId === channelId)
            : undefined
          if (replyToId && !parent) return null
          const row: ChannelMessage = {
            id: uid(),
            channelId,
            senderId: me.id,
            body: text,
            replyToId: parent?.id,
            createdAt,
          }
          set((st) => ({
            channelMessages: [...st.channelMessages, row],
            // Local mirror of the server trigger that bumps last_message_at.
            channels: st.channels.map((c) => (c.id === channelId ? { ...c, lastMessageAt: createdAt } : c)),
          }))
          trackMessageWrite(row, true)
          get().markChannelRead(channelId)

          // Local mode mirrors the server's one notification per eligible
          // reader. Mentions and replies change its title, not its count.
          const mentioned = new Set(mentionedUserIds(text))
          const targets = new Set(channelMembers(channel, s.users).map((u) => u.id))
          if (parent?.senderId) targets.add(parent.senderId)
          const preview = plainPreview(text, s.users, 140)
          const rows = [...targets]
            .filter((id) => id !== me.id)
            .map((id) => s.users.find((u) => u.id === id))
            .filter((u): u is User => Boolean(u) && canViewChannel(channel, u))
            .map((u) =>
              makeNotification({
                userId: u.id,
                actorId: me.id,
                type: 'channel_mention',
                title: mentioned.has(u.id)
                  ? `${me.fullName} mentioned you in #${channel.name}`
                  : parent?.senderId === u.id ? `${me.fullName} replied to you in #${channel.name}` : `${me.fullName} posted in #${channel.name}`,
                body: preview,
                entity: 'channel',
                entityId: channelId,
              }),
            )
          if (!isSupabaseConfigured) pushNotifications(rows)
          // Remote channel notifications are generated transactionally by migration 061.
          return row.id
        },

        sendChannelMessageConfirmed: async (channelId, body, replyToId) => {
          const id = get().sendChannelMessage(channelId, body, replyToId)
          if (!id) return null
          const write = messageWrites.get(id)
          return await write ? id : null
        },

        editChannelMessage: (id, body) => {
          const s = get()
          const msg = s.channelMessages.find((m) => m.id === id)
          const me = currentUser()
          const channel = msg && s.channels.find((c) => c.id === msg.channelId)
          if (!msg || !me || !channel || !canViewChannel(channel, me) || msg.senderId !== me.id) return
          const text = encodeMentions(body.trim(), channelMembers(channel, s.users))
          if (!text || text.length > MAX_CHANNEL_MESSAGE_LENGTH || text === msg.body) return
          const patch = { body: text, editedAt: nowIso() }
          set((st) => ({ channelMessages: st.channelMessages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
          db.update('channelMessages', id, patch)
        },

        deleteChannelMessage: (id) => {
          const s = get()
          const msg = s.channelMessages.find((m) => m.id === id)
          const channel = msg && s.channels.find((c) => c.id === msg.channelId)
          const me = s.users.find((u) => u.id === s.currentUserId)
          if (!msg || !me || !channel || !canViewChannel(channel, me)) return
          if (msg.senderId !== me.id && !(channel && canManageChannel(channel, me))) return
          set((st) => ({
            channelMessages: st.channelMessages
              .filter((m) => m.id !== id)
              // Local mirror of reply_to_id ON DELETE SET NULL.
              .map((m) => (m.replyToId === id ? { ...m, replyToId: undefined } : m)),
            channelReactions: st.channelReactions.filter((r) => r.messageId !== id),
          }))
          db.remove('channelMessages', id)
        },

        togglePinChannelMessage: (id) => {
          const s = get()
          const msg = s.channelMessages.find((m) => m.id === id)
          const channel = msg && s.channels.find((c) => c.id === msg.channelId)
          const me = s.users.find((u) => u.id === s.currentUserId)
          if (!msg || !channel || !me || !canManageChannel(channel, me)) return
          const patch = msg.pinnedAt
            ? { pinnedAt: undefined, pinnedBy: undefined }
            : { pinnedAt: nowIso(), pinnedBy: me.id }
          set((st) => ({ channelMessages: st.channelMessages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
          db.update('channelMessages', id, { pinnedAt: patch.pinnedAt ?? null, pinnedBy: patch.pinnedBy ?? null })
        },

        toggleChannelReaction: (messageId, emoji) => {
          const s = get()
          const me = s.users.find((u) => u.id === s.currentUserId)
          const msg = s.channelMessages.find((m) => m.id === messageId)
          const channel = msg && s.channels.find((c) => c.id === msg.channelId)
          if (!me || !msg || !channel || !canViewChannel(channel, me) || !emoji) return
          const existing = s.channelReactions.filter(
            (r) => r.messageId === messageId && r.userId === me.id && r.emoji === emoji,
          )
          if (existing.length > 0) {
            const ids = new Set(existing.map((r) => r.id))
            set((st) => ({ channelReactions: st.channelReactions.filter((r) => !ids.has(r.id)) }))
            existing.forEach((r) => db.remove('channelReactions', r.id))
            return
          }
          const row: ChannelReaction = {
            id: uid(),
            messageId,
            channelId: msg.channelId,
            userId: me.id,
            emoji,
            createdAt: nowIso(),
          }
          set((st) => ({ channelReactions: [...st.channelReactions, row] }))
          db.insert('channelReactions', row)
        },

        markChannelRead: (channelId) => {
          const s = get()
          const me = s.currentUserId
          const channel = s.channels.find((c) => c.id === channelId)
          if (!me || !channel || !canViewChannel(channel, currentUser())) return
          const latest = latestChannelMessage(s.channelMessages, channelId)
          if (!latest) return
          const current = channelLastReadAt(s.channelReads, channelId, me)
          if (current && current >= latest.createdAt) return
          // Read "up to" the newest message even if this clock runs behind it.
          const at = latest.createdAt
          const existing = s.channelReads.find((r) => r.channelId === channelId && r.userId === me)
          if (existing) {
            set((st) => ({
              channelReads: st.channelReads.map((r) => (r.id === existing.id ? { ...r, lastReadAt: at } : r)),
            }))
            db.update('channelReads', existing.id, { lastReadAt: at })
            return
          }
          const row: ChannelRead = { id: uid(), channelId, userId: me, lastReadAt: at }
          set((st) => ({ channelReads: [...st.channelReads, row] }))
          db.insert('channelReads', row)
        },

        // ── eod reports ──────────────────────────────────────────────────

        // Persist a rendered EOD report. Upsert keyed on (author, client, date):
        // re-saving the same day updates the existing row rather than piling up
        // duplicates. Dual-writes like every other action (local + Supabase).
        saveEodReport: ({ clientId, reportDate, content, totalMinutes }) => {
          const now = nowIso()
          const authorId = get().currentUserId ?? undefined
          const existing = get().eodReports.find(
            (r) => r.authorId === authorId && r.clientId === clientId && r.reportDate === reportDate,
          )
          if (existing) {
            const patch = { content, totalMinutes, updatedAt: now }
            set((s) => ({
              eodReports: s.eodReports.map((r) => (r.id === existing.id ? { ...r, ...patch } : r)),
            }))
            db.update('eodReports', existing.id, patch)
            return
          }
          const row: EodReport = {
            id: uid(),
            authorId,
            clientId,
            reportDate,
            content,
            totalMinutes,
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ eodReports: [...s.eodReports, row] }))
          db.insert('eodReports', row)
        },

        // ── courses: training library ────────────────────────────────────
        // Cascade deletes are mirrored locally so local mode matches the SQL
        // ON DELETE CASCADE; remote rows are removed by Postgres itself, so
        // only the parent needs a db.remove() call.

        addCourse: (input) => {
          const now = nowIso()
          const row: Course = {
            position: get().courses.length,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ courses: [...s.courses, row] }))
          db.insert('courses', row)
          return row.id
        },

        updateCourse: (id, patch) => {
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            courses: s.courses.map((c) => (c.id === id ? { ...c, ...full } : c)),
          }))
          db.update('courses', id, full)
        },

        deleteCourse: (id) => {
          if (!allowed('courses')) return
          set((s) => {
            const moduleIds = s.courseModules.filter((m) => m.courseId === id).map((m) => m.id)
            return {
              courses: s.courses.filter((c) => c.id !== id),
              courseModules: s.courseModules.filter((m) => m.courseId !== id),
              courseTopics: s.courseTopics.filter((t) => !moduleIds.includes(t.moduleId)),
            }
          })
          db.remove('courses', id)
        },

        addCourseModule: (input) => {
          const now = nowIso()
          const row: CourseModule = {
            position: get().courseModules.filter((m) => m.courseId === input.courseId).length,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ courseModules: [...s.courseModules, row] }))
          db.insert('courseModules', row)
          return row.id
        },

        updateCourseModule: (id, patch) => {
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            courseModules: s.courseModules.map((m) => (m.id === id ? { ...m, ...full } : m)),
          }))
          db.update('courseModules', id, full)
        },

        deleteCourseModule: (id) => {
          if (!allowed('courses')) return
          set((s) => ({
            courseModules: s.courseModules.filter((m) => m.id !== id),
            courseTopics: s.courseTopics.filter((t) => t.moduleId !== id),
          }))
          db.remove('courseModules', id)
        },

        addCourseTopic: (input) => {
          const now = nowIso()
          const row: CourseTopic = {
            position: get().courseTopics.filter((t) => t.moduleId === input.moduleId).length,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ courseTopics: [...s.courseTopics, row] }))
          db.insert('courseTopics', row)
          return row.id
        },

        updateCourseTopic: (id, patch) => {
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            courseTopics: s.courseTopics.map((t) => (t.id === id ? { ...t, ...full } : t)),
          }))
          db.update('courseTopics', id, full)
        },

        addRecordingFolder: ({ clientId, name }) => {
          if (!allowed('meetings')) throw new Error('You need edit access to meetings.')
          const label = name.trim()
          if (!label || label.length > 80) throw new Error('Give the category a name of up to 80 characters.')
          if (!get().clients.some((c) => c.id === clientId)) throw new Error('Choose an existing client.')
          const now = nowIso()
          const row: RecordingFolder = { id: uid(), clientId, name: label, createdBy: get().currentUserId ?? undefined, createdAt: now, updatedAt: now }
          set((s) => ({ recordingFolders: [...s.recordingFolders, row] }))
          db.insert('recordingFolders', row)
          return row.id
        },

        renameRecordingFolder: (id, name) => {
          if (!allowed('meetings')) throw new Error('You need edit access to meetings.')
          const label = name.trim()
          if (!label || label.length > 80) throw new Error('Give the category a name of up to 80 characters.')
          const patch = { name: label, updatedAt: nowIso() }
          set((s) => ({ recordingFolders: s.recordingFolders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
          db.update('recordingFolders', id, patch)
        },

        deleteRecordingFolder: (id) => {
          if (!allowed('meetings')) return
          // Its recordings stay with the client, unfiled (058: ON DELETE SET NULL).
          set((s) => ({
            recordingFolders: s.recordingFolders.filter((f) => f.id !== id),
            meetingRecordings: s.meetingRecordings.map((r) => (r.folderId === id ? { ...r, folderId: undefined } : r)),
          }))
          db.remove('recordingFolders', id)
        },

        addRecording: (input) => {
          if (!allowed('meetings')) throw new Error('You need edit access to meetings.')
          const now = nowIso()
          const row: MeetingRecording = {
            ...fileRecording(input, get()),
            id: uid(),
            createdBy: get().currentUserId ?? undefined,
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ meetingRecordings: [row, ...s.meetingRecordings] }))
          db.insert('meetingRecordings', row)
          return row.id
        },

        updateRecording: (id, patch) => {
          if (!allowed('meetings')) throw new Error('You need edit access to meetings.')
          const before = get().meetingRecordings.find((r) => r.id === id)
          if (!before) throw new Error('This recording is no longer available.')
          const filed = fileRecording({ ...before, ...patch }, get())
          const full = { ...patch, clientId: filed.clientId, folderId: filed.folderId, title: filed.title, url: filed.url, updatedAt: nowIso() }
          set((s) => ({ meetingRecordings: s.meetingRecordings.map((r) => (r.id === id ? { ...r, ...full } : r)) }))
          db.update('meetingRecordings', id, full)
        },

        deleteRecording: (id) => {
          if (!allowed('meetings')) return
          set((s) => ({ meetingRecordings: s.meetingRecordings.filter((r) => r.id !== id) }))
          db.remove('meetingRecordings', id)
        },

        deleteCourseTopic: (id) => {
          if (!allowed('courses')) return
          set((s) => ({ courseTopics: s.courseTopics.filter((t) => t.id !== id) }))
          db.remove('courseTopics', id)
        },

        // ── growth: campaigns ────────────────────────────────────────────

        addCampaign: (input) => {
          const now = nowIso()
          const row: Campaign = {
            status: 'active',
            contacted: 0,
            opens: 0,
            replies: 0,
            positive: 0,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          set((s) => ({ campaigns: [...s.campaigns, row] }))
          db.insert('campaigns', row)
          return row.id
        },

        updateCampaign: (id, patch) => {
          const full = { ...patch, updatedAt: nowIso() }
          set((s) => ({
            campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, ...full } : c)),
          }))
          db.update('campaigns', id, full)
        },

        deleteCampaign: (id) => {
          if (!allowed('growth')) return
          set((s) => ({ campaigns: s.campaigns.filter((c) => c.id !== id) }))
          db.remove('campaigns', id)
        },

        // ── growth: leads (Growth Hub's own pipeline) ────────────────────

        addLead: (input) => {
          const now = nowIso()
          const row: Lead = {
            stage: 'new',
            value: 0,
            source: 'other',
            hot: false,
            ...input,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          // Local mode has no lead_score(): score intake-style leads here so
          // the demo ranks them the way the server would. Remote mode never
          // sends a score column the app made up.
          if (!isSupabaseConfigured && row.score === undefined && (row.budgetBand || row.timeline || row.services?.length)) {
            const scored = scoreLead(row)
            row.score = scored.score
            row.scoreBreakdown = scored.breakdown
            row.hot = row.hot || scored.hot
          }
          set((s) => ({ leads: [...s.leads, row] }))
          db.insert('leads', row)
          logLeadActivity({ leadId: row.id, action: 'created', detail: { name: row.name, source: row.source } })
          return row.id
        },

        updateLead: (id, patch) => {
          const full: Partial<Lead> = { ...patch, updatedAt: nowIso() }
          const lead = get().leads.find((l) => l.id === id)
          // Local mode stands in for leads_apply_score (034): an open lead is
          // re-scored when an input changes; a closed one keeps its number,
          // and the score only ever switches `hot` on. Remote mode leaves the
          // score to the trigger and never sends one it made up.
          if (!isSupabaseConfigured && lead && lead.score !== undefined && isOpenLead({ ...lead, spam: false })) {
            const inputs = ['budgetBand', 'timeline', 'email', 'company', 'phone', 'message', 'services', 'submissionCount', 'existingClientId'] as const
            if (inputs.some((k) => k in patch)) {
              const scored = scoreLead({ ...lead, ...full })
              full.score = scored.score
              full.scoreBreakdown = scored.breakdown
              if (scored.hot && lead.score < HOT_SCORE && !lead.spam && !('hot' in patch)) full.hot = true
            }
          }
          set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, ...full } : l)) }))
          db.update('leads', id, full)
        },

        // Stage moves are events, not just field writes. Without this history the
        // funnel has no time dimension: no response time, no time-in-stage, and
        // "won this month" can only be guessed from updatedAt (which any edit bumps).
        moveLeadStage: (id, stage, lostReason) => {
          const lead = get().leads.find((l) => l.id === id)
          if (!lead || lead.stage === stage) return
          const now = nowIso()

          const patch: Partial<Lead> = { stage }
          // Any move off 'new' is a first response if we haven't recorded one.
          if (stage !== 'new' && !lead.firstRespondedAt) patch.firstRespondedAt = now
          if (stage !== 'new') patch.lastTouchAt = now
          if (stage === 'lost') patch.lostReason = lostReason ?? 'other'
          else patch.lostReason = undefined

          get().updateLead(id, patch)
          logLeadActivity({ leadId: id, action: 'stage_changed', detail: { from: lead.stage, to: stage } })
          if (stage === 'won') {
            logLeadActivity({ leadId: id, action: 'won', detail: { name: lead.name, value: lead.value, source: lead.source } })
          }
          if (stage === 'lost') {
            logLeadActivity({ leadId: id, action: 'lost', detail: { name: lead.name, reason: lostReason ?? 'other' } })
          }
        },

        touchLead: (id, note) => {
          const lead = get().leads.find((l) => l.id === id)
          if (!lead) return
          const now = nowIso()
          const patch: Partial<Lead> = { lastTouchAt: now }
          if (!lead.firstRespondedAt) patch.firstRespondedAt = now
          get().updateLead(id, patch)
          logLeadActivity({ leadId: id, action: note ? 'note' : 'contacted', detail: note ? { note } : {} })
        },

        deleteLead: (id) => {
          if (!allowed('growth')) return
          set((s) => ({
            leads: s.leads.filter((l) => l.id !== id),
            leadActivity: s.leadActivity.filter((a) => a.leadId !== id),
          }))
          db.remove('leads', id) // remote FK cascade handles lead_activity
        },

        convertLeadToClient: (id) => {
          void get().convertLead(id)
        },

        // Not async on purpose: the local path finishes synchronously, so a
        // caller that doesn't await (convertLeadToClient) still sees the
        // client in the store on the next line.
        convertLead: (id, service) => {
          const lead = get().leads.find((l) => l.id === id)
          if (!lead) return Promise.resolve({ ok: false, error: 'Lead not found' })
          if (!allowed('growth') || !allowed('clients')) {
            return Promise.resolve({ ok: false, error: 'Converting a lead needs edit access to Growth and Clients.' })
          }
          const pick = normalizeService(service, lead.services?.[0])

          /**
           * The client-side path: local mode, or a database without
           * convert_lead yet. Mirrors 036 step for step — the same refusals,
           * names, starter tasks and history rows.
           */
          const convertHere = (): ConvertLeadResult => {
            const st = get()
            const current = st.leads.find((l) => l.id === id) ?? lead
            // Idempotent like the RPC: a converted lead hands back what it became.
            const done = st.leadActivity.find((a) => a.leadId === id && a.action === 'converted')
            if (done) {
              const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
              const clientId = str(done.detail.client_id) ?? str(done.detail.clientId) ?? current.clientId
              if (clientId) {
                return { ok: true, clientId, projectId: str(done.detail.project_id) ?? str(done.detail.projectId) }
              }
            }
            if (current.spam) return { ok: false, error: 'Mark this lead as not spam before converting it' }
            // An existing client (linked, or matched by email at intake) gets
            // the project; their own company name wins over the enquiry's.
            const existing = st.clients.find((c) => c.id === (current.clientId ?? current.existingClientId))
            const company =
              existing?.company?.trim() || existing?.name.trim() || current.company?.trim() || current.name.trim() || 'New client'
            const clientId = existing?.id ?? get().addClient({
              name: current.name.trim() || 'New client',
              company: current.company,
              email: current.email,
              phone: current.phone,
              notes: `Converted from a Growth lead (${current.source})${current.notes?.trim() ? `\n\n${current.notes}` : ''}`,
            })
            const projectId = get().addProject({
              clientId,
              title: convertedProjectTitle(current, pick, company),
              status: 'planning',
              budget: current.value > 0 ? current.value : undefined,
              assigneeId: current.ownerId,
              startDate: isoDate(),
              ...(current.message ? { notes: `From the enquiry:\n${current.message}`.slice(0, 5000) } : {}),
            })
            starterTasksFor(pick, company).forEach((title, i) => {
              get().addTask({
                clientId,
                projectId,
                title,
                priority: i === 0 ? 'high' : 'med',
                assigneeId: current.ownerId,
              })
            })
            // Link first, then move the stage through moveLeadStage so the 'won'
            // event is logged — going straight to updateLead would skip the history.
            get().updateLead(id, { clientId })
            get().moveLeadStage(id, 'won')
            // The keys convert_lead writes, so a later pull reads the same.
            logLeadActivity({
              leadId: id,
              action: 'converted',
              detail: { client_id: clientId, project_id: projectId, service: pick ?? null, new_client: !existing },
            })
            return { ok: true, clientId, projectId }
          }
          // addClient / addProject / addTask refuse invalid rows by throwing.
          const convertSafely = (): ConvertLeadResult => {
            converting = true
            try {
              return convertHere()
            } catch (error) {
              return { ok: false, error: error instanceof Error ? error.message : 'Could not convert the lead' }
            } finally {
              converting = false
            }
          }

          if (!isSupabaseConfigured) return Promise.resolve(convertSafely())

          return db.convertLead(id, pick).then(async (res) => {
            if (res.missing || res.local) return convertSafely()
            if (!res.ok || !res.clientId) return { ok: false, error: res.error ?? 'Could not convert the lead' }
            // The server made the rows; pull just those instead of a full hydrate.
            const [clients, projects, tasks, leads, activity] = await Promise.all([
              db.fetchWhere('clients', 'id', res.clientId),
              res.projectId ? db.fetchWhere('projects', 'id', res.projectId) : Promise.resolve(null),
              res.projectId ? db.fetchWhere('tasks', 'project_id', res.projectId) : Promise.resolve(null),
              db.fetchWhere('leads', 'id', id),
              db.fetchWhere('leadActivity', 'lead_id', id),
            ])
            mergeRows('clients', clients)
            mergeRows('projects', projects)
            mergeRows('tasks', tasks)
            mergeRows('leads', leads)
            mergeRows('leadActivity', activity)
            return { ok: true, clientId: res.clientId, projectId: res.projectId }
          })
        },

        assignLead: (id, ownerId) => {
          const lead = get().leads.find((l) => l.id === id)
          if (!lead || !growthEditor()) return false
          if (lead.ownerId === ownerId) return true
          get().updateLead(id, { ownerId })
          logLeadActivity({ leadId: id, action: 'assigned', detail: { from: lead.ownerId ?? null, to: ownerId ?? null } })
          if (ownerId) {
            notifyUser({
              userId: ownerId,
              actorId: get().currentUserId ?? undefined,
              type: 'lead_assigned',
              title: `${actorName()} assigned you the lead '${lead.company || lead.name}'`,
              entity: 'lead',
              entityId: id,
            })
          }
          return true
        },

        setLeadSpam: (id, spam, reason) => {
          const lead = get().leads.find((l) => l.id === id)
          if (!lead || !growthEditor()) return false
          if (Boolean(lead.spam) === spam) return true
          get().updateLead(id, { spam, spamReason: spam ? reason ?? 'manual' : undefined })
          logLeadActivity({
            leadId: id,
            action: spam ? 'spam_marked' : 'not_spam',
            detail: spam ? { reason: reason ?? 'manual' } : {},
          })
          return true
        },

        setLeadFollowUp: (id, date) => {
          const lead = get().leads.find((l) => l.id === id)
          if (!lead || !growthEditor()) return false
          if (lead.followUp === date) return true
          get().updateLead(id, { followUp: date })
          logLeadActivity({ leadId: id, action: 'followup_set', detail: { from: lead.followUp ?? null, to: date ?? null } })
          return true
        },

        logLeadTouch: (id, action, detail = {}) => {
          const lead = get().leads.find((l) => l.id === id)
          if (!lead || !growthEditor()) return false
          get().updateLead(id, touchStamp(lead, nowIso()))
          logLeadActivity({ leadId: id, action, detail })
          // A proposal out the door is the 'proposal' stage, whatever came before.
          if (action === 'proposal_sent' && (lead.stage === 'new' || lead.stage === 'contacted')) {
            get().moveLeadStage(id, 'proposal')
          }
          return true
        },

        importOljLinks: async (urls) => {
          const result = { added: 0, skipped: 0, failed: 0 }
          const me = currentUser()
          if (!me || !can(me, 'growth', 'edit') || urls.length > 50) return { ...result, failed: urls.length }
          for (const url of urls.slice(0, 50)) {
            if (get().currentUserId !== me.id) { result.failed++; continue }
            const parsed = oljLinks(url)
            if (parsed.urls.length !== 1 || parsed.invalid.length) { result.failed++; continue }
            const canonical = parsed.urls[0]
            if (get().jobPostings.some((job) => oljLinks(job.url).urls[0] === canonical)) { result.skipped++; continue }
            const row: JobPosting = { id: uid(), source: 'onlinejobs.ph', url: canonical, title: decodeURIComponent(new URL(canonical).pathname.split('/').pop()!).replace(/-/g, ' '), remote: true, tag: 'gig', dismissed: false, createdAt: nowIso(), application: { status: 'queued' } }
            if (!await db.insert('jobPostings', row)) { result.failed++; continue }
            if (get().currentUserId === me.id) set((st) => ({ jobPostings: [...st.jobPostings.filter((j) => j.id !== row.id), row] }))
            result.added++
          }
          return result
        },
        saveJobApplication: async (id, patch) => {
          const me = currentUser()
          if (!me || !can(me, 'growth', 'edit') || !get().jobPostings.some((j) => j.id === id)) return false
          if (!await db.saveJobApplication(id, patch)) return false
          if (get().currentUserId === me.id) set((st) => ({ jobPostings: st.jobPostings.map((j) => j.id === id ? { ...j, ...patch } : j) }))
          return true
        },

        dismissJobPosting: (id) => {
          set((s) => ({
            jobPostings: s.jobPostings.map((j) => (j.id === id ? { ...j, dismissed: true } : j)),
          }))
          db.update('jobPostings', id, { dismissed: true })
        },

        restoreJobPosting: (id) => {
          set((s) => ({
            jobPostings: s.jobPostings.map((j) => (j.id === id ? { ...j, dismissed: false } : j)),
          }))
          db.update('jobPostings', id, { dismissed: false })
        },

        // ── showcase ─────────────────────────────────────────────────────

        addShowcaseItem: (input) => {
          if (!allowed('showcase')) return null
          const s = get()
          const now = nowIso()
          const { status: wanted, ...rest } = input
          const row: ShowcaseItem = {
            kind: 'website',
            linkPublic: true,
            stack: [],
            featured: false,
            homeFeatured: false,
            sortOrder: (s.showcaseItems.reduce((max, i) => Math.max(max, i.sortOrder), -10) + 10),
            consent: 'unknown',
            linkStatus: 'unknown',
            linkFailCount: 0,
            ...rest,
            // A new item is never public: publishing is its own, admin-only step.
            status: wanted && wanted !== 'published' ? wanted : 'draft',
            slug: uniqueSlug(input.slug || input.title, s.showcaseItems.map((i) => i.slug)),
            createdBy: s.currentUserId ?? undefined,
            id: uid(),
            createdAt: now,
            updatedAt: now,
          }
          if (row.url !== undefined && !isHttpsUrl(row.url)) delete row.url
          // One item per project (037's unique index): the done trigger and a
          // manual "add to showcase" must not both make one.
          if (row.projectId && s.showcaseItems.some((i) => i.projectId === row.projectId)) return null
          // Server-stamped on insert; set here too so the local copy matches.
          delete row.publishedAt
          delete row.publishedBy
          row.publicUrl = row.linkPublic ? row.url : undefined
          if (row.consent !== 'unknown' && !row.consentAt) row.consentAt = now
          set((st) => ({ showcaseItems: [...st.showcaseItems, row] }))
          db.insert('showcaseItems', row)
          return row.id
        },

        updateShowcaseItem: (id, patch) => {
          const item = get().showcaseItems.find((i) => i.id === id)
          if (!item || !allowed('showcase')) return false
          // The guard trigger (037): what is live on the site is an admin's
          // to change — a member can't edit it, only an admin can take it down.
          if (item.status === 'published' && !isAdmin(currentUser())) return false
          // Server-owned: the trigger stamps these and derives public_url.
          const { status, ...rest } = patch
          const editable: Partial<ShowcaseItem> = { ...rest }
          for (const key of ['publicUrl', 'publishedAt', 'publishedBy', 'createdBy', 'createdAt'] as const) delete editable[key]
          // Status moves go through the publish rules; everything else is editing.
          if (status !== undefined && status !== item.status) {
            if (showcaseStatusError(currentUser(), item, status)) return false
          }
          const full: ShowcasePatch = { ...editable, ...(status !== undefined ? { status } : {}), updatedAt: nowIso() }
          if (full.url !== undefined && !isHttpsUrl(full.url)) return false
          if (full.slug !== undefined) {
            full.slug = uniqueSlug(full.slug, get().showcaseItems.filter((i) => i.id !== id).map((i) => i.slug))
          }
          // Published needs consent (the CHECK): editing consent away on a
          // published item would be refused server-side, so refuse it here.
          const after = { ...item, ...full }
          if (after.status === 'published' && !consentAllowsPublishing(after.consent)) return false
          const now = nowIso()
          // What the trigger stamps server-side, so local mode (and the
          // optimistic copy) reads the same before the echo arrives.
          const stamp: Partial<ShowcaseItem> = {
            publicUrl: after.linkPublic ? after.url : undefined,
            ...(status === 'published' && item.status !== 'published'
              ? { publishedAt: now, publishedBy: get().currentUserId ?? undefined }
              : {}),
            ...(full.consent !== undefined && full.consent !== item.consent ? { consentAt: now } : {}),
          }
          set((st) => ({
            showcaseItems: st.showcaseItems.map((i) => (i.id === id ? { ...i, ...full, ...stamp } : i)),
          }))
          db.update('showcaseItems', id, full)
          if (status !== undefined && status !== item.status && (status === 'published' || item.status === 'published')) {
            auditLocal(status === 'published' ? 'showcase.published' : 'showcase.unpublished', 'showcase', id, {
              from: item.status,
              to: status,
            })
          }
          return true
        },

        setShowcaseStatus: (id, status) => {
          const item = get().showcaseItems.find((i) => i.id === id)
          if (!item) return { ok: false, error: 'Showcase item not found' }
          const error = showcaseStatusError(currentUser(), item, status)
          if (error) return { ok: false, error }
          return get().updateShowcaseItem(id, { status })
            ? { ok: true }
            : { ok: false, error: 'This change was not allowed.' }
        },

        deleteShowcaseItem: (id) => {
          const item = get().showcaseItems.find((i) => i.id === id)
          if (!item || !allowed('showcase')) return false
          // Deleting a public item takes it down: that is unpublishing.
          if (item.status === 'published' && !isAdmin(currentUser())) return false
          const rest = get().showcaseItems.filter((i) => i.id !== id)
          set({ showcaseItems: rest })
          db.remove('showcaseItems', id)
          // Takedown removes the screenshots too — unless another item shares
          // them (keys are content-addressed, so a re-upload is the same object).
          const shared = new Set(rest.flatMap((i) => [i.imageKey, i.imageKeySmall]))
          const orphans = [item.imageKey, item.imageKeySmall].filter((k) => k && !shared.has(k))
          if (orphans.length > 0) {
            void import('../lib/showcaseImages').then((m) => m.removeShowcaseImages(orphans))
          }
          return true
        },

        setShowcaseImage: async (id, file, alt) => {
          const item = get().showcaseItems.find((i) => i.id === id)
          if (!item) return { ok: false, error: 'Showcase item not found' }
          if (!allowed('showcase')) return { ok: false, error: 'You need edit access to the Showcase.' }
          const images = await import('../lib/showcaseImages')
          const res = await images.uploadShowcaseImage(file)
          if (!res.ok) return { ok: false, error: res.error ?? 'Could not upload the image' }
          const old = [item.imageKey, item.imageKeySmall]
          const saved = get().updateShowcaseItem(id, {
            imageKey: res.imageKey,
            imageKeySmall: res.imageKeySmall,
            imageSource: 'upload',
            ...(alt !== undefined ? { imageAlt: alt } : {}),
          })
          if (!saved) return { ok: false, error: 'The image uploaded, but the item could not be updated.' }
          const inUse = new Set(get().showcaseItems.flatMap((i) => [i.imageKey, i.imageKeySmall]))
          const orphans = old.filter((k) => k && !inUse.has(k))
          if (orphans.length > 0) void images.removeShowcaseImages(orphans)
          return { ok: true }
        },

        // ── forms + project stages (046) ────────────────────────────────

        saveFormResponse: ({ form, projectId, clientId, leadId, answers, submit }) => {
          const template = FORM_TEMPLATES[form]
          if (!template) return { ok: false, error: 'Unknown form.' }
          const feature: PermFeature = projectId ? 'projects' : leadId ? 'growth' : 'clients'
          if (!allowed(feature)) return { ok: false, error: 'You need edit access to save this form.' }
          const s = get()
          const project = projectId ? s.projects.find((p) => p.id === projectId) : undefined
          const targetClientId = clientId ?? project?.clientId
          const existing = s.formResponses.find((r) =>
            r.form === form &&
            (projectId ? r.projectId === projectId
              : leadId ? r.leadId === leadId && !r.projectId
              : r.clientId === targetClientId && !r.projectId && !r.leadId))
          const clean = cleanAnswers(template, answers)
          // A submitted form stays submitted, so later edits are held to the same rules.
          const submitting = Boolean(submit) || existing?.status === 'submitted'
          if (submitting) {
            const missing = missingRequired(template, clean)
            if (missing.length) return { ok: false, error: `Still needed: ${missing.map((f) => f.label).join(', ')}` }
          }
          const invalid = formFields(template).find((f) => fieldError(f, clean[f.key]))
          if (invalid) return { ok: false, error: `${invalid.label}: ${fieldError(invalid, clean[invalid.key])}` }

          const now = nowIso()
          const me = s.currentUserId ?? undefined
          const stamp = submit && existing?.status !== 'submitted'
            ? { status: 'submitted' as const, submittedAt: now, submittedBy: me }
            : {}
          let id: string
          if (existing) {
            const patch = { answers: clean, version: template.version, ...stamp, updatedAt: now }
            set((st) => ({ formResponses: st.formResponses.map((r) => (r.id === existing.id ? { ...r, ...patch } : r)) }))
            db.update('formResponses', existing.id, patch)
            id = existing.id
          } else {
            const row: FormResponse = {
              id: uid(),
              form,
              version: template.version,
              projectId,
              clientId: targetClientId,
              leadId,
              answers: clean,
              status: 'draft',
              ...stamp,
              createdBy: me,
              createdAt: now,
              updatedAt: now,
            }
            set((st) => ({ formResponses: [...st.formResponses, row] }))
            db.insert('formResponses', row)
            id = row.id
          }

          if (submitting) {
            const bound = bindingsOf(template, clean)
            const client = targetClientId ? s.clients.find((c) => c.id === targetClientId) : undefined
            const clientPatch = Object.fromEntries(
              Object.entries(bound.client).filter(([k, v]) => client && client[k as keyof typeof client] !== v),
            )
            const projectPatch = Object.fromEntries(
              Object.entries(bound.project).filter(([k, v]) => project && project[k as keyof typeof project] !== v),
            )
            // The answers are already stored; a binding the store refuses is skipped.
            if (client && Object.keys(clientPatch).length && allowed('clients')) {
              try { get().updateClient(client.id, clientPatch) } catch { /* answers kept */ }
            }
            if (project && Object.keys(projectPatch).length) get().updateProject(project.id, projectPatch)
            const lead = leadId ? s.leads.find((l) => l.id === leadId) : undefined
            const leadPatch = Object.fromEntries(
              Object.entries(bound.lead).filter(
                ([k, v]) => lead && JSON.stringify(lead[k as keyof typeof lead]) !== JSON.stringify(v),
              ),
            )
            if (lead && Object.keys(leadPatch).length) get().updateLead(lead.id, leadPatch)
          }
          return { ok: true, id }
        },

        createFormLink: async ({ form, projectId, leadId, sharedTo, answers }) => {
          if (!isSupabaseConfigured) {
            return { ok: false, error: 'Customer links need the live workspace: the form they open is served from the database.' }
          }
          const template = FORM_TEMPLATES[form]
          if (!template?.customer) return { ok: false, error: 'This form can’t be sent to customers.' }
          if (!allowed(projectId ? 'projects' : 'growth')) return { ok: false, error: 'You need edit access to send this form.' }
          const find = () =>
            get().formResponses.find((r) =>
              r.form === form && (projectId ? r.projectId === projectId : r.leadId === leadId && !r.projectId))
          let response = find()
          if (!response) {
            const saved = get().saveFormResponse({ form, projectId, leadId, answers: answers ?? {} })
            if (!saved.ok) return saved
            response = find()
            if (!response) return { ok: false, error: 'Could not start the form.' }
          }
          const token = newFormToken()
          const hash = await sha256Hex(token)
          const now = nowIso()
          const shareExpiresAt = new Date(Date.now() + FORM_LINK_DAYS * 864e5).toISOString()
          const to = sharedTo?.trim() || undefined
          const id = response.id
          set((st) => ({
            formResponses: st.formResponses.map((r) =>
              r.id === id
                ? { ...r, shareTokenHash: hash, shareExpiresAt, sharedTo: to, sharedAt: now,
                    sharedBy: st.currentUserId ?? undefined, customerSubmittedAt: undefined, updatedAt: now }
                : r),
          }))
          // The stamps (shared_at, shared_by, reopening customer_submitted_at)
          // are 047's guard's; the app sends the hash, the expiry and the address.
          // Queued after the insert above, so the link works once this resolves.
          await db.update('formResponses', id, { shareTokenHash: hash, shareExpiresAt, sharedTo: to })
          return { ok: true, url: formLinkUrl(token) }
        },

        revokeFormLink: (responseId) => {
          const response = get().formResponses.find((r) => r.id === responseId)
          if (!response) return false
          if (!allowed(response.projectId ? 'projects' : response.leadId ? 'growth' : 'clients')) return false
          const patch = { shareTokenHash: undefined, shareExpiresAt: undefined, updatedAt: nowIso() }
          set((st) => ({ formResponses: st.formResponses.map((r) => (r.id === responseId ? { ...r, ...patch } : r)) }))
          // undefined → NULL in db.update: the hash goes, so the link 404s.
          db.update('formResponses', responseId, patch)
          return true
        },

        // ── email (049) ─────────────────────────────────────────────────

        sendEmail: ({ to, cc = [], subject, body, leadId, clientId, projectId, inReplyTo }) => {
          if (!leadId && !clientId && !projectId) return { ok: false, error: 'Pick who this email is about.' }
          const feature: PermFeature = projectId ? 'projects' : leadId ? 'growth' : 'clients'
          if (!allowed(feature)) return { ok: false, error: 'You need edit access to send email here.' }
          const toList = parseAddresses(to)
          const ccList = parseAddresses(cc).filter((a) => !toList.includes(a))
          const text = body.replace(/\r\n?/g, '\n').trimEnd()
          const problem = draftError({ to: toList, cc: ccList, subject, body: text })
          if (problem) return { ok: false, error: problem }
          const s = get()
          const now = nowIso()
          const row: Email = {
            id: uid(),
            direction: 'out',
            status: 'queued',
            leadId,
            clientId,
            projectId,
            // The server's guard stamps these from workspace_settings too.
            fromName: s.workspaceSettings.emailFromName,
            fromEmail: s.workspaceSettings.emailFromAddress,
            toEmails: toList,
            ccEmails: ccList,
            subject: subject.trim(),
            bodyText: text,
            inReplyTo,
            createdBy: s.currentUserId ?? undefined,
            createdAt: now,
            updatedAt: now,
          }
          set((st) => ({ emails: [row, ...st.emails] }))
          db.insert('emails', row)
          return { ok: true, id: row.id }
        },

        retryEmail: async (id) => {
          const email = get().emails.find((e) => e.id === id)
          if (!email || email.direction !== 'out' || email.status !== 'failed') return { ok: false, error: 'Only a failed email can be sent again.' }
          if (!isSupabaseConfigured) return { ok: false, error: 'Sending needs the live workspace.' }
          set((st) => ({ emails: st.emails.map((e) => (e.id === id ? { ...e, status: 'queued', error: undefined } : e)) }))
          const res = await db.retryEmail(id)
          if (!res.ok) {
            set((st) => ({ emails: st.emails.map((e) => (e.id === id ? { ...e, status: 'failed', error: email.error } : e)) }))
            return { ok: false, error: res.error === 'forbidden' ? 'You need edit access to send email here.' : 'Could not queue it again.' }
          }
          return { ok: true }
        },

        setProjectPhase: (id, phase, opts = {}) => {
          if (!allowed('projects')) return { ok: false, error: 'You need edit access to projects.' }
          const s = get()
          const project = s.projects.find((p) => p.id === id)
          if (!project) return { ok: false, error: 'Project not found.' }
          const from = phaseOf(project)
          if (from === phase) return { ok: true }
          if (opts.force && !isAdmin(currentUser())) return { ok: false, error: 'Only an admin can skip onboarding.' }
          if (phase === 'development' && from === 'onboarding' && !opts.force) {
            const onboarded = s.formResponses.some((r) => r.form === 'onboarding' && r.projectId === id && r.status === 'submitted')
            if (!onboarded) return { ok: false, error: 'Complete the onboarding form first.' }
          }
          const liveUrl = opts.liveUrl?.trim()
          if (liveUrl && !isHttpsUrl(liveUrl)) return { ok: false, error: 'The live URL must start with https://' }

          const now = nowIso()
          const patch: Partial<Project> = {
            phase,
            phaseChangedAt: now,
            status: statusOnEntering(phase, project.status),
            ...(liveUrl ? { liveUrl } : {}),
            updatedAt: now,
          }
          set((st) => ({ projects: st.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
          // One update: 037's showcase_on_project sees status 'done' and the
          // live URL together and drafts the portfolio entry.
          db.update('projects', id, patch)

          const title = `'${project.title}' moved to ${PHASE_LABEL[phase]}`
          const actorId = s.currentUserId ?? undefined
          if (project.assigneeId) {
            notifyUser({ userId: project.assigneeId, actorId, type: 'project_updated', title, entity: 'project', entityId: id })
          }
          notifyAdmins('project_updated', title, 'project', id, project.assigneeId)
          localShowcaseOnProject(id)
          return { ok: true }
        },

        // ── site subscribers ─────────────────────────────────────────────

        unsubscribeSubscriber: (id) => {
          const sub = get().siteSubscribers.find((x) => x.id === id)
          if (!sub || !growthEditor()) return false
          if (sub.unsubscribedAt) return true
          const patch = { unsubscribedAt: nowIso() }
          set((s) => ({ siteSubscribers: s.siteSubscribers.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
          // Only unsubscribed_at: it is the one column staff may write (039).
          db.update('siteSubscribers', id, patch)
          return true
        },

        resubscribeSubscriber: (id) => {
          const sub = get().siteSubscribers.find((x) => x.id === id)
          if (!sub || !growthEditor()) return false
          if (!sub.unsubscribedAt) return true
          set((s) => ({
            siteSubscribers: s.siteSubscribers.map((x) => (x.id === id ? { ...x, unsubscribedAt: undefined } : x)),
          }))
          // The key is present and empty: the mapper sends unsubscribed_at = null, and nothing else.
          db.update('siteSubscribers', id, { unsubscribedAt: undefined })
          auditLocal('subscriber.resubscribed', 'site_subscriber', id, { source: sub.source ?? null })
          return true
        },

        deleteSubscriber: (id) => {
          const sub = get().siteSubscribers.find((x) => x.id === id)
          if (!sub || !growthEditor()) return false
          set((s) => ({ siteSubscribers: s.siteSubscribers.filter((x) => x.id !== id) }))
          db.remove('siteSubscribers', id)
          auditLocal('subscriber.deleted', 'site_subscriber', id, { source: sub.source ?? null })
          return true
        },

        // ── automation ───────────────────────────────────────────────────

        checkDueReminders: () => {
          const s = get()
          const me = s.currentUserId
          if (!me) return
          const today = isoDate()
          const tomorrow = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
          const reminded = s.lastReminderCheck === today ? s.remindedIds : []
          const isAdmin = s.users.find((u) => u.id === me)?.role === 'admin'
          const rows: Notification[] = []
          const newKeys: string[] = []

          // Each device reminds only the signed-in user. Reminding everyone
          // from every device produced one copy per open browser, and RLS
          // (actor_id = auth.uid()) rejected the rows with no actor anyway.
          // A second device of the same user sees this one's reminder after
          // hydrate, so the existing rows are the cross-device dedupe.
          const already = (entityId: string) =>
            s.notifications.some(
              (n) =>
                n.userId === me &&
                n.type === 'due_reminder' &&
                n.entityId === entityId &&
                isoDate(n.createdAt) === today,
            )

          // Dismissed by this user on this device today (deleteNotification).
          const dismissed = (entityId: string) => reminded.includes(dismissedReminderKey(me, entityId))

          const remind = (title: string, entity: string, entityId: string) =>
            rows.push({
              id: uid(),
              userId: me,
              actorId: me,
              type: 'due_reminder',
              title,
              entity,
              entityId,
              read: false,
              createdAt: nowIso(),
            })

          // Tasks due today or tomorrow → the assignee, or admins if unassigned.
          for (const t of s.tasks) {
            if (t.status === 'done' || t.archived || !t.dueDate) continue
            const due = isoDate(t.dueDate)
            if (due !== today && due !== tomorrow) continue
            const mine = t.assigneeId ? t.assigneeId === me : isAdmin
            if (!mine) continue
            const key = `task:${t.id}:${due}`
            if (reminded.includes(key) || dismissed(t.id) || already(t.id)) continue
            remind(`Task '${t.title}' is due ${due === today ? 'today' : 'tomorrow'}`, 'task', t.id)
            newKeys.push(key)
          }

          // Meetings starting in the next 24h → creator + admins. The key
          // carries the start day: remindedIds resets daily, and a meeting
          // 20h away at 23:00 must not fire again after midnight.
          const nowMs = Date.now()
          for (const e of s.events) {
            if (e.kind !== 'meeting') continue
            const start = new Date(e.startsAt).getTime()
            if (start < nowMs || start > nowMs + 24 * 60 * 60 * 1000) continue
            if (!(isAdmin || e.createdBy === me)) continue
            const key = `meeting:${e.id}:${isoDate(e.startsAt)}`
            if (reminded.includes(key) || dismissed(e.id) || already(e.id)) continue
            remind(`Meeting '${e.title}' starts ${fmtRelative(e.startsAt)}`, 'event', e.id)
            newKeys.push(key)
          }

          if (rows.length === 0 && s.lastReminderCheck === today) return
          set((st) => ({
            notifications: [...rows, ...st.notifications],
            lastReminderCheck: today,
            remindedIds: [...reminded, ...newKeys],
          }))
          rows.forEach((n) => db.insert('notifications', n))
        },

        sweepAutoArchive: () => {
          const s = get()
          // Auto-archive is a workspace setting; only an admin's copy of it is
          // authoritative, and only admins can archive tasks server-side.
          if (s.users.find((u) => u.id === s.currentUserId)?.role !== 'admin') return
          const cutoff = Date.now() - s.settings.autoArchiveDays * 24 * 60 * 60 * 1000
          const stale = s.tasks.filter(
            (t) =>
              t.status === 'done' &&
              !t.archived &&
              t.completedAt &&
              new Date(t.completedAt).getTime() < cutoff,
          )
          if (stale.length === 0) return
          const ids = new Set(stale.map((t) => t.id))
          set((st) => ({
            tasks: st.tasks.map((t) => (ids.has(t.id) ? { ...t, archived: true } : t)),
          }))
          stale.forEach((t) => db.update('tasks', t.id, { archived: true }))
        },

        // Hard-delete task activity older than 48h, local + remote.
        //
        // NOT called yet (see hydrate) — it stays dormant until the n8n
        // `log-to-sheets` workflow is active and mirroring every row to Google
        // Sheets at INSERT time. Once that backup exists, uncomment the call in
        // hydrate: the Sheet is then always ahead of this purge, and the Home
        // 48h view filter covers the gap between sweeps.
        sweepActivity: () => {
          const cutoff = Date.now() - 48 * 60 * 60 * 1000
          const stale = get().taskActivity.filter(
            (a) => new Date(a.createdAt).getTime() < cutoff,
          )
          if (stale.length === 0) return
          const ids = new Set(stale.map((a) => a.id))
          set((st) => ({
            taskActivity: st.taskActivity.filter((a) => !ids.has(a.id)),
          }))
          stale.forEach((a) => db.remove('taskActivity', a.id))
        },
      }
    },
    {
      name: 'deskdev-store',
      // v2: workspace_settings (033). Without `migrate`, zustand drops a
      // store saved under another version — in local mode, all the data.
      version: 2,
      migrate: (persisted, version) => migratePersistedState(persisted, version) as State,
      storage: createJSONStorage(persistStorage),
      // Local mode IS the database, so everything persists. Remote mode keeps
      // only what a reload needs before the first pull: who is signed in
      // (users, so the sidebar and permissions don't flash), settings, and
      // the reminder bookkeeping — never the workspace rows themselves.
      partialize: (s) =>
        (isSupabaseConfigured
          ? {
              currentUserId: s.currentUserId,
              users: s.users,
              settings: s.settings,
              lastReminderCheck: s.lastReminderCheck,
              remindedIds: s.remindedIds,
              hydrated: false,
            }
          : { ...s, hydrated: false, synced: false, loadError: null }) as State,
    },
  ),
)

// Every remote write checks the session against this (db.ts, 'account-changed').
db.setCurrentUserGetter(() => useStore.getState().currentUserId)

// ─── Derived helpers ─────────────────────────────────────────────────────────

/** remindedIds entry for a due reminder its user dismissed (kept for the day, like the rest). */
function dismissedReminderKey(userId: string, entityId: string): string {
  return `dismissed:${userId}:${entityId}`
}

/** The signed-in user, or null. */
export function useCurrentUser(): User | null {
  return useStore((s) => s.users.find((u) => u.id === s.currentUserId) ?? null)
}

export interface EventOccurrence {
  event: EventItem
  /** ISO start of this concrete occurrence */
  startsAt: string
  endsAt?: string
  /** Stable key: `${event.id}:${YYYY-MM-DD}` */
  occurrenceId: string
}

/**
 * Materialize events (including daily/weekly/monthly recurrences, bounded by
 * recurrenceUntil) into concrete occurrences inside [rangeStart, rangeEnd] —
 * without ever storing duplicates.
 */
export function getEventOccurrences(
  events: EventItem[],
  rangeStart: Date | string,
  rangeEnd: Date | string,
): EventOccurrence[] {
  const start = new Date(rangeStart).getTime()
  const end = new Date(rangeEnd).getTime()
  const out: EventOccurrence[] = []

  for (const e of events) {
    const first = new Date(e.startsAt)
    const duration = e.endsAt
      ? Math.max(0, new Date(e.endsAt).getTime() - first.getTime())
      : 0

    if (e.recurrence === 'none') {
      const t = first.getTime()
      if (t + duration >= start && t <= end) {
        out.push({
          event: e,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          occurrenceId: `${e.id}:${isoDate(first)}`,
        })
      }
      continue
    }

    const until = e.recurrenceUntil
      ? new Date(`${e.recurrenceUntil}T23:59:59`).getTime()
      : end
    const limit = Math.min(end, until)
    const cursor = new Date(first)
    let guard = 0
    while (cursor.getTime() <= limit && guard < 1000) {
      const t = cursor.getTime()
      if (t + duration >= start) {
        out.push({
          event: e,
          startsAt: cursor.toISOString(),
          endsAt: duration > 0 ? new Date(t + duration).toISOString() : undefined,
          occurrenceId: `${e.id}:${isoDate(cursor)}`,
        })
      }
      if (e.recurrence === 'daily') cursor.setDate(cursor.getDate() + 1)
      else if (e.recurrence === 'weekly') cursor.setDate(cursor.getDate() + 7)
      else cursor.setMonth(cursor.getMonth() + 1)
      guard++
    }
  }

  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
