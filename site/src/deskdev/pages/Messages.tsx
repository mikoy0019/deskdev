import { useCallback, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChatsCircleIcon, MagnifyingGlassIcon, NotePencilIcon, UsersIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import Avatar from '../components/Avatar'
import ChatThread from '../components/messages/ChatThread'
import NewChatModal from '../components/messages/NewChatModal'
import NotifyButton from '../components/messages/NotifyButton'
import SpaceStrip from '../components/channels/SpaceStrip'
import { LayoutIndicator, Skeleton, useStagger } from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { classNames, fmtRelative } from '../lib/format'
import { CHAT_RETENTION_LABEL, conversationTitle, inboxFor, lastMessageOf, totalUnread, unreadCount } from '../lib/chat'

// The raised tile an empty state's mark sits on (EmptyState's, at pane scale).
const markTile =
  'flex shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60'

/** The inbox before the first pull lands: rows shaped like conversations. */
function InboxSkeleton() {
  return (
    <div role="status" aria-busy="true" className="p-2 space-y-0.5">
      <span className="sr-only">Loading conversations</span>
      {[58, 72, 46, 64, 52, 68].map((w, i) => (
        <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
          <Skeleton w={40} h={40} rounded="full" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton w={`${w - 18}%`} h={12} />
              <Skeleton w={34} h={10} className="ml-auto" />
            </div>
            <Skeleton w={`${w}%`} h={10} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Inbox + conversation, side by side on desktop. On narrow screens the route
 * decides the pane: /messages shows the inbox, /messages/:id the thread.
 */
export default function Messages() {
  const { id: activeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const me = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const users = useStore((s) => s.users)
  const conversations = useStore((s) => s.conversations)
  const messages = useStore((s) => s.messages)
  const reads = useStore((s) => s.conversationReads)
  // First load of the inbox: rows cascade in once a session (never on search).
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('messages-inbox')

  const [query, setQuery] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const closeNew = useCallback(() => setNewOpen(false), [])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inboxFor(conversations, me?.id)
      .map((c) => ({
        conversation: c,
        title: conversationTitle(c, users, me?.id),
        last: lastMessageOf(messages, c.id),
        unread: me ? unreadCount(messages, reads, c.id, me.id) : 0,
      }))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.last?.body.toLowerCase().includes(q))
  }, [conversations, messages, reads, users, me, query])

  const unread = useMemo(
    () => totalUnread(conversations, messages, reads, me?.id),
    [conversations, messages, reads, me?.id],
  )

  // Opening a thread from the inbox marks the entry, so the thread's back
  // button can retrace it (keeping the inbox's scroll) instead of stacking a
  // new inbox on top. A deep link or notification has no inbox behind it.
  const open = (id: string) => navigate(`/messages/${id}`, { state: { fromList: true } })
  const backToInbox = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1)
    else navigate('/messages', { replace: true })
  }

  return (
    <Layout title="Messages" subtitle={unread > 0 ? `${unread.toLocaleString()} unread` : `Chat with your team · messages vanish after ${CHAT_RETENTION_LABEL}`} bare immersive={Boolean(activeId)}>
      <div className="h-full flex min-h-0">
        {/* Inbox */}
        <aside
          className={classNames(
            'w-full md:w-80 lg:w-96 shrink-0 border-r border-ink-600 flex-col min-h-0 bg-ink-850/40',
            activeId ? 'hidden md:flex' : 'flex',
          )}
          aria-label="Inbox"
        >
          {/* Phones: the Chat tab is one hub — DMs here, the studio and client channels one tap away. */}
          <SpaceStrip className="md:hidden" current="messages" />
          <div className="px-3 pt-3 pb-2.5 space-y-2 border-b border-ink-600">
            <div className="flex items-center gap-2">
              <label className="relative flex-1 min-w-0">
                <MagnifyingGlassIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden />
                <input
                  className="input pl-9 w-full pointer-coarse:min-h-11"
                  placeholder="Search messages"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search conversations"
                  enterKeyHint="search"
                />
              </label>
              <button className="btn-primary shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={() => setNewOpen(true)} title="New chat" aria-label="New chat">
                <NotePencilIcon size={15} aria-hidden />
                <span className="hidden sm:inline md:hidden lg:inline">New</span>
              </button>
            </div>
            <NotifyButton />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {!hydrated && rows.length === 0 ? (
              <InboxSkeleton />
            ) : rows.length === 0 ? (
              <div className="px-6 pt-12 pb-6 flex flex-col items-center text-center">
                <span className={classNames(markTile, 'size-11')} aria-hidden>
                  {query ? <MagnifyingGlassIcon size={20} /> : <ChatsCircleIcon size={20} />}
                </span>
                <p className="mt-3 text-sm text-ink-200 text-balance">
                  {query ? 'No conversations match your search.' : 'No conversations yet.'}
                </p>
              </div>
            ) : (
              <ul ref={attachStagger} className={classNames('p-2 space-y-0.5', staggerClass)}>
                {rows.map(({ conversation: c, title, last, unread: n }) => {
                  const active = c.id === activeId
                  const preview = last
                    ? `${last.senderId === me?.id ? 'You: ' : c.isGroup ? `${users.find((u) => u.id === last.senderId)?.fullName.split(' ')[0] ?? 'Someone'}: ` : ''}${last.body}`
                    : 'No messages yet'
                  return (
                    <li key={c.id}>
                      <button
                        className={classNames(
                          'pressable-card relative w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-left',
                          !active && 'hover:bg-ink-700/50',
                        )}
                        onClick={() => open(c.id)}
                        aria-current={active ? 'page' : undefined}
                      >
                        {/* The selection glides to the conversation you open (spatial consistency). */}
                        {active && (
                          <LayoutIndicator layoutId="inbox-active" radius={8} className="absolute inset-0 bg-brand-600/10 dark:bg-brand-500/12" />
                        )}
                        {c.isGroup ? (
                          <span className="relative size-10 rounded-full bg-ink-700 border border-ink-600 flex items-center justify-center text-ink-300 shrink-0">
                            <UsersIcon size={17} aria-hidden />
                          </span>
                        ) : (
                          <span className="relative shrink-0">
                            <Avatar name={title} size="lg" />
                          </span>
                        )}
                        <span className="relative flex-1 min-w-0">
                          <span className="flex items-baseline gap-2">
                            <span
                              className={classNames(
                                'flex-1 min-w-0 truncate text-sm',
                                n > 0 ? 'text-ink-50 font-semibold' : 'text-ink-100 font-medium',
                              )}
                            >
                              {title}
                            </span>
                            <span className={classNames('text-[10px] tabular-nums shrink-0 whitespace-nowrap', active ? 'text-ink-300' : 'text-ink-400')}>
                              {fmtRelative(last?.createdAt ?? c.lastMessageAt)}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 mt-0.5">
                            <span
                              className={classNames(
                                'flex-1 min-w-0 truncate text-xs',
                                n > 0 ? 'text-ink-100' : 'text-ink-300',
                                !last && 'italic',
                              )}
                            >
                              {preview}
                            </span>
                            {n > 0 && (
                              <span
                                className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand-600 text-white text-[10px] font-semibold tabular-nums flex items-center justify-center shrink-0"
                                aria-label={`${n} unread`}
                              >
                                {n > 99 ? '99+' : n}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Conversation */}
        <section className={classNames('flex-1 min-w-0 min-h-0', activeId ? 'flex flex-col' : 'hidden md:flex md:flex-col')}>
          {activeId ? (
            <ChatThread key={activeId} conversationId={activeId} onBack={backToInbox} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <span className={classNames(markTile, 'size-14')} aria-hidden>
                <NotePencilIcon size={24} />
              </span>
              <h2 className="mt-5 text-display text-base font-semibold text-ink-50">Your messages</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-300 max-w-xs text-pretty">
                Pick a conversation, or start a new one with anyone on the team.
              </p>
              <button className="btn-primary mt-6" onClick={() => setNewOpen(true)}>
                <NotePencilIcon size={14} aria-hidden /> New chat
              </button>
            </div>
          )}
        </section>
      </div>

      <NewChatModal open={newOpen} onClose={closeNew} onStarted={open} />
    </Layout>
  )
}
