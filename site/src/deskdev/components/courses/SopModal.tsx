import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowSquareOutIcon, CheckCircleIcon, TrashIcon, VideoCameraIcon, WarningIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { Field, FieldError } from '../tasks/formBits'
import { useHeld } from './useHeld'
import { useStore } from '../../store/useStore'
import { parseVideoUrl, SUPPORTED_VIDEO_HINT } from '../../lib/videoEmbed'
import { fetchVideoMeta } from '../../lib/videoOembed'
import type { CourseTopic } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'
import { classNames } from '../../lib/format'

/**
 * The SOP viewer/editor for one topic.
 *
 * Everyone with `courses: view` can watch; only `courses: edit` (admins by
 * default) sees the link field. The URL is run through parseVideoUrl before it
 * reaches an <iframe> — see lib/videoEmbed.ts for why that matters.
 */
export default function SopModal({
  topic,
  canEdit,
  onClose,
}: {
  topic: CourseTopic | null
  canEdit: boolean
  onClose: () => void
}) {
  const updateCourseTopic = useStore((s) => s.updateCourseTopic)
  const [draft, setDraft] = useState('')
  // The live topic drives `open`; the held one keeps the player and title on
  // screen while the dialog leaves (a null topic used to blank it mid-exit).
  const heldTopic = useHeld(topic)

  useResetOnChange([topic], () => {
    if (topic) setDraft(topic.sopVideoUrl ?? '')
  })

  // A click on the embedded player moves keyboard focus into its frame, and
  // keys pressed there never reach this page: Escape stopped closing the
  // dialog. So a pointer landing in the frame hands focus back to the player's
  // wrapper (the click still plays the video). Arriving by Tab is left alone,
  // because that is how a keyboard reaches the player's own controls; Tab
  // again leaves the frame and Escape works as before.
  const playerRef = useRef<HTMLDivElement>(null)
  const open = topic !== null
  useEffect(() => {
    if (!open) return
    let lastTab = 0
    let timer = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') lastTab = performance.now()
    }
    const onBlur = () => {
      window.clearTimeout(timer)
      // After the browser has settled focus on the frame.
      timer = window.setTimeout(() => {
        const box = playerRef.current
        const held = document.activeElement
        if (!box || !held || held.tagName !== 'IFRAME' || !box.contains(held)) return
        if (performance.now() - lastTab < 250) return
        box.focus({ preventScroll: true })
      }, 0)
    }
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  const saved = heldTopic?.sopVideoUrl ?? ''
  const embed = useMemo(() => (saved ? parseVideoUrl(saved) : null), [saved])
  const draftEmbed = useMemo(() => (draft.trim() ? parseVideoUrl(draft) : null), [draft])
  const dirty = draft.trim() !== saved

  const save = async () => {
    if (!topic) return
    const next = draft.trim()
    if (!next) { toast.error('Paste a video link, or use Remove to clear the SOP'); return }
    if (!parseVideoUrl(next)) {
      toast.error(`That link can't be embedded. Use ${SUPPORTED_VIDEO_HINT}.`)
      return
    }
    // Save immediately so the link is never lost to a slow lookup, then patch
    // the poster in once oEmbed answers.
    updateCourseTopic(topic.id, { sopVideoUrl: next })
    toast.success('SOP video saved')
    const meta = await fetchVideoMeta(next)
    if (meta?.thumbnail) updateCourseTopic(topic.id, { sopThumbnailUrl: meta.thumbnail })
  }

  const remove = () => {
    if (!topic) return
    updateCourseTopic(topic.id, { sopVideoUrl: undefined, sopThumbnailUrl: undefined })
    setDraft('')
    toast.success('SOP video removed')
  }

  return (
    <Modal
      open={topic !== null}
      onClose={onClose}
      wide
      title={heldTopic ? (heldTopic.sopVideoUrl || !heldTopic.notes?.trim() ? `SOP — ${heldTopic.title}` : heldTopic.title) : 'SOP'}
      footer={<button className="btn-ghost" onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        {heldTopic?.summary && (
          <p className="max-w-[65ch] text-sm leading-relaxed text-ink-300 [overflow-wrap:anywhere]">{heldTopic.summary}</p>
        )}

        {/* ── Player ─────────────────────────────────────────────────────── */}
        {saved && embed && (
          <div>
            {/* Letterbox in near-black ink, not #000: the player's own frame. */}
            <div
              ref={playerRef}
              tabIndex={-1}
              className="relative w-full overflow-hidden rounded-lg bg-[#0b0c10] outline-hidden ring-1 ring-ink-600"
              style={{ aspectRatio: '16 / 9' }}
            >
              {embed.kind === 'iframe' ? (
                <iframe
                  src={embed.src}
                  title={`SOP video for ${heldTopic?.title ?? 'topic'}`}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <video src={embed.src} controls className="absolute inset-0 w-full h-full" />
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-300">
              <span>{embed.label}</span>
              <a
                href={saved}
                target="_blank"
                rel="noopener noreferrer"
                className="pressable inline-flex items-center gap-1 rounded-sm hover:text-ink-50 pointer-coarse:min-h-11"
              >
                Open original <ArrowSquareOutIcon size={14} aria-hidden />
              </a>
            </div>
          </div>
        )}

        {/* A link saved before the allowlist tightened, or a provider we drop. */}
        {saved && !embed && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <WarningIcon size={16} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 text-xs leading-relaxed text-ink-100 [overflow-wrap:anywhere]">
              This link can&apos;t be embedded safely, so it isn&apos;t shown inline.{' '}
              <a href={saved} target="_blank" rel="noopener noreferrer" className="underline">
                Open it in a new tab
              </a>
              {canEdit && <> — or replace it below with {SUPPORTED_VIDEO_HINT}.</>}
            </div>
          </div>
        )}

        {/* ── The written note (055) ─────────────────────────────────────── */}
        {heldTopic?.notes?.trim() && (
          <section aria-label="Note" className={classNames(saved && 'border-t border-ink-600 pt-4')}>
            {saved && <h3 className="section-title mb-2">Note</h3>}
            <div
              dir="auto"
              className="max-h-[50vh] overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-800/60 p-4 text-sm leading-relaxed text-ink-100 [overflow-wrap:anywhere]"
              tabIndex={0}
            >
              {heldTopic.notes}
            </div>
          </section>
        )}

        {!saved && !canEdit && !heldTopic?.notes?.trim() && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60" aria-hidden>
              <VideoCameraIcon size={22} />
            </span>
            <p className="text-sm text-ink-300">No SOP video has been recorded for this topic yet.</p>
          </div>
        )}

        {/* ── Editor (admins) ────────────────────────────────────────────── */}
        {canEdit && (
          <div className="border-t border-ink-600 pt-4">
            <Field
              label={saved ? 'Replace SOP video link' : 'Add an SOP video link'}
              hint={
                <div className="space-y-1" aria-live="polite">
                  <p className="text-xs text-ink-300">Supports {SUPPORTED_VIDEO_HINT}.</p>
                  {draft.trim() && !draftEmbed && (
                    <FieldError className="font-normal">Not a recognised video link — check the URL.</FieldError>
                  )}
                  {draft.trim() && draftEmbed && dirty && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-400">
                      <CheckCircleIcon size={14} className="shrink-0" aria-hidden />
                      {draftEmbed.label} link recognised.
                    </p>
                  )}
                </div>
              }
            >
              <input
                className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                aria-invalid={(draft.trim() !== '' && !draftEmbed) || undefined}
              />
            </Field>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={() => void save()} disabled={!dirty || !draftEmbed}>
                Save link
              </button>
              {saved && (
                <button
                  className="btn-ghost text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
                  onClick={remove}
                >
                  <TrashIcon size={14} aria-hidden /> Remove
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
