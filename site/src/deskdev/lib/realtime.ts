// PLATFORM-SPECIFIC:START
import { useEffect } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
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
// Web-only React hook — mobile does the equivalent wiring (initial pull,
// auth-state subscription, AppState foreground refetch) in
// src/context/session-context.tsx.

/** Back within this long with the socket still joined: a quick app switch, nothing missed. */
const QUICK_SWITCH_MS = 30_000

/**
 * Wire remote sync into the app once, from the root component: initial pull,
 * live realtime subscription, and one resync routine for coming back — the
 * tab or app becoming visible again, the network returning, or a page
 * restored from the back/forward cache. In local mode this just runs the
 * normal hydrate().
 */
export function useRemoteSync(): void {
  useEffect(() => {
    const hydrate = () => useStore.getState().hydrate()

    if (!isSupabaseConfigured) {
      void hydrate()
      return
    }

    let active = true
    void (async () => {
      let signedIn = false
      try {
        const { data, error } = await supabase.auth.getSession()
        signedIn = Boolean(data.session)
        // Configured but no Supabase session → drop any stale login so the
        // user signs in against Supabase. Not when the session merely
        // couldn't be refreshed offline (an expired access token, a good
        // refresh token): that user is still signed in, and 'online' resyncs.
        if (!data.session && !isAuthRetryableFetchError(error) && useStore.getState().currentUserId) {
          useStore.setState({ currentUserId: null })
        }
        // Another account signed in on this browser while this page was
        // closed: the persisted user is not the session's.
        if (data.session) await useStore.getState().syncSessionUser(data.session.user.id)
      } catch {
        // Storage or lock trouble: keep whatever state we have.
      }
      await hydrate()
      if (active && signedIn) startRealtime()
    })()

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      // Another tab or window signed a different account in: supabase-js
      // hands this tab the new session, and the app must follow it, or every
      // write goes out as the old user under the new user's token.
      const me = useStore.getState().currentUserId
      if (session && me !== null && me !== session.user.id && event !== 'SIGNED_OUT') {
        stopRealtime()
        void useStore.getState().syncSessionUser(session.user.id).then(() => hydrate()).then(() => kickRealtime())
        return
      }
      if (event === 'SIGNED_IN') {
        // supabase-js emits SIGNED_IN again on every return to the tab. For
        // the user already here, with a live socket, it isn't news — and it
        // used to cost a second full pull on every resume.
        if (session && me === session.user.id && isRealtimeJoined()) return
        void hydrate().then(() => kickRealtime())
      } else if (event === 'TOKEN_REFRESHED') {
        // A refresh that finally got through (network back) while the socket is down.
        if (useStore.getState().currentUserId && !isRealtimeJoined()) kickRealtime()
      } else if (event === 'SIGNED_OUT') {
        stopRealtime()
        // A revoked token or a sign-out in another tab must not leave this tab
        // "signed in" with writes silently dropped — AuthGate keys off this.
        if (useStore.getState().currentUserId) void useStore.getState().logout()
      }
    })

    // One routine for every way of coming back. getSession() refreshes an
    // expired token first, so the socket and the pull both use a good one.
    let hiddenAt = 0
    let resyncing = false
    const resync = async () => {
      if (!active || resyncing || !useStore.getState().currentUserId) return
      resyncing = true
      try {
        const { data } = await supabase.auth.getSession()
        // No session: a real sign-out arrives as SIGNED_OUT, and a network
        // error comes back here through 'online'.
        if (!active || !data.session) return
        kickRealtime()
        await hydrate()
      } catch {
        // Offline mid-resync — 'online' brings us back here.
      } finally {
        resyncing = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt && Date.now() - hiddenAt < QUICK_SWITCH_MS && isRealtimeJoined()) return
      void resync()
    }
    const onOnline = () => void resync()
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void resync()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      active = false
      authSub.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
      stopRealtime()
    }
  }, [])
}
// PLATFORM-SPECIFIC:END
