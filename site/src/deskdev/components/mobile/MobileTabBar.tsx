import { useMemo, type MouseEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BriefcaseIcon, CalendarBlankIcon, ChatCircleIcon, CheckSquareIcon, type Icon, ListIcon,
  SquaresFourIcon, UsersIcon,
} from '@phosphor-icons/react'
import { useCurrentUser } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { classNames } from '../../lib/format'
import { useUnreadMessageCount } from '../messages/useUnreadMessageCount'
import { useChannelBadge } from '../channels/useChannelBadge'
import { IndicatorGroup, LayoutIndicator } from '../motion'
import { chatTabLabel, isTabActive, isTabRoot, tabsFor, type TabDef, type TabId } from './shellNav'

const ICONS: Record<TabId, Icon> = {
  home: SquaresFourIcon,
  tasks: CheckSquareIcon,
  chat: ChatCircleIcon,
  projects: BriefcaseIcon,
  calendar: CalendarBlankIcon,
  clients: UsersIcon,
}

// One press/colour band (160ms), long-press callout off so a held tab doesn't
// pop the iOS link preview; the tint lands on press-down.
const tabClass = (active: boolean) =>
  classNames(
    'group relative w-full h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium tracking-[0.005em]',
    'select-none [-webkit-touch-callout:none] transition-colors duration-150 ease-[ease] active:bg-ink-700/50',
    'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
    active ? 'text-ink-50' : 'text-ink-300',
  )

function TabInner({ icon: Icon, label, active, count = 0, dot = false }: {
  icon: Icon
  label: string
  active: boolean
  count?: number
  dot?: boolean
}) {
  return (
    <>
      {/* The nav's one brand accent: a rail, not a filled pill (sidebar-nav,
          turned sideways). Flush with the bar's top hairline, rounded only
          underneath. It glides to the tapped tab (layoutId, critically damped);
          static under reduced motion. */}
      {active && (
        <LayoutIndicator
          layoutId="tabbar-rail"
          className="absolute top-0 left-1/2 -ml-3.5 h-[3px] w-7 rounded-b-full bg-brand-600 dark:bg-brand-400"
        />
      )}
      {/* The press lands on the icon only (scale 0.95, 160ms strong ease-out);
          the label stays put. Reduced motion: no scale (index.css). */}
      <span className="relative transition-[scale] duration-(--dur-press) ease-out group-active:scale-[0.95] motion-reduce:group-active:scale-100">
        <Icon
          size={21}
          weight={active ? 'fill' : 'regular'}
          aria-hidden
          className={classNames('transition-colors duration-150', active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-300')}
        />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-brand-600 text-white text-[9px] font-semibold tabular-nums flex items-center justify-center ring-2 ring-ink-850"
          >
            {count > 9 ? '9+' : count}
          </span>
        ) : dot ? (
          <span aria-hidden className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-brand-500 ring-2 ring-ink-850" />
        ) : null}
      </span>
      <span className="leading-none">{label}</span>
    </>
  )
}

/**
 * The phone shell's bottom bar: Home · Tasks · Chat · Projects · More. It sits
 * in normal flow at the end of Layout's column (no z-index, no padding hacks
 * on main) and is hidden from md up, where the sidebar takes over. While the
 * on-screen keyboard is open (useKeyboardViewport) it steps aside, as native
 * tab bars do, instead of riding on top of the keyboard.
 */
export default function MobileTabBar({
  onMore,
  moreOpen,
  className,
}: {
  onMore: () => void
  moreOpen: boolean
  className?: string
}) {
  const user = useCurrentUser()
  const { pathname } = useLocation()
  const unreadDMs = useUnreadMessageCount()
  const { mentions, unreadChannels } = useChannelBadge()

  const tabs = useMemo(() => tabsFor((feature) => can(user, feature, 'view')), [user])
  const anyActive = tabs.some((t) => isTabActive(t, pathname))
  const moreActive = moreOpen || !anyActive

  const chatCount = unreadDMs + mentions
  // Same rule as the rail: a count means someone needs you, a dot is just news.
  const chatDot = chatCount === 0 && unreadChannels > 0

  const onTab = (e: MouseEvent<HTMLAnchorElement>, tab: TabDef) => {
    if (!isTabRoot(tab, pathname)) return
    // Already here: the tap means "back to the top" (iOS's status-bar tap can't
    // reach an inner scroller).
    e.preventDefault()
    const main = document.getElementById('dd-main')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    main?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <nav
      aria-label="Primary"
      className={classNames('md:hidden [html[data-keyboard=open]_&]:hidden shrink-0 bg-ink-850 border-t border-ink-600 pb-(--safe-bottom) select-none', className)}
    >
      <IndicatorGroup id="tabbar">
        <ul className="flex h-(--tabbar-h)">
          {tabs.map((tab) => {
            const active = !moreOpen && isTabActive(tab, pathname)
            const isChat = tab.id === 'chat'
            return (
              <li key={tab.id} className="flex-1 min-w-0">
                <Link
                  to={tab.to}
                  className={tabClass(active)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={isChat ? chatTabLabel(chatCount, chatDot) : undefined}
                  onClick={(e) => onTab(e, tab)}
                  draggable={false}
                >
                  <TabInner
                    icon={ICONS[tab.id]}
                    label={tab.label}
                    active={active}
                    count={isChat ? chatCount : 0}
                    dot={isChat && chatDot}
                  />
                </Link>
              </li>
            )
          })}
          <li className="flex-1 min-w-0">
            <button
              type="button"
              className={tabClass(moreActive)}
              onClick={onMore}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              <TabInner icon={ListIcon} label="More" active={moreActive} />
            </button>
          </li>
        </ul>
      </IndicatorGroup>
    </nav>
  )
}
