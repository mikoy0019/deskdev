import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftIcon, HashIcon, MegaphoneIcon, PushPinIcon, SlidersHorizontalIcon, UsersIcon,
} from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../../store/useStore'
import { classNames } from '../../lib/format'
import { dayLabel } from '../../lib/chat'
import {
  canManageChannel, canPostInChannel, channelLastReadAt, channelMembers, channelMessagesOf,
  firstUnreadId, pinnedMessages, startsGroup, startsNewDay,
} from '../../lib/channels'
import type { Channel, ChannelMessage } from '../../lib/types'
import ConfirmDialog from '../ConfirmDialog'
import Modal from '../Modal'
import { Presence, Skeleton } from '../motion'
import ChannelMessageRow, { type MessageActions } from './ChannelMessageRow'
import ChannelComposer, { type ComposerHandle } from './ChannelComposer'
import MemberPanel from './MemberPanel'
import PinnedPanel from './PinnedPanel'
import { ChannelIcon } from './ChannelList'

const MEMBERS_KEY = 'deskdev-channel-members-open'

function readMembersOpen(): boolean {
  try {
    return localStorage.getItem(MEMBERS_KEY) !== '0'
  } catch {
    return true
  }
}

/** A room before the first pull lands: its header, a few message groups, the composer. */
export function RoomSkeleton() {
  return (
    <div role="status" aria-busy="true" className="h-full flex flex-col min-h-0">
      <span className="sr-only">Loading channel</span>
      {/* Phones hide Layout's heading in a room, so the screen keeps its h1 while loading. */}
      <h1 className="sr-only md:hidden">Channels</h1>
      <div className="h-14 shrink-0 px-3 md:px-4 flex items-center gap-2.5 border-b border-ink-600 max-md:bg-ink-850">
        <Skeleton w={18} h={18} rounded="sm" />
        <Skeleton w={110} h={12} />
        <Skeleton w={180} h={10} className="hidden sm:block ml-2" />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pt-8 space-y-6">
        {[
          [44, 72],
          [36, 58, 40],
          [52, 66],
          [30, 48],
        ].map((lines, i) => (
          <div key={i} className="flex gap-3 pl-4 pr-6">
            <Skeleton w={40} h={40} rounded="full" />
            <div className="flex-1 min-w-0 space-y-2 pt-0.5">
              <div className="flex items-center gap-2">
                <Skeleton w={96 + (i % 2) * 24} h={11} />
                <Skeleton w={44} h={9} />
              </div>
              {lines.map((w, j) => (
                <Skeleton key={j} w={`${w}%`} h={11} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 px-4 pb-4 max-md:px-3 max-md:pb-[max(0.75rem,var(--safe-bottom))]">
        <Skeleton h={48} rounded="lg" />
      </div>
    </div>
  )
}

/** One channel: header, message log, composer and the optional member list. */
export default function ChannelRoom({
  channelId,
  onBack,
  onEdit,
}: {
  channelId: string
  /** Narrow screens: return to the channel list. */
  onBack: () => void
  onEdit: (channel: Channel) => void
}) {
  const me = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const users = useStore((s) => s.users)
  const channel = useStore((s) => s.channels.find((c) => c.id === channelId))
  const allMessages = useStore((s) => s.channelMessages)
  const reactions = useStore((s) => s.channelReactions)
  const reads = useStore((s) => s.channelReads)
  const sendChannelMessage = useStore((s) => s.sendChannelMessageConfirmed)
  const editChannelMessage = useStore((s) => s.editChannelMessage)
  const deleteChannelMessage = useStore((s) => s.deleteChannelMessage)
  const togglePinChannelMessage = useStore((s) => s.togglePinChannelMessage)
  const toggleChannelReaction = useStore((s) => s.toggleChannelReaction)
  const markChannelRead = useStore((s) => s.markChannelRead)

  const messages = useMemo(() => channelMessagesOf(allMessages, channelId), [allMessages, channelId])
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const pinned = useMemo(() => pinnedMessages(allMessages, channelId), [allMessages, channelId])
  const channelReactions = useMemo(() => reactions.filter((r) => r.channelId === channelId), [reactions, channelId])

  // Captured once per visit so the "New" divider stays put while you read.
  const [readSince] = useState(() => (me ? channelLastReadAt(reads, channelId, me.id) : undefined))
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ChannelMessage | null>(null)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(readMembersOpen)
  // Below lg there's no side column: the member list opens as a sheet.
  const [membersSheet, setMembersSheet] = useState(false)
  // Touch: the message whose action toolbar is showing (there's no hover).
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const composerRef = useRef<ComposerHandle>(null)

  const newDividerId = me ? firstUnreadId(messages, readSince, me.id) : undefined

  // Open at the first unread message if there is one, otherwise at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = newDividerId && document.getElementById(`msg-${newDividerId}`)
    if (target) {
      el.scrollTop = Math.max(0, target.offsetTop - el.clientHeight / 3)
      stickToBottom.current = false
    } else {
      el.scrollTop = el.scrollHeight
    }
    // Only on arrival — later messages are handled by the follow effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  // Follow new messages only when the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // Reading the channel clears its unread state — but only while it is visible.
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === 'visible') markChannelRead(channelId)
    }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [channelId, messages.length, markChannelRead])

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setHighlightId(id)
    window.setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 1600)
  }, [])

  // Every action also dismisses a touch selection, so the toolbar never
  // lingers over the row after doing its job.
  const actions = useMemo<MessageActions>(
    () => ({
      react: (id, emoji) => {
        setSelectedId(null)
        toggleChannelReaction(id, emoji)
      },
      reply: (m) => {
        setSelectedId(null)
        setReplyTo(m)
        composerRef.current?.focus()
      },
      togglePin: (id) => {
        setSelectedId(null)
        togglePinChannelMessage(id)
      },
      edit: editChannelMessage,
      remove: (m) => {
        setSelectedId(null)
        setPendingDelete(m)
      },
      jumpTo,
    }),
    [toggleChannelReaction, togglePinChannelMessage, editChannelMessage, jumpTo],
  )

  // Before the first pull, a missing room is still loading — not gone.
  if (!channel && !hydrated) return <RoomSkeleton />

  if (!channel || !me) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        {/* The same raised mark tile as the app's empty states. */}
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60" aria-hidden>
          <HashIcon size={24} />
        </span>
        <p className="mt-4 max-w-xs text-sm text-ink-200 text-balance">This channel doesn’t exist or you don’t have access to it.</p>
        <button className="btn-secondary mt-5" onClick={onBack}>
          <ArrowLeftIcon size={14} aria-hidden /> Back to channels
        </button>
      </div>
    )
  }

  const manage = canManageChannel(channel, me)
  const canPost = canPostInChannel(channel, me)
  const members = channelMembers(channel, users)

  const toggleMembers = () => {
    setMembersOpen((open) => {
      try {
        localStorage.setItem(MEMBERS_KEY, open ? '0' : '1')
      } catch {
        /* per-viewer convenience only */
      }
      return !open
    })
  }

  const editLast = () => {
    const last = [...messages].reverse().find((m) => m.senderId === me.id)
    if (last) setEditingId(last.id)
  }

  // Press feedback (scale 0.97, 160ms) rides on `pressable`; hover is colour only.
  const headerButton =
    'pressable relative p-2 max-md:p-[14px] rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700'

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Header */}
        {/* On phones this is the screen's top bar (Layout hides its own), so it takes the bar surface. */}
        <div className="h-14 shrink-0 px-3 md:px-4 flex items-center gap-2 max-md:gap-1.5 border-b border-ink-600 max-md:bg-ink-850">
          <button
            className="pressable md:hidden size-[44px] -ml-2.5 shrink-0 flex items-center justify-center rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700"
            onClick={onBack}
            aria-label="Back to channels"
          >
            <ArrowLeftIcon size={18} aria-hidden />
          </button>
          <ChannelIcon channel={channel} size={18} className="text-ink-300" />
          {/* A 50-character name shares the bar with the topic and never pushes the actions out. */}
          <h1
            className={classNames(
              'min-w-0 truncate text-sm font-semibold text-ink-50',
              channel.topic && 'shrink-0 max-w-[45%] sm:max-w-[55%]',
            )}
            title={channel.name}
          >
            {channel.name}
          </h1>
          {channel.topic && (
            <>
              <span className="hidden sm:block w-px h-5 bg-ink-600 mx-1 shrink-0" aria-hidden />
              <p className="hidden sm:block text-xs text-ink-300 truncate min-w-0" title={channel.topic}>
                {channel.topic}
              </p>
            </>
          )}
          <div className="ml-auto flex items-center gap-0.5 max-md:gap-0 max-md:-mr-2 shrink-0">
            <div className="relative">
              <button
                className={classNames(headerButton, pinsOpen && 'bg-ink-700 text-ink-50')}
                onClick={() => {
                  setSelectedId(null)
                  setPinsOpen((o) => !o)
                }}
                aria-label={`Pinned messages (${pinned.length})`}
                title="Pinned messages"
                aria-haspopup="dialog"
                aria-expanded={pinsOpen}
              >
                <PushPinIcon size={16} weight={pinsOpen ? 'fill' : 'regular'} aria-hidden />
                {pinned.length > 0 && (
                  <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-brand-600 text-white text-[9px] font-semibold tabular-nums flex items-center justify-center">
                    {pinned.length}
                  </span>
                )}
              </button>
              <Presence>
                {pinsOpen && (
                  <PinnedPanel
                    key="pins"
                    pinned={pinned}
                    users={users}
                    meId={me.id}
                    canManage={manage}
                    onJump={(id) => {
                      setPinsOpen(false)
                      jumpTo(id)
                    }}
                    onUnpin={togglePinChannelMessage}
                    onClose={() => setPinsOpen(false)}
                  />
                )}
              </Presence>
            </div>
            <button
              className={classNames(headerButton, 'hidden lg:inline-flex', membersOpen && 'bg-ink-700 text-ink-50')}
              onClick={toggleMembers}
              aria-label={membersOpen ? 'Hide member list' : 'Show member list'}
              title="Member list"
              aria-pressed={membersOpen}
            >
              <UsersIcon size={16} weight={membersOpen ? 'fill' : 'regular'} aria-hidden />
            </button>
            <button
              className={classNames(headerButton, 'lg:hidden')}
              onClick={() => setMembersSheet(true)}
              aria-label={`Members (${members.length})`}
              title="Members"
              aria-haspopup="dialog"
            >
              <UsersIcon size={16} aria-hidden />
            </button>
            {manage && (
              <button className={headerButton} onClick={() => onEdit(channel)} aria-label="Edit channel" title="Edit channel">
                <SlidersHorizontalIcon size={16} aria-hidden />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain pb-4"
          onScroll={(e) => {
            const el = e.currentTarget
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            // A selected row's toolbar shouldn't float over rows scrolling past.
            if (selectedId) setSelectedId(null)
          }}
          // A tap on empty log space dismisses a touch selection.
          onClick={(e) => {
            if (selectedId && e.target === e.currentTarget) setSelectedId(null)
          }}
          role="log"
          aria-live="polite"
          aria-label={`Messages in #${channel.name}`}
        >
          {/* Channel welcome — the top of history. */}
          <div className="px-4 pt-10 pb-4">
            <span className="w-16 h-16 rounded-full bg-ink-700 border border-ink-600 flex items-center justify-center text-ink-200">
              {channel.kind === 'announcement' ? <MegaphoneIcon size={30} aria-hidden /> : <HashIcon size={32} aria-hidden />}
            </span>
            <h2 className="mt-3 text-2xl font-display font-semibold tracking-tight text-ink-50">Welcome to #{channel.name}!</h2>
            <p className="mt-1 text-sm text-ink-300 max-w-xl">
              This is the start of the #{channel.name} {channel.isPrivate ? 'private ' : ''}channel.
              {channel.topic ? ` ${channel.topic}` : ''}
            </p>
            {messages.length === 0 && canPost && (
              <p className="mt-3 text-xs text-ink-400">Say hello — you’re the first one here.</p>
            )}
          </div>

          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = startsNewDay(prev, m)
            const isNew = m.id === newDividerId
            return (
              <Fragment key={m.id}>
                {newDay && !isNew && (
                  <div className="flex items-center gap-3 mx-4 my-4" role="separator">
                    <span className="flex-1 h-px bg-ink-600" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">{dayLabel(m.createdAt)}</span>
                    <span className="flex-1 h-px bg-ink-600" />
                  </div>
                )}
                {isNew && (
                  <div className="flex items-center gap-2 mx-4 my-3" role="separator" aria-label="New messages">
                    <span className="flex-1 h-px bg-rose-500/70" />
                    {newDay && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">{dayLabel(m.createdAt)}</span>
                    )}
                    <span className="px-1.5 rounded-xs bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[10px] font-bold uppercase tracking-wider">New</span>
                  </div>
                )}
                <ChannelMessageRow
                  message={m}
                  parent={m.replyToId ? byId.get(m.replyToId) : undefined}
                  groupStart={newDay || isNew || startsGroup(prev, m)}
                  users={users}
                  me={me}
                  reactions={channelReactions}
                  canManage={manage}
                  canReply={canPost}
                  highlighted={m.id === highlightId}
                  selected={m.id === selectedId}
                  onSelect={setSelectedId}
                  editing={m.id === editingId}
                  onStartEdit={() => {
                    setSelectedId(null)
                    setEditingId(m.id)
                  }}
                  onStopEdit={() => {
                    setEditingId(null)
                    composerRef.current?.focus()
                  }}
                  actions={actions}
                />
              </Fragment>
            )
          })}
        </div>

        <ChannelComposer
          key={channel.id}
          ref={composerRef}
          channel={channel}
          canPost={canPost}
          members={members}
          users={users}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={async (body) => {
            const id = await sendChannelMessage(channel.id, body, replyTo?.id)
            if (id) {
              setReplyTo(null)
              stickToBottom.current = true
            }
            return id
          }}
          onEditLast={editLast}
        />
      </div>

      {membersOpen && (
        <div className="hidden lg:block w-60 shrink-0 border-l border-ink-600 min-h-0">
          <MemberPanel channel={channel} members={members} />
        </div>
      )}

      <Modal open={membersSheet} onClose={() => setMembersSheet(false)} title={`Members · #${channel.name}`}>
        <MemberPanel channel={channel} members={members} variant="sheet" />
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete message?"
        message={
          pendingDelete && pendingDelete.senderId !== me.id
            ? 'You are removing someone else’s message as a channel manager. It is deleted for everyone.'
            : 'It will be removed for everyone in this channel.'
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingDelete) return
          deleteChannelMessage(pendingDelete.id)
          if (replyTo?.id === pendingDelete.id) setReplyTo(null)
          if (editingId === pendingDelete.id) setEditingId(null)
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
