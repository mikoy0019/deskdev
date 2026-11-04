import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircleIcon, CircleNotchIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { Field, FieldError } from '../tasks/formBits'
import { useHeld } from './useHeld'
import { useStore } from '../../store/useStore'
import { parseVideoUrl, SUPPORTED_VIDEO_HINT } from '../../lib/videoEmbed'
import { fetchVideoMeta, looksLikeUrl, type VideoMeta } from '../../lib/videoOembed'
import { useResetOnChange } from '../../lib/useResetOnChange'
import type { CourseTopic } from '../../lib/types'
import { classNames } from '../../lib/format'

export type TopicModalState =
  /** `kind` picks the form's lead field: a video link, or a written note. */
  | { mode: 'new'; moduleId: string; kind?: 'video' | 'note' }
  | { mode: 'edit'; topic: CourseTopic }
  | null

/** Longest note the database keeps (055). */
const MAX_NOTES = 100_000

/**
 * The link to look up when a topic opens: one saved before titles were
 * auto-filled — its "title" is just the pasted URL — or with a link but no
 * cached poster. Null when there is nothing to heal.
 */
function healUrl(topic: CourseTopic | null): string | null {
  const url = topic?.sopVideoUrl ?? ''
  const title = topic?.title ?? ''
  if (!url) return null
  if (!title.trim() || looksLikeUrl(title) || !topic?.sopThumbnailUrl) {
    return parseVideoUrl(url.trim()) ? url.trim() : null
  }
  return null
}

/**
 * Add/edit a topic in one step: paste the video link and the title + poster
 * are pulled from the provider automatically. The title stays editable so a
 * failed lookup (private video, offline) is still recoverable by hand.
 *
 * A topic can also be a written note (revision 5): the note form leads with
 * the title and the note, and keeps the video link as an optional extra.
 */
