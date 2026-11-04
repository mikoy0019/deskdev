import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowSquareOutIcon, CaretDownIcon, DotsThreeIcon, FolderPlusIcon, HashIcon, LockIcon,
  MagnifyingGlassIcon, MegaphoneIcon, PencilSimpleIcon, PlusIcon, SlidersHorizontalIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../../store/useStore'
import { avatarColor, classNames, initials } from '../../lib/format'
import { can } from '../../lib/permissions'
import {
  canManageCategory, canManageChannel, channelTree, channelUnread, inSpace, STUDIO_SPACE,
} from '../../lib/channels'
import type { Channel, ChannelCategory } from '../../lib/types'
import ConfirmDialog from '../ConfirmDialog'
import { LayoutIndicator, Skeleton, useStagger } from '../motion'
import CategoryModal from './CategoryModal'
import { Menu, MenuItem } from './Menu'
import SpaceStrip from './SpaceStrip'
import BrandMark from '../ui/BrandMark'

const COLLAPSED_KEY = 'deskdev-channel-collapsed'

function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/** Megaphone for announcements, a lock for private rooms, otherwise the hash. */
export function ChannelIcon({ channel, size = 16, className }: { channel: Channel; size?: number; className?: string }) {
  const Icon = channel.kind === 'announcement' ? MegaphoneIcon : channel.isPrivate ? LockIcon : HashIcon
  return <Icon size={size} className={classNames('shrink-0', className)} aria-hidden />
}

