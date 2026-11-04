import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChatCircleIcon } from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../../store/useStore'
import { avatarColor, classNames, initials } from '../../lib/format'
import { spaceBadges, STUDIO_SPACE } from '../../lib/channels'
import { useUnreadMessageCount } from '../messages/useUnreadMessageCount'
import { BrandGlyph } from '../ui/BrandMark'

// 44px circles (px, so compact density can't shrink them) with the rail's
// shape language: a squircle for the open space, a circle otherwise. The
// shape swaps instantly (no border-radius tween: paint, not transform).
const circle =
  'pressable relative size-[44px] shrink-0 flex items-center justify-center ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-850'

// The rail's resting tile: card surface with an inset hairline (box-shadow, so
// the focus ring still layers on top) — the open space fills with the brand.
const idleTile = 'rounded-full bg-ink-800 text-ink-200 shadow-[inset_0_0_0_1px_rgb(var(--ink-600))]'
const openTile = 'rounded-xl bg-brand-600 text-white'

function Count({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span
      className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-medium tabular-nums flex items-center justify-center ring-2 ring-ink-850"
      aria-hidden
    >
      {n > 9 ? '9+' : n}
    </span>
  )
}

function Dot() {
  return <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-brand-500 ring-2 ring-ink-850" aria-hidden />
}

/**
 * Phones have no space rail, so this strip stands in for it at the top of the
 * Messages inbox and the channel list: DMs, the studio and every client, with
 * the rail's badges (a count means someone needs you, a dot is just news). It
 * makes the Chat tab one hub for DMs and channels.
 */
export default function SpaceStrip({
  current,
  onSwitchSpace,
  className,
}: {
  /** 'messages' on the inbox, else the open space (STUDIO_SPACE or a client id). */
  current: string
  /** Defaults to opening that space's channels. */
  onSwitchSpace?: (space: string) => void
  className?: string
}) {
  const navigate = useNavigate()
  const me = useCurrentUser()
  const clients = useStore((s) => s.clients)
  const channels = useStore((s) => s.channels)
  const messages = useStore((s) => s.channelMessages)
  const reads = useStore((s) => s.channelReads)
  const unreadDMs = useUnreadMessageCount()

  const badges = useMemo(() => spaceBadges(channels, messages, reads, me), [channels, messages, reads, me])
  const spaces = useMemo(
    () => [...clients].filter((c) => c.status !== 'ended').sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  )

  const go = (space: string) => (onSwitchSpace ? onSwitchSpace(space) : navigate(`/channels?space=${space}`))
  const label = (name: string, b?: { unreadChannels: number; mentions: number }) =>
    `${name}${b?.mentions ? `, ${b.mentions} ${b.mentions === 1 ? 'mention' : 'mentions'}` : b?.unreadChannels ? ', unread' : ''}`

  const studio = badges.get(STUDIO_SPACE)
  const onMessages = current === 'messages'

  return (
    <nav
      className={classNames('flex items-center gap-2 px-3 py-2 border-b border-ink-600 overflow-x-auto overscroll-x-contain', className)}
      aria-label="Spaces"
    >
      <Link
        to="/messages"
        className={classNames(circle, onMessages ? openTile : idleTile)}
        aria-label={unreadDMs > 0 ? `Messages, ${unreadDMs} unread` : 'Messages'}
        aria-current={onMessages ? 'page' : undefined}
      >
        <ChatCircleIcon size={20} weight={onMessages ? 'fill' : 'regular'} aria-hidden />
        {!onMessages && <Count n={unreadDMs} />}
      </Link>
      <span className="w-px h-6 bg-ink-600 shrink-0" aria-hidden />
      <button
        type="button"
        aria-label={label('DeskDev Studio', studio)}
        aria-current={current === STUDIO_SPACE ? 'page' : undefined}
        onClick={() => go(STUDIO_SPACE)}
        className={classNames(circle, current === STUDIO_SPACE ? openTile : idleTile)}
      >
        {/* The studio signs with its "D", as on the rail and the app icon. */}
        <BrandGlyph size={20} />
        {(studio?.mentions ?? 0) > 0 ? <Count n={studio!.mentions} /> : (studio?.unreadChannels ?? 0) > 0 && <Dot />}
      </button>
      {spaces.map((c) => {
        const b = badges.get(c.id)
        const active = current === c.id
        return (
          <button
            key={c.id}
            type="button"
            aria-label={label(c.name, b)}
            aria-current={active ? 'page' : undefined}
            onClick={() => go(c.id)}
            className={classNames(
              circle,
              // Client colours are fixed fills in both themes, so the initials ink
              // is fixed too (on-swatch, ≥4.5:1 on every preset), as in SpaceRail.
              'text-on-swatch font-display text-xs font-semibold tracking-[-0.01em]',
              active ? 'rounded-xl ring-2 ring-ink-50/40' : 'rounded-full',
              !c.color && avatarColor(c.name),
            )}
            style={c.color ? { backgroundColor: c.color } : undefined}
          >
            {initials(c.name)}
            {(b?.mentions ?? 0) > 0 ? <Count n={b!.mentions} /> : (b?.unreadChannels ?? 0) > 0 && <Dot />}
          </button>
        )
      })}
    </nav>
  )
}
