import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeftIcon, ChatSlashIcon, CheckIcon, DotsThreeIcon, PaperPlaneRightIcon, PencilSimpleIcon, TrashIcon,
  UsersIcon, XIcon,
} from '@phosphor-icons/react'
import Avatar from '../Avatar'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { PopoverPanel, Presence, Skeleton } from '../motion'
import { useStore, useCurrentUser } from '../../store/useStore'
import { classNames, fmtTime } from '../../lib/format'
import {
  conversationTitle, dayLabel, MAX_MESSAGE_LENGTH, otherParticipants,
  seenByOthers, startsDay, startsRun, threadMessages,
} from '../../lib/chat'
import type { ChatMessage } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'
import { useCoarsePointer } from '../../pwa/useMediaQuery'
import { useMessageDraft } from './useMessageDraft'

const QUICK_REPLIES = ['👋 Hi!', 'Got a minute?', 'Thanks!']

// Icon buttons in the thread's top bar: 44px under a finger, press feedback.
const barButton =
  'pressable flex items-center justify-center rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700'

/** A thread before the first pull lands: its header and a few bubbles, both sides. */
function ThreadSkeleton() {
  return (
    <div role="status" aria-busy="true" className="h-full flex flex-col min-h-0">
      <span className="sr-only">Loading conversation</span>
      {/* Phones hide Layout's heading in a thread, so the screen keeps its h1 while loading. */}
      <h1 className="sr-only md:hidden">Messages</h1>
      <div className="h-14 shrink-0 px-3 md:px-4 flex items-center gap-2.5 border-b border-ink-600 max-md:bg-ink-850">
        <Skeleton w={32} h={32} rounded="full" />
        <div className="space-y-1.5">
          <Skeleton w={120} h={12} />
          <Skeleton w={72} h={9} />
        </div>
      </div>
      <div className="flex-1 min-h-0 px-3 md:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-3">
          {[
            { mine: false, w: '52%' },
            { mine: true, w: '38%' },
            { mine: false, w: '61%' },
            { mine: false, w: '34%' },
            { mine: true, w: '46%' },
          ].map((b, i) => (
            <div key={i} className={classNames('flex items-end gap-2', b.mine ? 'justify-end' : 'justify-start')}>
              {!b.mine && <Skeleton w={32} h={32} rounded="full" />}
              <Skeleton w={b.w} h={36} style={{ borderRadius: 16 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Rename a group. The draft lives here, not in the thread: typing re-renders
 * this small form only, and the dialog's props stay the same between keystrokes.
 */
function RenameGroupModal({
  open,
  current,
  onClose,
  onSave,
}: {
  open: boolean
  current: string
  onClose: () => void
  onSave: (title: string) => void
}) {
  const [value, setValue] = useState(current)
  // Start from the saved name each time it opens (it stays mounted to play its exit).
  useResetOnChange([open], () => {
    if (open) setValue(current)
  })
  const save = () => {
    onSave(value)
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename group"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="block">
        <span className="block text-xs font-medium text-ink-200">Group name</span>
        <input
          className="input mt-1.5 w-full"
          value={value}
          maxLength={80}
          placeholder="Group name"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            save()
          }}
          autoFocus
        />
      </label>
    </Modal>
  )
}

export default function ChatThread({
  conversationId,
  onBack,
}: {
  conversationId: string
  /** Narrow screens: return to the inbox. */
  onBack: () => void
}) {
  const me = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const users = useStore((s) => s.users)
  const conversation = useStore((s) => s.conversations.find((c) => c.id === conversationId))
  const allMessages = useStore((s) => s.messages)
  const reads = useStore((s) => s.conversationReads)
  const sendMessage = useStore((s) => s.sendMessageConfirmed)
  const editMessage = useStore((s) => s.editMessage)
  const deleteMessage = useStore((s) => s.deleteMessage)
  const markConversationRead = useStore((s) => s.markConversationRead)
  const renameConversation = useStore((s) => s.renameConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)

  const messages = useMemo(() => threadMessages(allMessages, conversationId), [allMessages, conversationId])
  const [newDraft, setNewDraft] = useMessageDraft('chat', conversationId, me?.id)
  const [editDraft, setEditDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const draft = editingId ? editDraft : newDraft
  const setDraft = editingId ? setEditDraft : setNewDraft
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [replyToId, setReplyToId] = useState<string | undefined>()
  const sendingRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const closeRename = useCallback(() => setRenameOpen(false), [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingDeleteMsg, setPendingDeleteMsg] = useState<ChatMessage | null>(null)
  // Touch: which of my bubbles has its edit/delete revealed (there's no hover).
  const [actionsFor, setActionsFor] = useState<string | null>(null)
  const coarse = useCoarsePointer()

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)
  const menuRef = useRef<HTMLDivElement>(null)

  // Opening a thread jumps to the latest message (Messages keys this component
  // by conversation, so the composer state starts fresh). A mouse user gets the
  // caret straight away; on touch that would throw the keyboard over the
  // conversation before it has been read.
  useEffect(() => {
    stickToBottom.current = true
    if (!window.matchMedia?.('(pointer: coarse)').matches) inputRef.current?.focus()
  }, [conversationId])

  // Follow new messages only when the reader is already at the bottom, so
  // scrolling back through history isn't yanked away by incoming replies.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length, conversationId])

  // Reading the thread clears its unread badge — but only while it is visible.
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === 'visible') markConversationRead(conversationId)
    }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [conversationId, messages.length, markConversationRead])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    // A menu takes focus when it opens, so the arrow keys work straight away.
    items()[0]?.focus({ preventScroll: true })
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        menuRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus()
        return
      }
      const list = items()
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (i < 0) return
      if (e.key === 'Tab') {
        setMenuOpen(false)
        return
      }
      let next = -1
      if (e.key === 'ArrowDown') next = (i + 1) % list.length
      else if (e.key === 'ArrowUp') next = i === 0 ? list.length - 1 : i - 1
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = list.length - 1
      if (next < 0) return
      e.preventDefault()
      list[next].focus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Auto-grow the composer up to ~6 lines.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  // Before the first pull, a missing thread is still loading — not gone.
  if (!conversation && !hydrated) return <ThreadSkeleton />

  if (!conversation || !me || me.deactivatedAt || !conversation.participantIds.includes(me.id)) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        {/* The same raised mark tile as the app's empty states. */}
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60" aria-hidden>
          <ChatSlashIcon size={24} />
        </span>
        <p className="mt-4 text-sm text-ink-200 text-balance">This conversation is no longer available.</p>
        <button className="btn-secondary mt-5" onClick={onBack}>
          <ArrowLeftIcon size={14} aria-hidden /> Back to inbox
        </button>
      </div>
    )
  }

  const title = conversationTitle(conversation, users, me.id)
  const others = otherParticipants(conversation, users, me.id)
  const subtitle = conversation.isGroup
    ? `${conversation.participantIds.length} members`
    : others[0]?.title || (others[0] ? others[0].role : '')
  const canDelete = conversation.createdBy === me.id || me.role === 'admin'
  const lastMine = [...messages].reverse().find((m) => m.senderId === me.id)
  const lastMessage = messages[messages.length - 1]
  const showSeen = lastMessage?.id === lastMine?.id && seenByOthers(conversation, lastMine, reads, me.id)

  const submit = async (text = draft) => {
    const body = text.trim()
    if (!body || sendingRef.current) return
    setSendError(null)
    sendingRef.current = true
    setSending(true)
    try {
    if (editingId) {
      if (!messages.some((m) => m.id === editingId && m.senderId === me.id)) {
        setSendError('This message is no longer available. Copy your edit or cancel.')
        return
      }
      editMessage(editingId, body)
      setEditingId(null)
      setEditDraft('')
    } else if (!await sendMessage(conversationId, body, replyToId)) {
      setSendError('Message could not be sent. Check that this conversation is still available and try again.')
      return
    } else {
      setNewDraft('')
      setReplyToId(undefined)
    }
    stickToBottom.current = true
    } catch {
      setSendError('Message could not be sent. Check your connection and try again.')
    } finally {
      sendingRef.current = false
      setSending(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Phone keyboards have no Shift+Enter: there Return is a new line and the
    // Send button sends.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && editingId) {
      setEditingId(null)
      setEditDraft('')
      setSendError(null)
    } else if (e.key === 'ArrowUp' && !draft && !editingId && lastMine) {
      e.preventDefault()
      startEdit(lastMine)
    }
  }

  // A dialog hands focus back to whatever held it when it opened. The menu
  // item is gone by then, so the options button takes it first.
  const focusMenuButton = () => menuRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus()

  const startEdit = (m: ChatMessage) => {
    setActionsFor(null)
    setEditingId(m.id)
    setReplyToId(undefined)
    setEditDraft(m.body)
    setSendError(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Thread header */}
      {/* On phones this is the screen's top bar (Layout hides its own), so it takes the bar surface. */}
      <div className="h-14 shrink-0 px-3 md:px-4 flex items-center gap-2.5 border-b border-ink-600 max-md:bg-ink-850">
        <button
          className={classNames(barButton, 'md:hidden size-[44px] -ml-2.5 -mr-1 shrink-0')}
          onClick={onBack}
          aria-label="Back to inbox"
        >
          <ArrowLeftIcon size={18} aria-hidden />
        </button>
        {conversation.isGroup ? (
          <span className="w-8 h-8 rounded-full bg-ink-700 border border-ink-600 flex items-center justify-center text-ink-300 shrink-0">
            <UsersIcon size={15} aria-hidden />
          </span>
        ) : (
          <Avatar name={title} />
        )}
        <div className="flex-1 min-w-0">
          {/* The screen's title on phones, where Layout hides its own heading. */}
          <h1 className="text-sm font-semibold text-ink-50 truncate">{title}</h1>
          {/* Capitalise only a bare role ("member"): never a typed title or "4 members". */}
          {subtitle && <div className={classNames('text-[11px] text-ink-300 truncate', !conversation.isGroup && !others[0]?.title && 'capitalize')}>{subtitle}</div>}
        </div>
        {(conversation.isGroup || canDelete) && (
          <div className="relative" ref={menuRef}>
            <button
              className={classNames(barButton, 'p-2 max-md:p-[14px] max-md:-mr-2', menuOpen && 'bg-ink-700 text-ink-50')}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Conversation options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <DotsThreeIcon size={16} aria-hidden />
            </button>
            {/* Grows from the button's corner (origin-aware), 180ms in / 120ms out. */}
            <Presence>
              {menuOpen && (
                <PopoverPanel
                  key="conversation-menu"
                  placement="bottom-end"
                  className="absolute right-0 top-full mt-1 w-48 card z-20 p-1"
                  style={{ boxShadow: 'var(--shadow-3)' }}
                  role="menu"
                  aria-label="Conversation options"
                >
                  {conversation.isGroup && (
                    <button
                      role="menuitem"
                      className="pressable w-full flex items-center gap-2.5 px-2.5 py-2 pointer-coarse:py-3 rounded-md text-sm text-ink-100 hover:bg-ink-700/60"
                      onClick={() => {
                        focusMenuButton()
                        setRenameOpen(true)
                        setMenuOpen(false)
                      }}
                    >
                      <PencilSimpleIcon size={15} aria-hidden /> Rename group
                    </button>
                  )}
                  {canDelete && (
                    <button
                      role="menuitem"
                      className="pressable w-full flex items-center gap-2.5 px-2.5 py-2 pointer-coarse:py-3 rounded-md text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                      onClick={() => {
                        focusMenuButton()
                        setConfirmDelete(true)
                        setMenuOpen(false)
                      }}
                    >
                      <TrashIcon size={15} aria-hidden /> Delete conversation
                    </button>
                  )}
                </PopoverPanel>
              )}
            </Presence>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 md:px-6 py-4"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          if (actionsFor) setActionsFor(null)
        }}
        role="log"
        aria-live="polite"
        aria-label={`Messages with ${title}`}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3">
            {conversation.isGroup ? (
              <span className="w-12 h-12 rounded-full bg-ink-700 border border-ink-600 flex items-center justify-center text-ink-300">
                <UsersIcon size={20} aria-hidden />
              </span>
            ) : (
              <Avatar name={title} size="lg" />
            )}
            <div>
              <p className="text-sm font-medium text-ink-50">Start the conversation with {title}</p>
              <p className="text-xs text-ink-300 mt-0.5">Messages are only visible to people in this chat.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_REPLIES.map((q) => (
                <button key={q} className="pressable inline-flex items-center rounded-full border text-xs font-medium border-ink-600 bg-ink-800 text-ink-100 hover:bg-ink-700 hover:border-ink-500 px-3 py-1.5 pointer-coarse:min-h-11" onClick={() => submit(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const next = messages[i + 1]
              const mine = m.senderId === me.id
              const newDay = startsDay(prev, m)
              const runStart = newDay || startsRun(prev, m)
              const runEnd = !next || startsDay(m, next) || startsRun(m, next)
              const sender = users.find((u) => u.id === m.senderId)
              const senderName = sender?.fullName ?? 'Former member'
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="flex items-center gap-3 my-4" role="separator">
                      <span className="flex-1 h-px bg-ink-600" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">
                        {dayLabel(m.createdAt)}
                      </span>
                      <span className="flex-1 h-px bg-ink-600" />
                    </div>
                  )}
                  <div data-item-kind="message" data-item-id={m.id} data-item-label={m.body.slice(0, 120)}
                    className={classNames(
                      'group flex items-end gap-2',
                      mine ? 'justify-end' : 'justify-start',
                      runStart ? 'mt-3' : 'mt-0.5',
                    )}
                  >
                    {!mine && (
                      <span className="w-8 shrink-0">
                        {runEnd && <Avatar name={senderName} />}
                      </span>
                    )}

                    <button type="button" className="btn-ghost shrink-0 px-1 text-xs" aria-label={`Reply to ${senderName}`}
                      onClick={() => { setEditingId(null); setReplyToId(m.id); inputRef.current?.focus() }}>Reply</button>
                    {mine && (
                      // Hidden actions must not be tappable: they only take pointer
                      // events while shown (hover, keyboard focus, or a tap on the bubble).
                      <span
                        className={classNames(
                          'flex items-center gap-0.5 transition-opacity duration-150 ease-[ease]',
                          actionsFor === m.id
                            ? 'opacity-100'
                            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
                        )}
                      >
                        <button
                          className="pressable p-1 pointer-coarse:size-[44px] pointer-coarse:flex pointer-coarse:items-center pointer-coarse:justify-center rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700"
                          onClick={() => startEdit(m)}
                          aria-label="Edit message"
                          title="Edit"
                        >
                          <PencilSimpleIcon size={12} aria-hidden />
                        </button>
                        <button
                          className="pressable p-1 pointer-coarse:size-[44px] pointer-coarse:flex pointer-coarse:items-center pointer-coarse:justify-center rounded-md text-ink-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-700"
                          onClick={() => {
                            setActionsFor(null)
                            setPendingDeleteMsg(m)
                          }}
                          aria-label="Delete message"
                          title="Delete"
                        >
                          <TrashIcon size={12} aria-hidden />
                        </button>
                      </span>
                    )}

                    {/* min-w-0 + max-w-full: a long link or unbroken string wraps inside the bubble
                        instead of pushing its start off the pane. */}
                    <div className={classNames('min-w-0 max-w-[78%] md:max-w-[65%] flex flex-col', mine ? 'items-end' : 'items-start')}>
                      {!mine && conversation.isGroup && runStart && (
                        <span className="text-[11px] text-ink-300 mb-0.5 ml-1">{senderName}</span>
                      )}
                      <div
                        className={classNames(
                          'max-w-full px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl',
                          mine
                            ? 'bg-brand-600 text-white'
                            : 'bg-ink-700 text-ink-50 border border-ink-600',
                          mine && runEnd && 'rounded-br-md',
                          !mine && runEnd && 'rounded-bl-md',
                          editingId === m.id && 'ring-2 ring-brand-400 ring-offset-2 ring-offset-ink-850',
                          mine && actionsFor === m.id && 'ring-2 ring-brand-400/50',
                        )}
                        id={`message-${m.id}`}
                        title={new Date(m.createdAt).toLocaleString()}
                        // Touch has no hover: tapping your own bubble reveals its actions.
                        onClick={
                          mine && coarse ? () => setActionsFor((id) => (id === m.id ? null : m.id)) : undefined
                        }
                      >
                        {m.replyToId && <button type="button" className="mb-2 block w-full border-l-2 border-current pl-2 text-left text-xs opacity-80 whitespace-pre-wrap"
                          onClick={() => document.getElementById(`message-${m.replyToId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
                          {messages.find((parent) => parent.id === m.replyToId)?.body ?? 'Original message unavailable'}
                        </button>}
                        {m.body}
                      </div>
                      {runEnd && (
                        <span className="mt-1 mx-1 text-[10px] tabular-nums text-ink-400">
                          {fmtTime(m.createdAt)}
                          {m.editedAt && ' · edited'}
                          {mine && m.id === lastMine?.id && showSeen && ' · Seen'}
                        </span>
                      )}
                    </div>
                  </div>
                </Fragment>
              )
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      {/* The bottom element on phones (no tab bar in a thread), so it clears the home indicator. */}
      <div className="shrink-0 border-t border-ink-600 px-3 md:px-6 pt-3 pb-3 max-md:pb-[max(0.75rem,var(--safe-bottom))]">
        <div className="max-w-3xl mx-auto">
          {editingId && (
            <div className="flex items-center gap-2 mb-2 text-[11px] text-ink-300">
              <PencilSimpleIcon size={12} aria-hidden /> Editing message
              <button
                className="pressable ml-auto p-0.5 pointer-coarse:p-2 pointer-coarse:-m-1.5 rounded-sm hover:text-ink-50"
                onClick={() => {
                  setEditingId(null)
                  setEditDraft('')
                  setSendError(null)
                }}
                aria-label="Cancel editing"
              >
                <XIcon size={12} aria-hidden />
              </button>
            </div>
          )}
          {replyToId && !editingId && <div className="mb-2 flex items-center gap-2 border-l-2 border-brand-500 pl-3 text-xs text-ink-200">
            <span className="min-w-0 flex-1 truncate">Replying to: {messages.find((m) => m.id === replyToId)?.body ?? 'Original message unavailable'}</span>
            <button type="button" className="btn-ghost" aria-label="Cancel reply" onClick={() => setReplyToId(undefined)}>Cancel</button>
          </div>}
          <div className="flex items-end gap-2 card px-3 py-2 pointer-coarse:py-1 pointer-coarse:pr-1 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/20 transition-[border-color,box-shadow] duration-150 ease-[ease]">
            <textarea
              ref={inputRef}
              rows={1}
              className="flex-1 min-w-0 resize-none placeholder-shown:whitespace-nowrap placeholder-shown:overflow-hidden bg-transparent text-sm max-md:text-base text-ink-50 placeholder:text-ink-400 outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0 py-1.5 max-h-40"
              placeholder={`Message ${title}`}
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => { setDraft(e.target.value); setSendError(null) }}
              readOnly={sending}
              onKeyDown={onKeyDown}
              aria-label="Write a message"
              // Touch keyboards' Return makes a new line here, so don't label it Send.
              enterKeyHint={coarse ? 'enter' : 'send'}
            />
            <button
              className="btn-primary h-9 w-9 pointer-coarse:size-[44px] p-0 justify-center rounded-full shrink-0"
              // Keep focus (and the phone keyboard) in the textarea when tapping Send.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => submit()}
              disabled={!draft.trim() || sending}
              aria-label={sending ? 'Sending message' : editingId ? 'Save edit' : 'Send message'}
              title={coarse ? (editingId ? 'Save' : 'Send') : editingId ? 'Save (Enter)' : 'Send (Enter)'}
            >
              {editingId ? <CheckIcon size={15} aria-hidden /> : <PaperPlaneRightIcon size={15} aria-hidden />}
            </button>
          </div>
          {sendError && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-400">{sendError}</p>}
          {/* Same signal as the Enter handler: on a touch tablet Enter is a new line. */}
          {!coarse && (
            <p className="hidden md:block mt-1.5 text-[10px] text-ink-400">
              Enter to send · Shift+Enter for a new line
            </p>
          )}
        </div>
      </div>

      <RenameGroupModal
        open={renameOpen}
        current={conversation.title ?? ''}
        onClose={closeRename}
        onSave={(title) => renameConversation(conversation.id, title)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete conversation?"
        message={`This permanently deletes the conversation with ${title} and all of its messages for everyone in it.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          deleteConversation(conversation.id)
          onBack()
        }}
        onClose={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteMsg)}
        title="Delete message?"
        message="It will be removed for everyone in this conversation."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (pendingDeleteMsg) deleteMessage(pendingDeleteMsg.id)
          if (pendingDeleteMsg?.id === editingId) {
            setEditingId(null)
            setEditDraft('')
          }
        }}
        onClose={() => setPendingDeleteMsg(null)}
      />
    </div>
  )
}