export default function TopicModal({
  state,
  onClose,
}: {
  state: TopicModalState
  onClose: () => void
}) {
  const addCourseTopic = useStore((s) => s.addCourseTopic)
  const updateCourseTopic = useStore((s) => s.updateCourseTopic)

  const [videoUrl, setVideoUrl] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [notes, setNotes] = useState('')
  const [thumbnail, setThumbnail] = useState<string | undefined>(undefined)
  const [looking, setLooking] = useState(false)
  const [errors, setErrors] = useState<{ url?: string; title?: string; notes?: string }>({})
  const urlRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  // Abort an in-flight lookup when the link changes again or the modal closes
  // or switches topic, so a slow response can't overwrite a newer one — or
  // land on a different topic's form.
  const lookupRef = useRef<AbortController | null>(null)
  // The lookup in flight, for a save that arrives before it has answered.
  const pendingRef = useRef<{ controller: AbortController; meta: Promise<VideoMeta | null> } | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const existing = state?.mode === 'edit' ? state.topic : null
  // The dialog title holds while it leaves.
  const held = useHeld(state)
  // A note topic: asked for as one, or one saved with a note and no video.
  const noteFirst = held?.mode === 'new'
    ? held.kind === 'note'
    : Boolean(held?.topic.notes?.trim()) && !held?.topic.sopVideoUrl

  // Re-seed the form each time the modal opens (or switches topic).
  useResetOnChange([state], () => {
    if (!state) return
    setVideoUrl(existing?.sopVideoUrl ?? '')
    setTitle(existing?.title ?? '')
    setSummary(existing?.summary ?? '')
    setNotes(existing?.notes ?? '')
    setThumbnail(existing?.sopThumbnailUrl)
    setLooking(Boolean(healUrl(existing)))
    setErrors({})
    setSaving(false)
    savingRef.current = false
  })

  /**
   * Look the link up and fill in what the user hasn't written themselves. An
   * existing hand-typed title is preserved; a blank one, or one that is just
   * the pasted URL, is replaced. `looking` is already true when this starts.
   */
  const fillFromLink = useCallback((url: string, controller: AbortController) => {
    const pending = fetchVideoMeta(url, controller.signal)
    pendingRef.current = { controller, meta: pending }
    void pending.then((meta) => {
      if (controller.signal.aborted) return
      setLooking(false)

      if (!meta) {
        // Not an error — the provider just has no oEmbed (Drive, direct file)
        // or the video is private. The user names it themselves.
        return
      }
      if (meta.thumbnail) setThumbnail(meta.thumbnail)
      if (meta.title) {
        setTitle((current) => (!current.trim() || looksLikeUrl(current) ? meta.title! : current))
        setErrors((x) => (x.title ? { ...x, title: undefined } : x))
      }
    })
  }, [])

  // Opening (or switching topic, or closing) drops the previous topic's lookup,
  // then heals a topic saved before titles were auto-filled.
  useEffect(() => {
    lookupRef.current?.abort()
    lookupRef.current = null
    const url = state ? healUrl(state.mode === 'edit' ? state.topic : null) : null
    if (!url) return
    const controller = new AbortController()
    lookupRef.current = controller
    fillFromLink(url, controller)
  }, [state, fillFromLink])

  useEffect(() => () => lookupRef.current?.abort(), [])

  const embed = videoUrl.trim() ? parseVideoUrl(videoUrl) : null

  const lookup = (raw: string) => {
    const url = raw.trim()
    lookupRef.current?.abort()
    lookupRef.current = null
    if (!url || !parseVideoUrl(url)) {
      // The aborted lookup will never clear the spinner itself.
      setLooking(false)
      return
    }
    const controller = new AbortController()
    lookupRef.current = controller
    setLooking(true)
    fillFromLink(url, controller)
  }

  const onUrlChange = (value: string) => {
    setVideoUrl(value)
    if (errors.url) setErrors((x) => ({ ...x, url: undefined }))
    if (parseVideoUrl(value)) {
      lookup(value)
      return
    }
    // Cleared or not a video link: a lookup for the old link must not refill
    // the poster or title.
    lookupRef.current?.abort()
    lookupRef.current = null
    setLooking(false)
    if (!value.trim()) setThumbnail(undefined)
  }

  const save = async () => {
    if (savingRef.current) return
    const url = videoUrl.trim()
    if (url && !parseVideoUrl(url)) {
      setErrors({ url: `That link can't be embedded. Use ${SUPPORTED_VIDEO_HINT}.` })
      urlRef.current?.focus()
      return
    }
    let t = title.trim()
    let poster = thumbnail
    // Add pressed while the link is still being read: wait for the answer
    // instead of refusing with "Give the topic a title" a moment before the
    // title fills itself in.
    const pending = pendingRef.current
    if (!t && looking && pending && !pending.controller.signal.aborted) {
      savingRef.current = true
      setSaving(true)
      const meta = await pending.meta
      savingRef.current = false
      setSaving(false)
      // Closed, or the link changed, while waiting: that save is void.
      if (pending.controller.signal.aborted) return
      // A title typed during the wait wins over the provider's.
      t = titleRef.current?.value.trim() || meta?.title?.trim() || ''
      poster = meta?.thumbnail ?? poster
    }
    if (!t) {
      setErrors({ title: noteFirst ? 'Give the note a title' : 'Give the topic a title, or paste a link to fill it in' })
      titleRef.current?.focus()
      return
    }
    const note = notes.trim()
    if (noteFirst && !note && !url) {
      setErrors({ notes: 'Write the note, or add a video link instead' })
      notesRef.current?.focus()
      return
    }
    if (note.length > MAX_NOTES) {
      setErrors({ notes: `Keep the note under ${MAX_NOTES.toLocaleString()} characters` })
      notesRef.current?.focus()
      return
    }

    const patch = {
      title: t,
      summary: summary.trim() || undefined,
      sopVideoUrl: url || undefined,
      sopThumbnailUrl: url ? poster : undefined,
      notes: note ? notes.replace(/\s+$/, '') : undefined,
    }

    if (state?.mode === 'edit') {
      updateCourseTopic(state.topic.id, patch)
      toast.success('Topic updated')
    } else if (state?.mode === 'new') {
      addCourseTopic({ moduleId: state.moduleId, ...patch })
      toast.success(url ? 'Video added' : note ? 'Note added' : 'Topic added')
    }
    onClose()
  }

  const titleField = (
    <Field label="Title" error={errors.title}>
      <input
        ref={titleRef}
        className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          if (errors.title) setErrors((x) => ({ ...x, title: undefined }))
        }}
        placeholder={noteFirst ? 'What the note is about' : 'Filled in from the link, or type your own'}
        autoFocus={!existing && noteFirst}
        aria-invalid={!!errors.title || undefined}
      />
    </Field>
  )
  const notesField = (
    <Field
      label={noteFirst ? 'Note' : <>Note <span className="font-normal text-ink-300">(optional)</span></>}
      error={errors.notes}
      hint={errors.notes ? undefined : <p className="text-xs text-ink-300">Plain text, shown as you write it: line breaks and spacing are kept.</p>}
    >
      <textarea
        ref={notesRef}
        dir="auto"
        className={classNames(
          'input w-full leading-relaxed aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20',
          noteFirst ? 'min-h-[240px]' : 'min-h-[120px]',
        )}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value)
          if (errors.notes) setErrors((x) => ({ ...x, notes: undefined }))
        }}
        placeholder="Steps, links, checklists — anything the team should read."
        aria-invalid={!!errors.notes || undefined}
      />
    </Field>
  )
  const summaryField = (
    <Field label={<>Summary <span className="font-normal text-ink-300">(optional)</span></>}>
      <textarea
        className="input w-full min-h-[80px] leading-relaxed"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="One or two lines on what this topic covers."
      />
    </Field>
  )
  const videoFields = (
    <>
      <Field
        label={noteFirst ? <>Video link <span className="font-normal text-ink-300">(optional)</span></> : 'Video link'}
        error={errors.url}
        hint={
          errors.url ? undefined : (
            <div className="flex items-center gap-1.5 text-xs text-ink-300" aria-live="polite">
              {looking ? (
                <>
                  <CircleNotchIcon size={14} className="shrink-0 animate-spin" aria-hidden /> Reading title from the video…
                </>
              ) : videoUrl.trim() && !embed ? (
                <FieldError className="font-normal">Not a recognised video link — check the URL.</FieldError>
              ) : embed ? (
                <span className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-400">
                  <CheckCircleIcon size={14} className="shrink-0" aria-hidden />
                  {embed.label} link recognised.
                </span>
              ) : (
                <>Optional. Supports {SUPPORTED_VIDEO_HINT}.</>
              )}
            </div>
          )
        }
      >
        <input
          ref={urlRef}
          className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          value={videoUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          onBlur={(e) => void lookup(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-invalid={!!errors.url || undefined}
          autoFocus={!existing && !noteFirst}
        />
      </Field>

      {thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; arbitrary third-party thumbnail URLs
        <img
          key={thumbnail}
          src={thumbnail}
          alt=""
          onError={() => setThumbnail(undefined)}
          className="animate-fade w-full rounded-lg border border-ink-600 bg-ink-700 object-cover"
          style={{ aspectRatio: '16 / 9' }}
        />
      )}
    </>
  )

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={held?.mode === 'edit' ? 'Edit topic' : noteFirst ? 'Add a note' : 'Add a video'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()} disabled={saving} aria-busy={saving || undefined}>
            {existing ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {noteFirst ? (
          <>
            {titleField}
            {notesField}
            {summaryField}
            {videoFields}
          </>
        ) : (
          <>
            {videoFields}
            {titleField}
            {summaryField}
            {notesField}
          </>
        )}
      </div>
    </Modal>
  )
}
