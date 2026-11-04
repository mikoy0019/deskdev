import { useId, useMemo, useState } from 'react'
import { CheckIcon, HashIcon, LockIcon, MagnifyingGlassIcon, MegaphoneIcon, TrashIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import ConfirmDialog from '../ConfirmDialog'
import { useStore, useCurrentUser } from '../../store/useStore'
import { classNames } from '../../lib/format'
import {
  isValidChannelName, MAX_CHANNEL_NAME_LENGTH, MAX_CHANNEL_TOPIC_LENGTH, slugifyChannelName, spaceOf, STUDIO_SPACE,
} from '../../lib/channels'
import type { Channel, ChannelKind } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'
import { Switch } from '../settings/formKit'

const KINDS: { kind: ChannelKind; label: string; hint: string; icon: typeof HashIcon }[] = [
  { kind: 'text', label: 'Text', hint: 'Everyone in the channel can post.', icon: HashIcon },
  { kind: 'announcement', label: 'Announcement', hint: 'Only admins and the channel owner post; others read and react.', icon: MegaphoneIcon },
]

/** Create a channel, or edit one (`channel` set) — name, topic, category, type, privacy, members. */
export default function ChannelFormModal({
  open,
  onClose,
  channel,
  clientId,
  defaultCategoryId,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onClose: () => void
  channel?: Channel
  /** The space a new channel is created in (a client id, or unset for the studio). */
  clientId?: string
  defaultCategoryId?: string
  onSaved?: (channelId: string) => void
  onDeleted?: () => void
}) {
  const me = useCurrentUser()
  const users = useStore((s) => s.users)
  const clients = useStore((s) => s.clients)
  const allCategories = useStore((s) => s.channelCategories)
  const channels = useStore((s) => s.channels)
  // A channel never changes space; a new one is born into the open space.
  const space = channel ? channel.clientId : clientId
  const spaceName = space ? clients.find((c) => c.id === space)?.name ?? 'this client' : 'DeskDev Studio'
  const categories = useMemo(() => allCategories.filter((c) => c.clientId === space), [allCategories, space])
  const createChannel = useStore((s) => s.createChannel)
  const updateChannel = useStore((s) => s.updateChannel)
  const deleteChannel = useStore((s) => s.deleteChannel)

  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [kind, setKind] = useState<ChannelKind>('text')
  const [categoryId, setCategoryId] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset from the channel (edit) or defaults (create) every time it opens.
  useResetOnChange([open, channel, defaultCategoryId], () => {
    if (!open) return
    setName(channel?.name ?? '')
    setTopic(channel?.topic ?? '')
    setKind(channel?.kind ?? 'text')
    setCategoryId(channel ? channel.categoryId ?? '' : defaultCategoryId ?? '')
    setIsPrivate(channel?.isPrivate ?? false)
    setMemberIds(channel?.memberIds ?? [])
    setQuery('')
  })

  const slug = slugifyChannelName(name)
  const valid = isValidChannelName(slug)
  // Two channels with one name in the same space are two identical rows in the list.
  const taken = valid && channels.some(
    (c) => c.id !== channel?.id && spaceOf(c) === (space ?? STUDIO_SPACE) && c.name === slug,
  )
  // Inline, under the field: only once something was typed that can't become a name.
  const nameError = (name.trim() !== '' && !valid) || taken
  const nameHintId = useId()
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories],
  )
  const people = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users
      .filter((u) => u.id !== me?.id)
      .filter((u) => !q || u.fullName.toLowerCase().includes(q) || u.title?.toLowerCase().includes(q))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [users, me?.id, query])

  const toggleMember = (id: string) =>
    setMemberIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const save = () => {
    if (!valid || taken) return
    const input = {
      name: slug,
      clientId: space,
      topic,
      kind,
      categoryId: categoryId || undefined,
      isPrivate,
      memberIds,
    }
    if (channel) {
      updateChannel(channel.id, input)
      onSaved?.(channel.id)
      onClose()
      return
    }
    const id = createChannel(input)
    if (!id) return
    onSaved?.(id)
    onClose()
  }

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        onClose={onClose}
        title={channel ? `Edit #${channel.name}` : `Create channel in ${spaceName}`}
        wide
        onSubmit={save}
        footer={
          <>
            {channel && (
              // A phone footer has room for three labels on one line only if this one is an icon.
              <button className="btn-ghost mr-auto whitespace-nowrap text-rose-600 dark:text-rose-400 max-sm:px-3" onClick={() => setConfirmDelete(true)} title="Delete channel">
                <TrashIcon size={15} aria-hidden /> <span className="max-sm:sr-only">Delete channel</span>
              </button>
            )}
            <button type="button" className="btn-ghost whitespace-nowrap" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary whitespace-nowrap" disabled={!valid || taken}>
              {channel ? 'Save changes' : 'Create channel'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <fieldset>
            <legend className="block text-xs font-medium text-ink-200 mb-1.5">Channel type</legend>
            <div className="grid sm:grid-cols-2 gap-2" role="radiogroup">
              {KINDS.map(({ kind: k, label, hint, icon: Icon }) => {
                const on = kind === k
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setKind(k)}
                    className={classNames(
                      'pressable-card flex items-start gap-3 p-3 text-left border rounded-md',
                      on ? 'border-brand-500 bg-brand-600/10' : 'border-ink-600 hover:bg-ink-700/60',
                    )}
                  >
                    <Icon size={18} weight={on ? 'fill' : 'regular'} className={on ? 'shrink-0 text-brand-600 dark:text-brand-400 mt-0.5' : 'shrink-0 text-ink-300 mt-0.5'} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink-50">{label}</span>
                      <span className="block text-xs text-ink-300 mt-0.5">{hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <label className="block">
            <span className="block text-xs font-medium text-ink-200">Channel name</span>
            <span className="relative mt-1.5 block">
              <HashIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden />
              <input
                className={classNames('input pl-8 w-full', nameError && 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20')}
                value={name}
                aria-invalid={nameError || undefined}
                aria-describedby={nameHintId}
                maxLength={MAX_CHANNEL_NAME_LENGTH + 10}
                placeholder="new-channel"
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </span>
            <span id={nameHintId} className={classNames('mt-1.5 block text-[11px]', nameError ? 'text-rose-600 dark:text-rose-400' : 'text-ink-300')}>
              {taken ? (
                'A channel with this name already exists.'
              ) : nameError ? (
                'Use at least one letter or number in the name.'
              ) : name && slug !== name ? (
                <>Will be created as <span className="font-mono text-ink-100">#{slug || '…'}</span></>
              ) : (
                'Lowercase letters, numbers, dashes and underscores.'
              )}
            </span>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-ink-200">Topic <span className="font-normal text-ink-300">(optional)</span></span>
            <input
              className="input mt-1.5 w-full"
              value={topic}
              maxLength={MAX_CHANNEL_TOPIC_LENGTH}
              placeholder="What is this channel about?"
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-ink-200">Category</span>
            <select className="input mt-1.5 w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {sortedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="card p-3">
            <div className="flex items-center gap-3">
              <LockIcon size={16} className="text-ink-300 shrink-0" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink-50">Private channel</div>
                <div className="text-xs text-ink-300">Only the people you pick (and admins) can see it.</div>
              </div>
              <Switch on={isPrivate} onChange={setIsPrivate} label="Private channel" />
            </div>

            {isPrivate && (
              <div className="mt-3 space-y-2 animate-fade">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-200">Members</span>
                  <span className="text-[11px] text-ink-300 tabular-nums">{memberIds.filter((id) => id !== me?.id).length} selected + you</span>
                </div>
                <label className="relative block">
                  <MagnifyingGlassIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden />
                  <input
                    className="input pl-9 w-full"
                    placeholder="Search people"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search people"
                  />
                </label>
                <div className="border border-ink-600 rounded-md divide-y divide-ink-600 max-h-56 overflow-y-auto overscroll-contain" role="listbox" aria-multiselectable aria-label="Members">
                  {people.length === 0 ? (
                    <p className="p-4 text-sm text-ink-300 text-center [overflow-wrap:anywhere]">No one matches “{query}”.</p>
                  ) : (
                    people.map((u) => {
                      const on = memberIds.includes(u.id)
                      return (
                        <button
                          key={u.id}
                          type="button"
                          role="option"
                          aria-selected={on}
                          className={classNames(
                            'pressable-card w-full flex items-center gap-3 px-3 py-2 pointer-coarse:min-h-11 text-left',
                            on ? 'bg-brand-600/10' : 'hover:bg-ink-700/60',
                          )}
                          onClick={() => toggleMember(u.id)}
                        >
                          <Avatar name={u.fullName} size="sm" />
                          <span className="flex-1 min-w-0 text-sm text-ink-50 truncate">{u.fullName}</span>
                          <span className="text-[11px] text-ink-300 capitalize">{u.role}</span>
                          <span
                            className={classNames(
                              'w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors duration-150',
                              on ? 'bg-brand-600 border-brand-600 text-white' : 'border-ink-500',
                            )}
                            aria-hidden
                          >
                            {on && <CheckIcon size={12} aria-hidden />}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {channel && (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete #${channel.name}?`}
          message="Every message, pin and reaction in this channel is permanently deleted for everyone."
          confirmLabel="Delete channel"
          danger
          onConfirm={() => {
            deleteChannel(channel.id)
            onClose()
            onDeleted?.()
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
