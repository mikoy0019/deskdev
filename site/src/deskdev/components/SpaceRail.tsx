import { createContext, useContext, useEffect, useRef, useState, useMemo, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useSearchParams } from 'react-router-dom'
import { ChatCircleIcon, type IconWeight, PlusIcon } from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { avatarColor, classNames, initials } from '../lib/format'
import { spaceBadges, spaceOf, STUDIO_SPACE } from '../lib/channels'
import { useUnreadMessageCount } from './messages/useUnreadMessageCount'
import type { Client } from '../lib/types'
import { Presence, TooltipPanel, tooltipIsWarm } from './motion'
import { BrandGlyph } from './ui/BrandMark'
import { PeopleRailButton } from './presence/PeoplePanel'

/**
 * Space rail on the left edge, next to the detailed navigation. Top to bottom: direct messages, the
 * studio's own channels, one circle per client (its channels), and "+".
 * The open space's circle squares off and gets an edge pill; a brand dot
 * means unread, a brand count means you were mentioned. Pinned under the
 * list: who is here now (revision 7). Desktop only — phones reach all of
 * this through the drawer.
 */
export default function SpaceRail() {
  const user = useCurrentUser()
  const clients = useStore((s) => s.clients)
  const channels = useStore((s) => s.channels)
  const channelMessages = useStore((s) => s.channelMessages)
  const channelReads = useStore((s) => s.channelReads)
  const unreadMessages = useUnreadMessageCount()
  const { pathname } = useLocation()
  const [params] = useSearchParams()

  const canSeeClients = can(user, 'clients', 'view')
  const canAddClients = can(user, 'clients', 'edit')

  const rows = useMemo(
    () =>
      [...clients]
        .filter((c) => c.status !== 'ended')
        .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1)),
    [clients],
  )
  const badges = useMemo(
    () => spaceBadges(channels, channelMessages, channelReads, user),
    [channels, channelMessages, channelReads, user],
  )

  // Which circle is "open": the space of the channel on screen, the ?space=
  // being browsed, or the client whose page this is.
  let activeSpace: string | null = null
  if (pathname.startsWith('/channels/')) {
    const ch = channels.find((c) => c.id === pathname.split('/')[2])
    activeSpace = ch ? spaceOf(ch) : null
  } else if (pathname === '/channels') {
    activeSpace = params.get('space') ?? STUDIO_SPACE
  } else if (pathname.startsWith('/clients/')) {
    activeSpace = pathname.split('/')[2] ?? null
  }
  const messagesActive = pathname.startsWith('/messages')

  return (
    <RailTips>
      <aside
        className="hidden md:flex w-[72px] shrink-0 flex-col items-center bg-ink-850 border-r border-ink-600"
        aria-label="Messages, studio and clients"
      >
        {/* The list scrolls; the people button stays at the bottom. */}
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden pt-3.5 pb-3 [scrollbar-width:none]">
        <RailIcon
          to="/messages"
          label="Messages"
          icon={ChatCircleIcon}
          active={messagesActive}
          count={unreadMessages}
        />
        <Divider />

        <RailIcon
          to={`/channels?space=${STUDIO_SPACE}`}
          label="DeskDev Studio"
          icon={StudioGlyph}
          active={activeSpace === STUDIO_SPACE}
          unread={(badges.get(STUDIO_SPACE)?.unreadChannels ?? 0) > 0}
          count={badges.get(STUDIO_SPACE)?.mentions ?? 0}
        />

        {canSeeClients && rows.length > 0 && <Divider />}
        {canSeeClients &&
          rows.map((c) => (
            <RailClient
              key={c.id}
              client={c}
              active={c.id === activeSpace}
              unread={(badges.get(c.id)?.unreadChannels ?? 0) > 0}
              count={badges.get(c.id)?.mentions ?? 0}
            />
          ))}

        {canAddClients && (
          <>
            <Divider />
            <RailIcon to="/clients?new=1" label="New client" icon={PlusIcon} active={false} tone="add" />
          </>
        )}
        </div>
        <div className="flex w-full shrink-0 flex-col items-center border-t border-ink-600 pb-4 pt-3">
          <RailSlot label="People">
            <PeopleRailButton />
          </RailSlot>
        </div>
      </aside>
    </RailTips>
  )
}

