// Web-only (not mirrored to mobile). Pure routing rules for the phone shell:
// which tabs the bottom bar shows, which one is active, and where the Topbar's
// back chevron goes. Kept free of React so the rules are unit-tested.
import type { PermFeature } from '../../lib/types'

export type TabId = 'home' | 'tasks' | 'chat' | 'projects' | 'calendar' | 'clients'

export interface TabDef {
  id: TabId
  label: string
  /** The tab's root route — tapping it lands here. */
  to: string
  /** Permission that gates the tab; none means everyone gets it. */
  feature?: PermFeature
  /** Route prefixes that light the tab up ('/' matches only itself). */
  match: string[]
}

const HOME: TabDef = { id: 'home', label: 'Home', to: '/', match: ['/'] }
const TASKS: TabDef = { id: 'tasks', label: 'Tasks', to: '/tasks', feature: 'tasks', match: ['/tasks'] }
// Chat is open to every profile (App.tsx routes it without a gate) and covers
// both DMs and channels, so it is the hub in the thumb-zone centre.
const CHAT: TabDef = { id: 'chat', label: 'Chat', to: '/messages', match: ['/messages', '/channels'] }
const PROJECTS: TabDef = {
  id: 'projects', label: 'Projects', to: '/projects', feature: 'projects', match: ['/projects'],
}
const CALENDAR: TabDef = {
  id: 'calendar', label: 'Calendar', to: '/calendar', feature: 'calendar', match: ['/calendar'],
}
const CLIENTS: TabDef = { id: 'clients', label: 'Clients', to: '/clients', feature: 'clients', match: ['/clients'] }

/** The preferred bar, in slot order. */
const SLOTS: TabDef[] = [HOME, TASKS, CHAT, PROJECTS]
/** Stand-ins, in order, for a gated slot this person can't open. */
const FALLBACKS: TabDef[] = [CALENDAR, CLIENTS]

/**
 * The bar's destinations (More is added by the bar itself). A gated slot the
 * person can't view takes the next fallback they can, in place, so the bar
 * keeps four destinations whenever four exist.
 */
export function tabsFor(canView: (feature: PermFeature) => boolean): TabDef[] {
  const spare = FALLBACKS.filter((t) => t.feature && canView(t.feature))
  const out: TabDef[] = []
  for (const slot of SLOTS) {
    if (!slot.feature || canView(slot.feature)) out.push(slot)
    else {
      const stand = spare.shift()
      if (stand) out.push(stand)
    }
  }
  return out
}

function matches(prefix: string, pathname: string): boolean {
  if (prefix === '/') return pathname === '/'
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isTabActive(tab: TabDef, pathname: string): boolean {
  return tab.match.some((prefix) => matches(prefix, pathname))
}

/** Already on the tab's root, so another tap means "back to the top". */
export function isTabRoot(tab: TabDef, pathname: string): boolean {
  return pathname === tab.to || (tab.to !== '/' && pathname === `${tab.to}/`)
}

const DETAIL_PARENTS: [RegExp, string][] = [
  [/^\/projects\/[^/]+\/?$/, '/projects'],
  [/^\/clients\/[^/]+\/?$/, '/clients'],
  [/^\/crm\/[^/]+\/?$/, '/crm'],
  [/^\/courses\/[^/]+\/?$/, '/courses'],
  [/^\/whiteboard\/[^/]+\/?$/, '/whiteboard'],
  [/^\/growth\/(leads|outbound)\/?$/, '/growth'],
]

/**
 * Where the phone Topbar's back chevron leads on a detail route, or null where
 * the page is a top-level destination. Installed iOS apps have no browser back
 * button, so every drill-down needs one of its own.
 */
export function backTargetFor(pathname: string): string | null {
  for (const [re, parent] of DETAIL_PARENTS) if (re.test(pathname)) return parent
  return null
}

/** Accessible name for the Chat tab, counts included. */
export function chatTabLabel(count: number, channelsUnread: boolean): string {
  if (count > 0) return `Chat, ${count} unread`
  if (channelsUnread) return 'Chat, new channel messages'
  return 'Chat'
}
