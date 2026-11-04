import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ArrowBendUpLeftIcon, PencilSimpleIcon, PushPinIcon, PushPinSlashIcon, SmileyIcon, TrashIcon,
} from '@phosphor-icons/react'
import Avatar from '../Avatar'
import { classNames, fmtDateTime, fmtTime } from '../../lib/format'
import {
  decodeMentions, groupReactions, mentionsUser, plainPreview, QUICK_REACTIONS, MAX_CHANNEL_MESSAGE_LENGTH,
} from '../../lib/channels'
import type { ChannelMessage, ChannelReaction, User } from '../../lib/types'
import MessageBody from './MessageBody'
import EmojiPicker from './EmojiPicker'
import { Presence } from '../motion'
import { useCoarsePointer } from '../../pwa/useMediaQuery'

export interface MessageActions {
  react: (messageId: string, emoji: string) => void
  reply: (message: ChannelMessage) => void
  togglePin: (messageId: string) => void
  edit: (messageId: string, body: string) => void
  remove: (message: ChannelMessage) => void
  jumpTo: (messageId: string) => void
}

// 44px on touch: seven of them (the third quick reaction steps aside) still fit a 360px phone.
// The ring sits inside the button: the toolbar clips its children, so an offset ring showed as two stray lines.
const toolButton =
  'pressable h-8 w-8 pointer-coarse:size-[44px] flex items-center justify-center rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700 focus-visible:ring-inset focus-visible:ring-offset-0'

/** Taps on these keep their own meaning instead of selecting the row. */
const INTERACTIVE = 'a, button, input, textarea, select, label, [role="button"], [contenteditable="true"]'

/**
 * One line in a channel, Discord "cozy" style: a group header (avatar, name,
 * time) when a new burst starts, otherwise a compact continuation. A hover
 * toolbar carries react / reply / pin / edit / delete; on touch screens, which
 * have no hover, tapping the row selects it and shows the same toolbar.
 */