/** The list before the first pull lands: a category label over channel rows. */
function ChannelListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4 pt-1">
      <span className="sr-only">Loading channels</span>
      {[3, 2].map((count, g) => (
        <div key={g}>
          <div className="flex items-center gap-1.5 h-8 pl-1.5">
            <Skeleton w={10} h={10} rounded="sm" />
            <Skeleton w={g === 0 ? 84 : 104} h={9} />
          </div>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 pl-2 h-9 md:h-8">
              <Skeleton w={16} h={16} rounded="sm" />
              <Skeleton w={`${[52, 38, 64][i % 3]}%`} h={11} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Discord-style channel list for one space: the space's name up top (with
 * its menu), collapsible categories, unread dots and mention counts.
 */
export default function ChannelList({
  space,
  activeId,
  onOpen,
  onSwitchSpace,
  onCreateChannel,
  onEditChannel,
}: {
  /** STUDIO_SPACE or a client id. */
  space: string
  activeId: string | undefined
  onOpen: (id: string) => void
  onSwitchSpace: (space: string) => void
  onCreateChannel: (categoryId?: string) => void
  onEditChannel: (channel: Channel) => void
}) {
  const me = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const clients = useStore((s) => s.clients)
  const allCategories = useStore((s) => s.channelCategories)
  const allChannels = useStore((s) => s.channels)
  const messages = useStore((s) => s.channelMessages)
  const reads = useStore((s) => s.channelReads)
  const deleteChannelCategory = useStore((s) => s.deleteChannelCategory)

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed)
  const [categoryModal, setCategoryModal] = useState<{ open: boolean; category?: ChannelCategory }>({ open: false })
  const [pendingDelete, setPendingDelete] = useState<ChannelCategory | null>(null)
  // First load of the list: the categories cascade in once a session.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLDivElement>('channel-list')

  const client = space === STUDIO_SPACE ? undefined : clients.find((c) => c.id === space)
  const clientId = client?.id
  const categories = useMemo(() => inSpace(allCategories, space), [allCategories, space])
  const channels = useMemo(() => inSpace(allChannels, space), [allChannels, space])

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        /* per-viewer convenience only */
      }
      return next
    })
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '')
    return channelTree(categories, channels, me)
      .map((g) => ({
        ...g,
        channels: g.channels
          .filter((c) => !q || c.name.includes(q) || c.topic?.toLowerCase().includes(q))
          .map((c) => ({ channel: c, ...(me ? channelUnread(messages, reads, c.id, me.id) : { unread: 0, mentions: 0 }) })),
      }))
      // While searching, hide categories with nothing to show.
      .filter((g) => !q || g.channels.length > 0)
  }, [categories, channels, messages, reads, me, query])

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Space header — the "server name" bar. */}
      <Menu
        label={`${client?.name ?? 'DeskDev Studio'} menu`}
        align="left"
        width="w-56"
        triggerClassName="pressable-card h-14 w-full shrink-0 px-3 flex items-center gap-2.5 border-b border-ink-600 text-left hover:bg-ink-700/50 aria-expanded:bg-ink-700/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
        trigger={
          <>
            {client ? (
              <span
                className={classNames(
                  'w-8 h-8 rounded-lg flex items-center justify-center text-on-swatch text-xs font-semibold shrink-0',
                  !client.color && avatarColor(client.name),
                )}
                style={client.color ? { backgroundColor: client.color } : undefined}
                aria-hidden
              >
                {initials(client.name)}
              </span>
            ) : (
              // The studio signs with its "D" tile, as in the sidebar and the app icon.
              <BrandMark size={32} />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-ink-50 font-display tracking-tight truncate">
                {client?.name ?? 'DeskDev Studio'}
              </span>
              <span className="block text-[10px] uppercase tracking-wider text-ink-300 truncate">
                {client ? 'Client channels' : 'Studio channels'}
              </span>
            </span>
            <CaretDownIcon size={14} className="text-ink-300 shrink-0" aria-hidden />
          </>
        }
      >
        {(close) => (
          <>
            <MenuItem icon={HashIcon} onClick={() => { close(); onCreateChannel() }}>
              Create channel
            </MenuItem>
            <MenuItem icon={FolderPlusIcon} onClick={() => { close(); setCategoryModal({ open: true }) }}>
              Create category
            </MenuItem>
            {client && can(me, 'clients', 'view') && (
              <Link
                role="menuitem"
                to={`/clients/${client.id}`}
                onClick={close}
                className="pressable w-full flex items-center gap-2.5 px-2.5 py-2 pointer-coarse:py-3 rounded-md text-sm text-ink-100 hover:bg-ink-700/60"
              >
                <ArrowSquareOutIcon size={15} className="shrink-0" aria-hidden /> Open client page
              </Link>
            )}
          </>
        )}
      </Menu>

      {/* Phones have no rail: the shared strip of space circles stands in for it. */}
      <SpaceStrip className="md:hidden" current={space} onSwitchSpace={onSwitchSpace} />

      <div className="p-2 border-b border-ink-600">
        <label className="relative block">
          <MagnifyingGlassIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden />
          <input
            className="input pl-9 w-full py-1.5 pointer-coarse:min-h-11"
            placeholder="Find a channel"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a channel"
          />
        </label>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2" aria-label="Channel list">
        {!hydrated && channels.length === 0 ? (
          <ChannelListSkeleton />
        ) : groups.length === 0 && !query ? (
          <div className="px-4 pt-10 pb-4 md:p-4 flex flex-col items-center text-center">
            {/* Phones show only this pane, so it carries the mark; desktop has the room pane's empty state beside it. */}
            <span className="md:hidden mb-3 flex size-11 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60" aria-hidden>
              <HashIcon size={20} />
            </span>
            <p className="text-sm text-ink-200 text-balance [overflow-wrap:anywhere]">{client ? `No channels for ${client.name} yet.` : 'No channels yet.'}</p>
            <button className="btn-secondary mt-3" onClick={() => onCreateChannel()}>
              <PlusIcon size={14} aria-hidden /> Create a channel
            </button>
          </div>
        ) : groups.length === 0 ? (
          <p className="p-4 text-sm text-ink-300 text-center [overflow-wrap:anywhere]">No channels match “{query}”.</p>
        ) : (
          <div ref={attachStagger} className={staggerClass}>
            {groups.map(({ category, channels: rows }) => {
              const isCollapsed = category !== null && collapsed.includes(category.id) && !query
              // A collapsed category still shows the open channel and anything unread.
              const shown = isCollapsed ? rows.filter((r) => r.channel.id === activeId || r.unread > 0) : rows
              return (
                <div key={category?.id ?? 'loose'} className="mb-3">
                  {category && (
                    <div className="group flex items-center gap-1 pl-1 pr-1 h-8 pointer-coarse:h-11">
                      <button
                        className="pressable flex-1 min-w-0 h-full flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-300 hover:text-ink-100"
                        onClick={() => toggleCollapsed(category.id)}
                        aria-expanded={!isCollapsed}
                      >
                        {/* The caret turns with the state (state indication): transform only, 150ms ease-out. */}
                        <CaretDownIcon
                          size={12}
                          className={classNames('shrink-0 transition-transform duration-150 ease-out', isCollapsed && '-rotate-90')} aria-hidden
                        />
                        <span className="truncate">{category.name}</span>
                      </button>
                      <button
                        className="pressable w-8 h-8 md:w-6 md:h-6 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700/60 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                        onClick={() => onCreateChannel(category.id)}
                        aria-label={`Create channel in ${category.name}`}
                        title="Create channel"
                      >
                        <PlusIcon size={13} aria-hidden />
                      </button>
                      {canManageCategory(category, me) && (
                        <Menu
                          label={`${category.name} options`}
                          trigger={<DotsThreeIcon size={13} aria-hidden />}
                          triggerClassName="pressable w-8 h-8 md:w-6 md:h-6 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700/60 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 aria-expanded:bg-ink-700/60 pointer-coarse:opacity-100"
                          width="w-44"
                        >
                          {(close) => (
                            <>
                              <MenuItem icon={PencilSimpleIcon} onClick={() => { close(); setCategoryModal({ open: true, category }) }}>
                                Rename category
                              </MenuItem>
                              <MenuItem icon={TrashIcon} danger onClick={() => { close(); setPendingDelete(category) }}>
                                Delete category
                              </MenuItem>
                            </>
                          )}
                        </Menu>
                      )}
                    </div>
                  )}

                  {category && !isCollapsed && rows.length === 0 && (
                    <button
                      className="pressable w-full text-left pl-6 py-1.5 pointer-coarse:min-h-11 text-xs text-ink-400 italic hover:text-ink-200"
                      onClick={() => onCreateChannel(category.id)}
                    >
                      No channels — add one
                    </button>
                  )}

                  <ul className="space-y-px">
                    {shown.map(({ channel: c, unread, mentions }) => {
                      const active = c.id === activeId
                      return (
                        <li key={c.id} className="relative group">
                          {unread > 0 && !active && (
                            // The same brand dot as the space rail, inside the row's gutter.
                            <span className="absolute left-0.5 top-1/2 z-10 size-1.5 -translate-y-1/2 rounded-full bg-brand-600" aria-hidden />
                          )}
                          <button
                            className={classNames(
                              'pressable-card relative w-full flex items-center gap-2 pl-2 pr-9 h-11 md:h-8 pointer-coarse:h-11 pointer-coarse:pr-12 rounded-md text-left text-sm',
                              active
                                ? 'text-ink-50 font-medium'
                                : unread > 0
                                  ? 'text-ink-50 font-semibold hover:bg-ink-700/60'
                                  : 'text-ink-300 hover:text-ink-100 hover:bg-ink-700/60',
                            )}
                            onClick={() => onOpen(c.id)}
                            aria-current={active ? 'page' : undefined}
                            aria-label={`${c.name}${unread ? `, ${unread} unread` : ''}${mentions ? `, ${mentions} ${mentions === 1 ? 'mention' : 'mentions'}` : ''}`}
                          >
                            {/* The selection glides to the room you open, like the sidebar's marker. */}
                            {active && (
                              <LayoutIndicator layoutId="channel-active" radius={6} className="absolute inset-0 bg-brand-600/10 dark:bg-brand-500/12" />
                            )}
                            <ChannelIcon channel={c} className={classNames('relative', active || unread ? 'text-ink-200' : 'text-ink-400')} />
                            <span className="relative flex-1 min-w-0 truncate">{c.name}</span>
                          </button>
                          <span className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
                            {mentions > 0 && (
                              <span
                                className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand-600 text-white text-[10px] font-semibold tabular-nums flex items-center justify-center md:group-hover:hidden"
                                aria-hidden
                              >
                                {mentions > 99 ? '99+' : mentions}
                              </span>
                            )}
                            {canManageChannel(c, me) && (
                              <button
                                className={classNames(
                                  'pressable w-8 h-8 md:w-6 md:h-6 pointer-coarse:w-11 pointer-coarse:h-11 items-center justify-center rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700/60 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
                                  // With mentions the badge holds this spot; a mouse swaps it for
                                  // Edit on hover. Touch never hovers, so there Edit waits until
                                  // the channel is read (its room has the same settings).
                                  mentions > 0 ? 'hidden md:group-hover:flex' : 'flex',
                                )}
                                onClick={() => onEditChannel(c)}
                                aria-label={`Edit #${c.name}`}
                                title="Edit channel"
                              >
                                <SlidersHorizontalIcon size={13} aria-hidden />
                              </button>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </nav>

      <CategoryModal
        open={categoryModal.open}
        category={categoryModal.category}
        clientId={clientId}
        onClose={() => setCategoryModal({ open: false })}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete “${pendingDelete?.name}”?`}
        message="The category is removed. Its channels and their messages are kept and move to the top of the list."
        confirmLabel="Delete category"
        danger
        onConfirm={() => pendingDelete && deleteChannelCategory(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
