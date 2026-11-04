// PLATFORM-SPECIFIC:START
// (web imports React's useEffect and supabase's isAuthRetryableFetchError here for its hook)
// PLATFORM-SPECIFIC:END
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'
// PLATFORM-SPECIFIC:START
// Web mirrors every table its pages show; the mobile app has fewer screens,
// so fewer mappers and slices.
import {
  rowToUser, rowToClientCategory, rowToClient, rowToProjectCategory,
  rowToProjectEngagement, rowToProject, rowToTask, rowToTaskActivity, rowToTimeEntry,
  rowToCrmTable, rowToCrmColumn, rowToCrmRow, rowToEvent, rowToNotification,
  rowToEodReport, rowToCampaign, rowToJobPosting, rowToLead, rowToLeadActivity,
  rowToCourse, rowToCourseModule, rowToCourseTopic, rowToMeetingRecording, rowToRecordingFolder,
  rowToConversation, rowToChatMessage, rowToConversationRead,
  rowToChannelCategory, rowToChannel, rowToChannelMessage, rowToChannelReaction, rowToChannelRead,
  rowToShowcaseItem, rowToEventAttendee, rowToWorkspaceSettings, rowToFormResponse, rowToEmail,
} from './mappers'
// PLATFORM-SPECIFIC:END
import { isTableMissing } from './db'
import { useStore } from '../store/useStore'

type Row = Record<string, unknown>
type Synced = { id: string | number; updatedAt?: string }
type Mapper = (row: Row) => Synced
/**
 * `single`: a one-row table (workspace_settings) whose slice is the object
 * itself, not a list — an update replaces it, and it is never deleted.
 */
type SyncTarget = { slice: string; map: Mapper; single?: boolean }

// PLATFORM-SPECIFIC:START
// Postgres table → [store slice, row→app-object mapper]. Slice keys are the
// camelCase state fields on the store.
const TABLE_SYNC: Record<string, SyncTarget> = {
  profiles: { slice: 'users', map: rowToUser as Mapper },
  client_categories: { slice: 'clientCategories', map: rowToClientCategory as Mapper },
  clients: { slice: 'clients', map: rowToClient as Mapper },
  project_categories: { slice: 'projectCategories', map: rowToProjectCategory as Mapper },
  projects: { slice: 'projects', map: rowToProject as Mapper },
  project_engagements: { slice: 'projectEngagements', map: rowToProjectEngagement as Mapper },
  tasks: { slice: 'tasks', map: rowToTask as Mapper },
  task_activity: { slice: 'taskActivity', map: rowToTaskActivity as Mapper },
  time_entries: { slice: 'timeEntries', map: rowToTimeEntry as Mapper },
  crm_tables: { slice: 'crmTables', map: rowToCrmTable as Mapper },
  crm_columns: { slice: 'crmColumns', map: rowToCrmColumn as Mapper },
  crm_rows: { slice: 'crmRows', map: rowToCrmRow as Mapper },
  events: { slice: 'events', map: rowToEvent as Mapper },
  notifications: { slice: 'notifications', map: rowToNotification as Mapper },
  eod_reports: { slice: 'eodReports', map: rowToEodReport as Mapper },
  campaigns: { slice: 'campaigns', map: rowToCampaign as Mapper },
  job_postings: { slice: 'jobPostings', map: rowToJobPosting as Mapper },
  leads: { slice: 'leads', map: rowToLead as Mapper },
  lead_activity: { slice: 'leadActivity', map: rowToLeadActivity as Mapper },
  courses: { slice: 'courses', map: rowToCourse as Mapper },
  course_modules: { slice: 'courseModules', map: rowToCourseModule as Mapper },
  course_topics: { slice: 'courseTopics', map: rowToCourseTopic as Mapper },
  conversations: { slice: 'conversations', map: rowToConversation as Mapper },
  messages: { slice: 'messages', map: rowToChatMessage as Mapper },
  conversation_reads: { slice: 'conversationReads', map: rowToConversationRead as Mapper },
  channel_categories: { slice: 'channelCategories', map: rowToChannelCategory as Mapper },
  channels: { slice: 'channels', map: rowToChannel as Mapper },
  channel_messages: { slice: 'channelMessages', map: rowToChannelMessage as Mapper },
  channel_reactions: { slice: 'channelReactions', map: rowToChannelReaction as Mapper },
  channel_reads: { slice: 'channelReads', map: rowToChannelRead as Mapper },
  // 037 / 040 / 033 — skipped while the table is missing (see db.isTableMissing).
  showcase_items: { slice: 'showcaseItems', map: rowToShowcaseItem as Mapper },
  event_attendees: { slice: 'eventAttendees', map: rowToEventAttendee as Mapper },
  form_responses: { slice: 'formResponses', map: rowToFormResponse as Mapper },
  emails: { slice: 'emails', map: rowToEmail as Mapper },
  recording_folders: { slice: 'recordingFolders', map: rowToRecordingFolder as Mapper },
  meeting_recordings: { slice: 'meetingRecordings', map: rowToMeetingRecording as Mapper },
  workspace_settings: { slice: 'workspaceSettings', map: rowToWorkspaceSettings as unknown as Mapper, single: true },
}
// PLATFORM-SPECIFIC:END

