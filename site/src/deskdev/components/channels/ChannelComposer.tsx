import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AtIcon, MegaphoneIcon, PaperPlaneRightIcon, SmileyIcon, XIcon } from '@phosphor-icons/react'
import Avatar from '../Avatar'
import EmojiPicker from './EmojiPicker'
import { Presence } from '../motion'
import { classNames } from '../../lib/format'
import { MAX_CHANNEL_MESSAGE_LENGTH, mentionQueryAt, plainPreview } from '../../lib/channels'
import type { Channel, ChannelMessage, User } from '../../lib/types'
import { useCoarsePointer } from '../../pwa/useMediaQuery'
import { useCurrentUser } from '../../store/useStore'
import { useMessageDraft } from '../messages/useMessageDraft'
import { encodeMentions } from '../../lib/channels'

export interface ComposerHandle {
  focus: () => void
}

type Suggestion =
  | { kind: 'user'; user: User }
  | { kind: 'room'; token: '@everyone' | '@here'; hint: string }

/**
 * Channel message box: auto-growing textarea, @mention autocomplete, emoji
 * picker, reply banner. Up-arrow on an empty box edits your last message.
 */
const ChannelComposer = forwardRef<ComposerHandle, {
  channel: Channel
  canPost: boolean
  members: User[]
  users: User[]
  replyTo: ChannelMessage | null
  onCancelReply: () => void
  onSend: (body: string) => Promise<string | null>
  onEditLast: () => void
}>(function ChannelComposer({ channel, canPost, members, users, replyTo, onCancelReply, onSend, onEditLast }, ref) {
  const me = useCurrentUser()
  const [draft, setDraft] = useMessageDraft('channel', channel.id, me?.id)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  // Touch: no autofocus (the keyboard would cover the room on arrival) and no
  // Enter-to-send (phone keyboards have no Shift+Enter for a new line).
  const coarse = useCoarsePointer()
  // Caret to restore after a programmatic insert. Applied in the same layout
  // pass as the new text, so keys typed right after a pick land in order.
  const pendingCaret = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), [])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    if (pendingCaret.current !== null) {
      el.focus()
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }, [draft])

  const mention = mentionQueryAt(draft, caret)
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!mention || mention.start === dismissedAt) return []
    const q = mention.query.toLowerCase()
    const people: Suggestion[] = members
      .filter((u) => u.fullName.toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) || u.fullName.toLowerCase().startsWith(q))
      .slice(0, 8)
      .map((user) => ({ kind: 'user', user }))
    const room: Suggestion[] = (
      [
        { kind: 'room', token: '@everyone', hint: 'Notify everyone in this channel' },
        { kind: 'room', token: '@here', hint: 'Everyone who is around' },
      ] as const
    ).filter((r) => r.token.slice(1).startsWith(q))
    return [...people, ...room]
  }, [mention, members, dismissedAt])

  const insertAt = (start: number, end: number, text: string) => {
    const next = draft.slice(0, start) + text + draft.slice(end)
    if (next.length > MAX_CHANNEL_MESSAGE_LENGTH) {
      setSendError(`Messages can contain up to ${MAX_CHANNEL_MESSAGE_LENGTH} characters.`)
      return
    }
    const pos = start + text.length
    pendingCaret.current = pos
    setDraft(next)
    setCaret(pos)
  }

  const pick = (s: Suggestion) => {
    if (!mention) return
    const token = s.kind === 'user' ? `@${s.user.fullName}` : s.token
    insertAt(mention.start, caret, `${token} `)
    setActive(0)
  }

  const submit = async () => {
    const body = draft.trim()
    if (!body || !canPost || sendingRef.current) return
    if (encodeMentions(body, members).length > MAX_CHANNEL_MESSAGE_LENGTH) {
      setSendError('This message is too long after adding mentions. Shorten it and try again.')
      return
    }
    sendingRef.current = true
    setSending(true)
    try {
    if (!await onSend(body)) {
      setSendError('Message could not be sent. Check that the channel and reply are still available, then try again.')
      return
    }
    setSendError(null)
    setDraft('')
    setCaret(0)
    setDismissedAt(null)
    } catch {
      setSendError('Message could not be sent. Check your connection and try again.')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((a) => (a + step + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(suggestions[Math.min(active, suggestions.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissedAt(mention?.start ?? null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarse) {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowUp' && !draft) {
      e.preventDefault()
      onEditLast()
    } else if (e.key === 'Escape' && replyTo) {
      onCancelReply()
    }
  }

  if (!canPost) {
    return (
      <div className="shrink-0 px-4 pb-4 max-md:pb-[max(1rem,var(--safe-bottom))]">
        <div className="card px-4 py-3 flex items-center gap-2.5 text-sm text-ink-300">
          <MegaphoneIcon size={16} className="text-ink-400 shrink-0" aria-hidden />
          Only admins and the channel owner can post in this announcement channel. You can still react.
        </div>
      </div>
    )
  }

  const replySender = replyTo && users.find((u) => u.id === replyTo.senderId)

  return (
    // The bottom element on phones (no tab bar in a room), so it clears the home indicator.
    <div className="shrink-0 px-4 pb-4 max-md:px-3 max-md:pb-[max(0.75rem,var(--safe-bottom))] relative">
      {suggestions.length > 0 && (
        <div
          // No entrance: it follows your typing (keyboard-initiated), so it appears at once.
          className="absolute left-4 right-4 bottom-full mb-1 card py-1 z-20 max-h-72 overflow-y-auto overscroll-contain"
          style={{ boxShadow: 'var(--shadow-3)' }}
          id={listId}
          role="listbox"
          aria-label="Mention suggestions"
        >
          <div className="px-3 pt-1 pb-1.5 section-title text-[10px]">Members</div>
          {suggestions.map((s, i) => (
            <button
              key={s.kind === 'user' ? s.user.id : s.token}
              type="button"
              role="option"
              aria-selected={i === active}
              className={classNames(
                'w-full flex items-center gap-2.5 px-3 py-1.5 pointer-coarse:min-h-11 text-left text-sm',
                i === active ? 'bg-brand-600/10 text-ink-50' : 'text-ink-100 hover:bg-ink-700/60',
              )}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
            >
              {s.kind === 'user' ? (
                <>
                  <Avatar name={s.user.fullName} size="sm" />
                  <span className="flex-1 min-w-0 truncate">{s.user.fullName}</span>
                  <span className="max-w-[45%] text-[11px] text-ink-300 truncate">{s.user.title || s.user.role}</span>
                </>
              ) : (
                <>
                  <span className="size-6 shrink-0 rounded-full bg-ink-700 flex items-center justify-center text-ink-300">
                    <AtIcon size={12} aria-hidden />
                  </span>
                  <span className="flex-1 min-w-0 font-medium">{s.token}</span>
                  <span className="min-w-0 text-[11px] text-ink-300 truncate">{s.hint}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* One focus outline around the reply banner and the box together, as one field. */}
      <div className="group/composer rounded-lg transition-[box-shadow] duration-150 ease-[ease] focus-within:ring-3 focus-within:ring-brand-500/20">
        {replyTo && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-300 bg-ink-800 border border-b-0 border-ink-600 rounded-t-lg animate-fade transition-[border-color] duration-150 ease-[ease] group-focus-within/composer:border-brand-500">
            <span className="shrink min-w-0 max-w-[60%] truncate">
              Replying to <span className="font-semibold text-ink-100">{replySender?.fullName ?? 'Former member'}</span>
            </span>
            <span className="flex-1 min-w-0 truncate text-ink-400">{plainPreview(replyTo.body, users, 80)}</span>
            <button
              type="button"
              className="pressable shrink-0 ml-auto p-0.5 pointer-coarse:p-2 pointer-coarse:-m-1.5 rounded-sm text-ink-300 hover:text-ink-50"
              onClick={onCancelReply}
              aria-label="Cancel reply"
            >
              <XIcon size={13} aria-hidden />
            </button>
          </div>
        )}

        <div
          className={classNames(
            'flex items-end gap-1 card px-2 py-1.5 pointer-coarse:p-0.5 transition-[border-color] duration-150 ease-[ease] group-focus-within/composer:border-brand-500',
            replyTo && 'rounded-t-none',
          )}
        >
          <div className="relative">
            <button
              type="button"
              className={classNames(
                'pressable h-9 w-9 pointer-coarse:size-[44px] flex items-center justify-center rounded-lg text-ink-300 hover:text-ink-50 hover:bg-ink-700',
                picker && 'bg-ink-700 text-ink-50',
              )}
              onClick={() => setPicker((p) => !p)}
              aria-label="Insert emoji"
              aria-haspopup="dialog"
              aria-expanded={picker}
              title="Emoji"
            >
              <SmileyIcon size={18} aria-hidden />
            </button>
            <Presence>
              {picker && (
                <EmojiPicker
                  key="picker"
                  placement="top-start"
                  className="absolute left-0 bottom-full mb-2"
                  onPick={(e) => {
                    const el = inputRef.current
                    const start = el?.selectionStart ?? draft.length
                    const end = el?.selectionEnd ?? draft.length
                    insertAt(start, end, e)
                    setPicker(false)
                  }}
                  onClose={() => setPicker(false)}
                />
              )}
            </Presence>
          </div>
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 min-w-0 resize-none placeholder-shown:whitespace-nowrap placeholder-shown:overflow-hidden bg-transparent text-sm max-md:text-base text-ink-50 placeholder:text-ink-400 outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0 py-2 pointer-coarse:py-2.5 max-h-[200px]"
            placeholder={`Message #${channel.name}`}
            value={draft}
            maxLength={MAX_CHANNEL_MESSAGE_LENGTH}
            disabled={sending}
            onChange={(e) => {
              setDraft(e.target.value)
              setCaret(e.target.selectionStart)
              setActive(0)
              setSendError(null)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            aria-label={`Message #${channel.name}`}
            aria-autocomplete="list"
            aria-controls={suggestions.length > 0 ? listId : undefined}
            autoFocus={!coarse}
            // Touch keyboards' Return makes a new line here, so don't label it Send.
            enterKeyHint={coarse ? 'enter' : 'send'}
          />
          <button
            type="button"
            className="btn-primary h-9 w-9 pointer-coarse:size-[44px] p-0 justify-center rounded-full shrink-0"
            // Keep focus (and the phone keyboard) in the textarea when tapping Send.
            onMouseDown={(e) => e.preventDefault()}
            onClick={submit}
            disabled={!draft.trim() || sending}
            aria-label={sending ? 'Sending message' : 'Send message'}
            title={coarse ? 'Send' : 'Send (Enter)'}
          >
            <PaperPlaneRightIcon size={15} aria-hidden />
          </button>
        </div>
      </div>
      {sendError && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-400">{sendError}</p>}
      {/* Same signal as the Enter handler: on a touch tablet Enter is a new line. */}
      <p className="hidden md:block mt-1.5 text-[10px] text-ink-400">
        {coarse ? '@ to mention' : 'Enter to send · Shift+Enter for a new line · @ to mention · ↑ to edit your last message'}
      </p>
    </div>
  )
})

export default ChannelComposer