/** The studio's own space wears its "D", like the app icon (an Icon stand-in). */
type RailGlyph = ComponentType<{ size?: number; weight?: IconWeight; 'aria-hidden'?: boolean }>
const StudioGlyph: RailGlyph = ({ size }) => <BrandGlyph size={size} />

function Divider() {
  return <span className="w-6 h-px bg-ink-600 my-1 shrink-0" aria-hidden />
}

// Shape changes snap (radius isn't a transform); colours ride the hover band.
const circle =
  'pressable relative w-12 h-12 flex items-center justify-center rounded-full ' +
  'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-850'

// A resting tile: the card surface with an inset hairline (box-shadow, so the
// focus-visible ring still layers on top), not a flat grey disc.
const idle = 'bg-ink-800 shadow-[inset_0_0_0_1px_rgb(var(--ink-600))]'

/** Pointer rest before the first name card shows; neighbours then show at once. */
const TIP_DELAY_MS = 300
/** How long the card lingers after the pointer leaves, so a move to the next circle retargets it. */
const TIP_GRACE_MS = 120

type TipApi = { show: (label: string, el: HTMLElement, now: boolean) => void; hide: () => void }
const TipContext = createContext<TipApi | null>(null)

/**
 * One name card for the whole rail, shown to the left of the hovered circle.
 * The first hover waits a beat (no flicker while the pointer crosses the
 * rail); moving on to a neighbour retargets the open card instantly — no
 * delay, no animation (Emil's tooltip rule). Keyboard focus shows it at once
 * and the kit drops the animation for keyboard input. Portaled and fixed: the
 * rail scrolls and clips its overflow, which used to swallow the card.
 * Decorative — every circle carries its own aria-label.
 */
function RailTips({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ label: string } | null>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const open = useRef(false)
  useEffect(() => () => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
  }, [])

  const api = useMemo<TipApi>(() => {
    const place = (label: string, el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      open.current = true
      setPos({ top: r.top + r.height / 2, right: window.innerWidth - r.left + 12 })
      setTip({ label })
    }
    return {
      show(label, el, now) {
        clearTimeout(showTimer.current)
        clearTimeout(hideTimer.current)
        if (now || open.current || tooltipIsWarm()) place(label, el)
        else showTimer.current = setTimeout(() => place(label, el), TIP_DELAY_MS)
      },
      hide() {
        clearTimeout(showTimer.current)
        clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => {
          open.current = false
          setTip(null)
        }, TIP_GRACE_MS)
      },
    }
  }, [])

  return (
    <TipContext.Provider value={api}>
      {children}
      {createPortal(
        // The anchor holds the spot while the card plays its exit, and centres
        // it vertically so a long name can wrap.
        <div className="pointer-events-none fixed z-30 -translate-y-1/2" style={pos}>
          <Presence>
            {tip && (
              <TooltipPanel
                key="tip"
                placement="left"
                aria-hidden
                role={undefined}
                className="w-max max-w-64 card px-2.5 py-1.5 text-xs font-medium leading-4 text-ink-50 shadow-(--shadow-3) [overflow-wrap:anywhere]"
              >
                {tip.label}
              </TooltipPanel>
            )}
          </Presence>
        </div>,
        document.body,
      )}
    </TipContext.Provider>
  )
}

/** "1 mention" / "3 mentions", for a circle's accessible name. */
function mentionsLabel(count: number): string {
  return `${count} ${count === 1 ? 'mention' : 'mentions'}`
}

/** One rail slot: the circle, its edge pill, and the hover/focus wiring for the name card. */
function RailSlot({ label, children }: { label: string; children: ReactNode }) {
  const tips = useContext(TipContext)
  return (
    <div
      className="group relative shrink-0"
      onPointerEnter={(e) => e.pointerType === 'mouse' && tips?.show(label, e.currentTarget, false)}
      onPointerLeave={() => tips?.hide()}
      onFocus={(e) => e.currentTarget.querySelector(':focus-visible') && tips?.show(label, e.currentTarget, true)}
      onBlur={() => tips?.hide()}
      onClick={() => tips?.hide()}
    >
      {children}
    </div>
  )
}