function ChannelMessageRow({
  message,
  parent,
  groupStart,
  users,
  me,
  reactions,
  canManage,
  canReply,
  highlighted,
  selected,
  onSelect,
  editing,
  onStartEdit,
  onStopEdit,
  actions,
}: {
  message: ChannelMessage
  /** The replied-to message, when it still exists. */
  parent: ChannelMessage | undefined
  groupStart: boolean
  users: User[]
  me: User
  reactions: ChannelReaction[]
  canManage: boolean
  canReply: boolean
  highlighted: boolean
  /** Touch: this row's toolbar is showing. */
  selected: boolean
  /** Touch: select this row (its id) or clear the selection (null). */
  onSelect: (id: string | null) => void
  editing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  actions: MessageActions
}) {
  const [picker, setPicker] = useState(false)
  const sender = users.find((u) => u.id === message.senderId)
  const senderName = sender?.fullName ?? 'Former member'
  const mine = message.senderId === me.id
  const mentioned = !mine && mentionsUser(message.body, me.id)
  const groups = groupReactions(reactions, message.id, me.id)
  const showHeader = groupStart || Boolean(message.replyToId)
  const coarse = useCoarsePointer()

  const onRowClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!coarse || editing) return
    // Links, mentions, reaction chips and the toolbar itself act on their own.
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return
    // A long-press text selection isn't a tap.
    if (window.getSelection()?.toString()) return
    onSelect(selected ? null : message.id)
  }

  return (
    <div
      id={`msg-${message.id}`}
      data-item-kind="channel message" data-item-id={message.id} data-item-label={message.body.slice(0, 120)}
      className={classNames(
        'group relative pl-16 pr-4 md:pr-12 py-0.5 border-l-2 transition-colors duration-200 ease-[ease]',
        showHeader && 'mt-4',
        highlighted
          ? 'bg-brand-600/15 border-brand-500'
          : selected
            ? 'bg-ink-800/70 border-transparent'
          : mentioned
            ? 'bg-amber-500/10 border-amber-500 hover:bg-amber-500/15'
            : 'border-transparent hover:bg-ink-800/70',
      )}
      onClick={onRowClick}
    >
      {/* Reply quote */}
      {message.replyToId !== undefined && (
        <button
          type="button"
          // Under a finger the one-line quote reaches 44px without moving the lines around it.
          className="relative flex items-center gap-1.5 mb-0.5 pointer-coarse:py-2.5 pointer-coarse:-mt-2.5 pointer-coarse:-mb-2 max-w-full text-left text-xs text-ink-300 hover:text-ink-100 before:content-[''] before:absolute before:-left-9 before:top-1/2 before:w-8 before:h-3 before:border-l-2 before:border-t-2 before:border-ink-500 before:rounded-tl-md"
          onClick={() => parent && actions.jumpTo(parent.id)}
          disabled={!parent}
        >
          {parent ? (
            <>
              <Avatar name={users.find((u) => u.id === parent.senderId)?.fullName ?? '?'} size="sm" />
              <span className="font-medium text-ink-100 shrink-0">
                @{users.find((u) => u.id === parent.senderId)?.fullName ?? 'Former member'}
              </span>
              <span className="truncate">{plainPreview(parent.body, users, 90)}</span>
            </>
          ) : (
            <span className="italic">Original message was deleted</span>
          )}
        </button>
      )}

      {showHeader ? (
        <>
          <span className="absolute left-4 mt-0.5">
            <Avatar name={senderName} size="lg" />
          </span>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink-50">{senderName}</span>
            {sender?.role === 'admin' && (
              <span className="badge badge-brand py-0 text-[10px] uppercase tracking-wider">Admin</span>
            )}
            <time className="text-[11px] tabular-nums text-ink-400" dateTime={message.createdAt} title={fmtDateTime(message.createdAt)}>
              {fmtTime(message.createdAt)}
            </time>
            {message.pinnedAt && <PushPinIcon size={11} className="text-ink-400 self-center" aria-label="Pinned" />}
          </div>
        </>
      ) : (
        <time
          className="absolute left-0 w-16 text-center top-1.5 text-[10px] tabular-nums text-ink-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-[ease]"
          dateTime={message.createdAt}
          title={fmtDateTime(message.createdAt)}
        >
          {fmtTime(message.createdAt)}
        </time>
      )}

      {editing ? (
        <InlineEditor
          initial={decodeMentions(message.body, users)}
          onSave={(body) => {
            actions.edit(message.id, body)
            onStopEdit()
          }}
          onCancel={onStopEdit}
        />
      ) : (
        <div className="text-sm leading-relaxed text-ink-100 whitespace-pre-wrap wrap-break-word">
          <MessageBody body={message.body} users={users} meId={me.id} />
          {message.editedAt && (
            <span className="ml-1 text-[10px] text-ink-400" title={fmtDateTime(message.editedAt)}>
              (edited)
            </span>
          )}
          {!showHeader && message.pinnedAt && <PushPinIcon size={11} className="inline ml-1 text-ink-400" aria-label="Pinned" />}
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {groups.map((g) => {
            const names = g.userIds.map((id) => users.find((u) => u.id === id)?.fullName ?? 'Someone')
            return (
              <button
                key={g.emoji}
                type="button"
                onClick={() => actions.react(message.id, g.emoji)}
                className={classNames(
                  // Under a finger the 32px chip's hit area reaches 44px (the ::after), without a taller row.
                  'pressable relative h-6 pointer-coarse:h-8 px-1.5 inline-flex items-center gap-1 rounded-md border text-xs tabular-nums',
                  "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 pointer-coarse:after:content-['']",
                  g.mine
                    ? 'bg-brand-600/15 border-brand-500/60 text-brand-600 dark:text-brand-300'
                    : 'bg-ink-800 border-ink-600 text-ink-200 hover:border-ink-500',
                )}
                aria-pressed={g.mine}
                title={`${names.join(', ')} reacted with ${g.emoji}`}
              >
                <span className="text-sm leading-none">{g.emoji}</span>
                {g.count}
              </button>
            )
          })}
          <button
            type="button"
            className="pressable relative h-6 w-7 pointer-coarse:h-8 pointer-coarse:w-11 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 pointer-coarse:after:content-[''] inline-flex items-center justify-center rounded-md border border-transparent text-ink-400 hover:text-ink-100 hover:border-ink-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            onClick={() => setPicker(true)}
            aria-label="Add reaction"
          >
            <SmileyIcon size={14} aria-hidden />
          </button>
        </div>
      )}

      {/* Hover toolbar */}
      {!editing && (
        <div
          className={classNames(
            // Touch: above the row, so the 44px buttons don't cover the message they act on.
            'absolute right-4 -top-6 pointer-coarse:-top-12 z-10 flex items-center card overflow-hidden transition-opacity duration-150 ease-[ease]',
            // One branch or the other, never both: with the two pointer-events
            // classes side by side the later rule (none) won, and a tapped
            // row's toolbar showed but let every tap fall through.
            picker || selected
              ? 'opacity-100 pointer-events-auto'
              // Keyboard focus reveals it; a mouse click inside must not pin it open.
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto has-focus-visible:opacity-100 has-focus-visible:pointer-events-auto',
          )}
          style={{ boxShadow: 'var(--shadow-2)' }}
          role="toolbar"
          aria-label="Message actions"
        >
          {QUICK_REACTIONS.slice(0, 3).map((e, i) => (
            <button
              key={e}
              type="button"
              className={classNames(toolButton, i === 2 && 'pointer-coarse:hidden')}
              onClick={() => actions.react(message.id, e)}
              aria-label={`React ${e}`}
            >
              <span className="text-base leading-none">{e}</span>
            </button>
          ))}
          <button type="button" className={toolButton} onClick={() => setPicker((p) => !p)} aria-label="Add reaction" title="Add reaction">
            <SmileyIcon size={15} aria-hidden />
          </button>
          {canReply && (
            <button type="button" className={toolButton} onClick={() => actions.reply(message)} aria-label="Reply" title="Reply">
              <ArrowBendUpLeftIcon size={15} aria-hidden />
            </button>
          )}
          {canManage && (
            <button
              type="button"
              className={toolButton}
              onClick={() => actions.togglePin(message.id)}
              aria-label={message.pinnedAt ? 'Unpin message' : 'Pin message'}
              title={message.pinnedAt ? 'Unpin' : 'Pin'}
            >
              {message.pinnedAt ? <PushPinSlashIcon size={15} aria-hidden /> : <PushPinIcon size={15} aria-hidden />}
            </button>
          )}
          {mine && (
            <button type="button" className={toolButton} onClick={onStartEdit} aria-label="Edit message" title="Edit">
              <PencilSimpleIcon size={14} aria-hidden />
            </button>
          )}
          {(mine || canManage) && (
            <button
              type="button"
              className={classNames(toolButton, 'hover:text-rose-600! dark:hover:text-rose-400!')}
              onClick={() => actions.remove(message)}
              aria-label="Delete message"
              title="Delete"
            >
              <TrashIcon size={14} aria-hidden />
            </button>
          )}
        </div>
      )}

      <Presence>
        {picker && (
          <EmojiPicker
            key="picker"
            placement="bottom-end"
            className="absolute right-4 top-6 pointer-coarse:top-8"
            onPick={(e) => {
              actions.react(message.id, e)
              setPicker(false)
            }}
            onClose={() => setPicker(false)}
          />
        )}
      </Presence>
    </div>
  )
}

function InlineEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const coarse = useCoarsePointer()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarse) {
      // Phone keyboards have no Shift+Enter, so there Return stays a new line.
      e.preventDefault()
      if (value.trim()) onSave(value)
    }
  }

  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        rows={1}
        className="input w-full resize-none"
        value={value}
        maxLength={MAX_CHANNEL_MESSAGE_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Edit message"
      />
      {coarse ? (
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-ghost min-h-[44px]" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary min-h-[44px]" onClick={() => value.trim() && onSave(value)} disabled={!value.trim()}>
            Save
          </button>
        </div>
      ) : (
      <p className="mt-1 text-[11px] text-ink-300">
        escape to{' '}
        <button type="button" className="text-brand-600 dark:text-brand-400 hover:underline" onClick={onCancel}>
          cancel
        </button>{' '}
        · enter to{' '}
        <button
          type="button"
          className="text-brand-600 dark:text-brand-400 hover:underline"
          onClick={() => value.trim() && onSave(value)}
        >
          save
        </button>
      </p>
      )}
    </div>
  )
}

export default memo(ChannelMessageRow)