function upsert(slice: string, obj: Synced): void {
  useStore.setState((s) => {
    const list = (s as unknown as Record<string, unknown>)[slice] as Synced[]
    const idx = list.findIndex((x) => x.id === obj.id)
    if (idx === -1) return { [slice]: [...list, obj] } as never
    // Two quick edits produce two echoes; the first must not roll back the
    // second's optimistic state while it is still in flight.
    const local = list[idx]
    if (local.updatedAt && obj.updatedAt && obj.updatedAt < local.updatedAt) return {}
    const next = list.slice()
    next[idx] = obj
    return { [slice]: next } as never
  })
}

function removeById(slice: string, id: string | number): void {
  useStore.setState((s) => {
    const list = (s as unknown as Record<string, unknown>)[slice] as Synced[]
    return { [slice]: list.filter((x) => x.id !== id) } as never
  })
}

function replaceSingle(slice: string, obj: unknown): void {
  useStore.setState({ [slice]: obj } as never)
}

let channel: RealtimeChannel | null = null
/** The current channel has reached SUBSCRIBED. */
let joined = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retries = 0
let wanted = false
/** A live channel went down: whatever changed meanwhile is unknown until a pull. */
let dropped = false

const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 60_000

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function scheduleRetry(): void {
  // One timer at a time: CHANNEL_ERROR is followed by a CLOSED, and two
  // timers used to double the backoff and race each other.
  clearRetry()
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retries)
  retries++
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (wanted) startRealtime()
  }, delay)
}

/** Subscribe to remote row changes and mirror them into the local store. */
export function startRealtime(): void {
  if (!isSupabaseConfigured) return
  wanted = true
  if (channel) return
  clearRetry()
  const ch = supabase.channel('deskdev-sync')
  for (const table of Object.keys(TABLE_SYNC)) {
    // A subscription to a table that doesn't exist yet (its migration is
    // still unapplied) errors the whole channel, and every table goes deaf.
    if (isTableMissing(table)) continue
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload: { eventType: string; new: Row; old: Row }) => {
        const sync = TABLE_SYNC[table]
        if (!sync) return
        if (sync.single) {
          if (payload.eventType !== 'DELETE') replaceSingle(sync.slice, sync.map(payload.new))
          return
        }
        if (payload.eventType === 'DELETE') {
          const id = payload.old?.id as string | number | undefined
          if (id !== undefined && id !== null) removeById(sync.slice, id)
        } else {
          upsert(sync.slice, sync.map(payload.new))
        }
      },
    )
  }
  channel = ch
  joined = false
  ch.subscribe((status) => {
    // A channel already torn down still reports (removeChannel ends with
    // CLOSED); only the current one may change state or schedule retries.
    if (ch !== channel) return
    if (status === 'SUBSCRIBED') {
      joined = true
      retries = 0
      // Anything that changed while the socket was down is unknown to us:
      // pull it all rather than trust a gap.
      if (dropped) {
        dropped = false
        void useStore.getState().hydrate()
      }
      return
    }
    // A dropped socket used to leave `channel` set and the app deaf for the
    // rest of the session — nothing ever called subscribe() again. Tear down
    // and come back with backoff.
    if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      dropped = true
      stopRealtime(true)
      if (wanted) scheduleRetry()
    }
  })
}

/** Drop the live subscription. `retrying` keeps the intent to reconnect. */
export function stopRealtime(retrying = false): void {
  if (!retrying) {
    wanted = false
    retries = 0
    dropped = false
    clearRetry()
  }
  joined = false
  const ch = channel
  // Cleared first, so the CLOSED that removeChannel() reports is stale.
  channel = null
  if (ch) void supabase.removeChannel(ch)
}

/** The subscription is joined over a socket that says it is open. */
export function isRealtimeJoined(): boolean {
  return channel !== null && joined && supabase.realtime.isConnected()
}

/**
 * Reconnect now instead of waiting out the backoff (up to a minute) — for a
 * resume or the network coming back. A no-op while joined. Call it only with
 * a session.
 */
export function kickRealtime(): void {
  if (!isSupabaseConfigured || isRealtimeJoined()) return
  retries = 0
  clearRetry()
  stopRealtime(true)
  startRealtime()
}

// PLATFORM-SPECIFIC:START
// Mobile has no useRemoteSync() hook — web wires remote sync (initial pull,
// auth-state subscription, resume/online resync) with that React hook here;
// the mobile equivalent (initial pull, auth-state subscription, AppState
// foreground refetch) lives in src/context/session-context.tsx.
// PLATFORM-SPECIFIC:END
