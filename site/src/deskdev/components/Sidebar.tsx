import {
  AddressBookIcon, ArrowCounterClockwiseIcon, ArrowsClockwiseIcon, BriefcaseIcon, CalendarBlankIcon,
  ChatCircleIcon, CheckSquareIcon, CubeIcon, DownloadSimpleIcon, FilmStripIcon, GearIcon, RobotIcon, ScribbleIcon, GraduationCapIcon, HashIcon, ImagesIcon,
  LockIcon, PaperPlaneTiltIcon, SignOutIcon, SquaresFourIcon, TableIcon, TrendUpIcon,
  UsersIcon, VideoCameraIcon, XIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import type { PermFeature } from '../lib/types'
import { classNames } from '../lib/format'
import { isSupabaseConfigured } from '../lib/supabase'
import Avatar from './Avatar'
import { useUnreadMessageCount } from './messages/useUnreadMessageCount'
import { useChannelBadge } from './channels/useChannelBadge'
import { SidebarNav, type NavGroupData, type NavItemData } from './ui/sidebar-nav'
import { useIsStandalone } from '../pwa/useMediaQuery'
import { IndicatorGroup } from './motion'
import BrandMark from './ui/BrandMark'

/** Nav rows carry the permission that gates them; the store supplies badges. */
type Section = {
  heading: string
  items: (NavItemData & {
    feature?: PermFeature
    badgeKey?: 'projects' | 'tasks' | 'messages' | 'channels'
    /** Lives in the right-hand rail on desktop; only the phone drawer lists it here. */
    railOnly?: boolean
  })[]
}

const sections: Section[] = [
  {
    heading: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: SquaresFourIcon, end: true },
      { to: '/messages', label: 'Messages', icon: ChatCircleIcon, badgeKey: 'messages', railOnly: true },
      { to: '/channels', label: 'Channels', icon: HashIcon, badgeKey: 'channels', railOnly: true },
      { to: '/projects', label: 'Projects', icon: BriefcaseIcon, badgeKey: 'projects', feature: 'projects' },
      { to: '/tasks', label: 'Tasks', icon: CheckSquareIcon, badgeKey: 'tasks', feature: 'tasks' },
      // Revision 10: answers from the workspace's own data; asks before changing anything.
      { to: '/assistant', label: 'Assistant', icon: RobotIcon },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { to: '/cube', label: 'Cube', icon: CubeIcon },
      { to: '/clients', label: 'Clients', icon: UsersIcon, feature: 'clients' },
      { to: '/crm', label: 'CRM', icon: TableIcon, feature: 'crm' },
      { to: '/calendar', label: 'Calendar', icon: CalendarBlankIcon, feature: 'calendar' },
      { to: '/meetings', label: 'Meetings', icon: VideoCameraIcon, feature: 'meetings' },
      // Revision 9: Whiteboard sits above Meeting Recordings (every active account).
      { to: '/whiteboard', label: 'Whiteboard', icon: ScribbleIcon },
      { to: '/recordings', label: 'Meeting Recordings', icon: FilmStripIcon, feature: 'meetings' },
    ],
  },
  {
    heading: 'Growth',
    items: [
      { to: '/growth', label: 'Growth Hub', icon: TrendUpIcon, end: true, feature: 'growth' },
      { to: '/growth/leads', label: 'CRM Leads', icon: AddressBookIcon, feature: 'growth' },
      { to: '/growth/applications', label: 'OLJ Applications', icon: PaperPlaneTiltIcon, feature: 'growth' },
      { to: '/growth/outbound', label: 'Outbound Command', icon: PaperPlaneTiltIcon, feature: 'growth' },
      { to: '/showcase', label: 'Showcase', icon: ImagesIcon, feature: 'showcase' },
    ],
  },
]