/**
 * The pill on the outer (right) edge: tall for the open space, and a short
 * hover hint otherwise. One 36px bar scaled on Y (transform only), so it grows
 * and shrinks on the compositor. Unread is not shown here: a 4x8px lozenge
 * hanging off the window edge read as a stray speck (see UnreadDot).
 */
function Pill({ active }: { active: boolean }) {
  return (
    <span
      className={classNames(
        'pointer-events-none absolute -right-2 top-1/2 -mt-[18px] h-9 w-1 rounded-l-full bg-ink-50 origin-center',
        'transition-[scale,opacity] duration-150 ease-out',
        active
          ? 'scale-y-100 opacity-100'
          : 'scale-y-[0.22] opacity-0 hover-fine:group-hover:opacity-100 hover-fine:group-hover:scale-y-[0.55]',
      )}
      aria-hidden
    />
  )
}

/**
 * Unread channels in a space: the brand dot the phone tab bar uses, on the
 * tile's top-right. A space with mentions shows its count instead, never both.
 */
function UnreadDot() {
  return (
    <span
      className="pointer-events-none absolute right-0.5 top-0.5 size-2.5 rounded-full bg-brand-600 ring-2 ring-ink-850 dark:bg-brand-500"
      aria-hidden
    />
  )
}

function Count({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span
      className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold tabular-nums flex items-center justify-center ring-2 ring-ink-850"
      aria-hidden
    >
      {n > 9 ? '9+' : n}
    </span>
  )
}

function RailIcon({
  to,
  label,
  icon: Icon,
  active,
  unread = false,
  count = 0,
  tone = 'nav',
}: {
  to: string
  label: string
  icon: RailGlyph
  active: boolean
  unread?: boolean
  count?: number
  tone?: 'nav' | 'add'
}) {
  const aria = `${label}${count ? `, ${to === '/messages' ? `${count} unread` : mentionsLabel(count)}` : unread ? ', unread' : ''}`
  return (
    <RailSlot label={label}>
      <NavLink
        to={to}
        aria-label={aria}
        aria-current={active ? 'page' : undefined}
        className={classNames(
          circle,
          active
            ? 'rounded-2xl bg-brand-600 text-white'
            : tone === 'add'
              ? classNames(idle, 'text-ink-300 hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-400')
              : classNames(idle, 'text-ink-200 hover:bg-ink-700 hover:text-ink-50'),
        )}
      >
        <Icon size={20} weight={active ? 'fill' : 'regular'} aria-hidden />
        <Count n={count} />
      </NavLink>
      {unread && count <= 0 && <UnreadDot />}
      <Pill active={active} />
    </RailSlot>
  )
}

function RailClient({
  client,
  active,
  unread,
  count,
}: {
  client: Client
  active: boolean
  unread: boolean
  count: number
}) {
  const label = client.status === 'paused' ? `${client.name} · paused` : client.name
  return (
    <RailSlot label={label}>
      <NavLink
        to={`/channels?space=${client.id}`}
        aria-label={`${client.name}${count ? `, ${mentionsLabel(count)}` : unread ? ', unread' : ''}`}
        aria-current={active ? 'page' : undefined}
        className={classNames(
          circle,
          // Client colours are fixed fills in both themes, so the initials ink
          // is fixed too (on-swatch, ≥4.5:1 on every preset).
          'text-on-swatch font-display font-semibold text-sm tracking-[-0.01em] hover:brightness-110',
          active && 'rounded-2xl ring-2 ring-ink-50/40',
          !client.color && avatarColor(client.name),
          client.status === 'paused' && !active && 'saturate-50 opacity-70 hover:opacity-100',
        )}
        style={client.color ? { backgroundColor: client.color } : undefined}
      >
        {initials(client.name)}
        <Count n={count} />
      </NavLink>
      {unread && count <= 0 && <UnreadDot />}
      <Pill active={active} />
    </RailSlot>
  )
}