export default function Sidebar({
  className,
  onNavigate,
  onClose,
  showRailItems,
}: {
  className?: string
  onNavigate?: () => void
  /** The phone drawer: shows a close button in the header. */
  onClose?: () => void
  /** The phone drawer has no rail, so Messages and Channels are listed here instead. */
  showRailItems?: boolean
}) {
  const user = useCurrentUser()
  const logout = useStore((s) => s.logout)
  const hydrate = useStore((s) => s.hydrate)
  const standalone = useIsStandalone()
  const [refreshing, setRefreshing] = useState(false)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const unreadMessages = useUnreadMessageCount()
  const channelBadge = useChannelBadge()

  const badges: Record<string, number> = {
    projects: projects.filter((p) => p.status !== 'done').length,
    tasks: tasks.filter((t) => t.status !== 'done' && !t.archived).length,
    messages: unreadMessages,
    // Mentions are what need you; plain unread channels are just a dot's worth of news.
    channels: channelBadge.mentions || channelBadge.unreadChannels,
  }

  const groups: NavGroupData[] = sections
    .map((section) => ({
      heading: section.heading,
      items: section.items
        .filter((item) => !item.feature || can(user, item.feature, 'view'))
        .filter((item) => showRailItems || !item.railOnly || item.badgeKey === 'messages' || item.badgeKey === 'channels')
        .map((item): NavItemData => ({
          to: item.to,
          label: item.label,
          icon: item.icon,
          end: item.end,
          badge: item.badgeKey ? badges[item.badgeKey] : undefined,
        })),
    }))
    .filter((group) => group.items.length > 0)

  if (can(user, 'projects', 'view')) {
    const activeProjects = projects.filter((p) => p.status !== 'done')
    if (activeProjects.length) groups.push({ heading: 'Active projects', items: activeProjects.map((p) => ({ to: `/projects/${p.id}`, label: p.title, icon: BriefcaseIcon })) })
  }

  // Pinned bottom block. Courses is permission-gated rather than admin-only —
  // members need it to watch SOP videos — and sits directly above the Vault.
  // Settings is for everyone: profile, appearance and notifications are
  // personal; the admin-only sections hide themselves inside.
  const bottomItems: NavItemData[] = [
    ...(can(user, 'courses', 'view')
      ? [{ to: '/courses', label: 'Courses', icon: GraduationCapIcon } as NavItemData]
      : []),
    ...(user?.role === 'admin' ? [{ to: '/vault', label: 'Vault', icon: LockIcon } as NavItemData] : []),
    // Installing happens from a browser tab; inside the installed app it's done.
    ...(standalone
      ? []
      : [{ to: '/install', label: 'Install app', icon: DownloadSimpleIcon, className: 'standalone:hidden' } as NavItemData]),
    { to: '/settings', label: 'Settings', icon: GearIcon },
  ]

  // An installed iOS app has no reload button and no pull-to-refresh, so the
  // installed app brings its own: Refresh re-pulls the data in place, Reload
  // app restarts it (a stuck screen, a new version).
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      // hydrate() never rejects: offline it keeps what it has, and a table
      // that failed lands in loadError. Local mode has nothing to fetch.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (isSupabaseConfigured && offline) throw new Error('offline')
      await hydrate()
      const { synced, loadError } = useStore.getState()
      if (!synced || (loadError?.length ?? 0) > 0) throw new Error('partial')
      toast.success('Up to date')
    } catch {
      toast.error('Could not refresh. Check your connection.')
    } finally {
      setRefreshing(false)
    }
  }
  // The phone drawer is short: its bottom block scrolls with the nav instead of
  // pinning and squeezing the groups above it out of view. Settings stays
  // pinned there though, above the user row: on phones it's the only way to
  // the theme (the Topbar's theme button is desktop-only).
  const drawer = !!onClose
  const settingsItem = bottomItems[bottomItems.length - 1]
  const scrollingItems = drawer ? bottomItems.slice(0, -1) : bottomItems
  const bottomGroup: NavGroupData[] = scrollingItems.length > 0 ? [{ items: scrollingItems }] : []

  const bottomBlock = (bottomGroup.length > 0 || standalone) && (
    <div className={drawer ? 'mt-5 pt-3 border-t border-ink-600' : 'px-3 py-2 border-t border-ink-600'}>
      {bottomGroup.length > 0 && <SidebarNav groups={bottomGroup} onNavigate={onNavigate} indicator="sidebar" label="More" />}
      {standalone && (
        <div className={classNames('flex items-center gap-1', bottomGroup.length > 0 && 'mt-0.5')}>
          <button
            type="button"
            className="pressable flex-1 min-w-0 flex items-center gap-3 px-3 py-2 pointer-coarse:min-h-[44px] rounded-md text-sm font-medium text-left text-ink-200 hover:text-ink-50 hover:bg-ink-700/60 disabled:opacity-60"
            onClick={refresh}
            disabled={refreshing}
          >
            <ArrowsClockwiseIcon
              size={16}
              aria-hidden
              className={classNames('shrink-0 text-ink-400', refreshing && 'motion-safe:animate-spin')}
            />
            <span className="truncate">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            className="pressable shrink-0 size-9 pointer-coarse:size-[44px] flex items-center justify-center rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700/60"
            onClick={() => window.location.reload()}
            aria-label="Reload app"
            title="Reload app"
          >
            <ArrowCounterClockwiseIcon size={15} aria-hidden />
          </button>
        </div>
      )}
    </div>
  )

  return (
    // One marker per rendered copy: the desktop sidebar and the phone drawer
    // never pass it to each other.
    <IndicatorGroup id={drawer ? 'sidebar-drawer' : 'sidebar-desktop'}>
      <aside
        className={classNames(
          // The insets are 0 on desktop; in the phone drawer they clear the notch
          // and the home indicator.
          'w-60 shrink-0 bg-ink-850 border-r border-ink-600 flex-col pt-(--safe-top) pb-(--safe-bottom)',
          className,
        )}
      >
        <div className="h-16 shrink-0 px-5 flex items-center gap-2.5 border-b border-ink-600">
          {/* The studio's mark — the app icon's "D", not a stock icon in a tile. */}
          <BrandMark size={32} />
          <div className="min-w-0">
            <div className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink-50 leading-tight truncate">
              DeskDev Studio
            </div>
            <div className="mt-1 text-[10px] font-semibold text-ink-300 uppercase tracking-wider leading-none truncate">
              Client operations
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              data-drawer-close
              className="pressable ml-auto -mr-3 size-[44px] shrink-0 flex items-center justify-center rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <XIcon size={18} aria-hidden />
            </button>
          )}
        </div>

        <div
          className={classNames(
            'flex-1 min-h-0 px-3 py-4 overflow-y-auto overscroll-contain',
            // The drawer's list runs under the pinned Settings row: fade its
            // last 24px so a cut row reads as "more below", not as a clipped
            // one (and pad the end, so the last row clears the fade).
            // touch-pan-y: a scroller decides its own pan directions, so
            // without it a sideways swipe that starts on the list is taken
            // by the browser and never reaches the drawer's swipe-to-close.
            drawer && 'touch-pan-y pb-8 [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]',
          )}
        >
          <SidebarNav groups={groups} onNavigate={onNavigate} indicator="sidebar" label="Workspace" />
          {drawer && bottomBlock}
        </div>

        {!drawer && bottomBlock}

        {drawer && (
          <div className="px-3 py-2 border-t border-ink-600">
            <SidebarNav groups={[{ items: [settingsItem] }]} onNavigate={onNavigate} indicator="sidebar" label="Settings" />
          </div>
        )}

        {user && (
          <div className="px-3 py-3 border-t border-ink-600 flex items-center gap-2.5">
            <Avatar name={user.fullName} color={user.avatarColor} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink-50 leading-tight truncate" title={user.fullName}>{user.fullName}</div>
              <div className="mt-0.5 text-[11px] text-ink-300 leading-tight capitalize">{user.role}</div>
            </div>
            <button
              type="button"
              className="pressable shrink-0 p-1.5 pointer-coarse:p-[15px] pointer-coarse:-my-2.5 rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700"
              title="Log out"
              aria-label="Log out"
              onClick={logout}
            >
              <SignOutIcon size={14} aria-hidden />
            </button>
          </div>
        )}
      </aside>
    </IndicatorGroup>
  )
}
