import { useMemo, useState } from 'react'
import { NotePencilIcon, NoteIcon, PencilSimpleIcon, PlayIcon, PlusIcon, TrashIcon, VideoCameraIcon } from '@phosphor-icons/react'
import { parseVideoUrl } from '../../lib/videoEmbed'
import { classNames } from '../../lib/format'
import type { CourseTopic } from '../../lib/types'

/**
 * One topic as a video tile: 16:9 poster, play affordance, title, summary.
 *
 * The poster is whatever oEmbed returned when the link was saved, falling back
 * to a URL guessed from the video id. Either can 404 later — a video goes
 * private, a CDN path changes — so `posterFailed` swaps in the placeholder on
 * the image's error event rather than leaving a broken-image icon.
 */
export default function TopicCard({
  topic,
  canEdit,
  onOpenSop,
  onEdit,
  onDelete,
}: {
  topic: CourseTopic
  canEdit: boolean
  onOpenSop: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [posterFailed, setPosterFailed] = useState(false)

  const embed = useMemo(
    () => (topic.sopVideoUrl ? parseVideoUrl(topic.sopVideoUrl) : null),
    [topic.sopVideoUrl],
  )

  // A saved-but-unembeddable link still counts as "has an SOP" — the modal
  // explains it and offers the raw link.
  const hasSop = Boolean(topic.sopVideoUrl)
  const hasNote = Boolean(topic.notes?.trim())
  // A note on its own (055): the tile reads as a page, not a missing video.
  const noteOnly = hasNote && !hasSop
  // Cached oEmbed poster wins; the id-derived guess is the fallback.
  const poster = posterFailed ? undefined : topic.sopThumbnailUrl ?? embed?.thumbnail
  const openable = hasSop || hasNote || canEdit

  return (
    // The press answers the poster (the tile's main action), not its edit /
    // delete buttons; motion-safe so reduced motion keeps it still.
    <div className="card card-hover overflow-hidden flex flex-col max-sm:flex-row group transition-[scale,background-color,border-color,box-shadow] duration-(--dur-press) [transition-timing-function:var(--ease-out),ease,ease,ease] motion-safe:has-[button[data-poster]:active:enabled]:scale-(--press-scale-card)">
      {/* ── Poster ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        data-poster=""
        disabled={!openable}
        onClick={onOpenSop}
        aria-label={
          hasSop ? `Watch SOP for ${topic.title}` : noteOnly ? `Read note: ${topic.title}` : `Add SOP video for ${topic.title}`
        }
        className={classNames(
          'relative block w-full overflow-hidden bg-ink-700 border-b border-ink-600 max-sm:w-28 max-sm:shrink-0 max-sm:self-start max-sm:m-3 max-sm:mr-0 max-sm:rounded-md max-sm:border select-none [-webkit-touch-callout:none] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
          openable ? 'cursor-pointer' : 'cursor-default',
        )}
        style={{ aspectRatio: '16 / 9' }}
      >
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; arbitrary third-party thumbnail URLs
          <img
            src={poster}
            alt=""
            loading="lazy"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : hasSop ? null : noteOnly ? (
          // The note's opening lines, as a page; the gradient fades the cut.
          <span className="absolute inset-0 flex flex-col gap-1 overflow-hidden bg-ink-800 p-3 text-left max-sm:p-2" aria-hidden>
            <span className="flex items-center gap-1 text-[11px] font-medium text-ink-300">
              <NoteIcon size={12} /> Note
            </span>
            <span dir="auto" className="whitespace-pre-line text-[11px] leading-snug text-ink-200 max-sm:hidden">
              {topic.notes!.slice(0, 240)}
            </span>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-ink-800 to-transparent" />
          </span>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center">
            <VideoCameraIcon
              size={28}
              // Phones: the small poster holds the "Add SOP" chip instead.
              className={classNames('text-ink-400 max-sm:size-6', canEdit && 'max-sm:hidden')}
              aria-hidden
            />
          </span>
        )}

        {/* Play badge — only when there is something to play. */}
        {hasSop && (
          <span
            className={classNames(
              'absolute inset-0 flex items-center justify-center',
              // Theme tokens, not black/white: a light card gets a light badge.
              poster ? 'group-hover:bg-ink-900/25' : '',
              'transition-colors duration-150',
            )}
          >
            <span className="size-11 max-sm:size-8 rounded-full bg-ink-800/95 text-ink-50 flex items-center justify-center ring-1 ring-ink-600 shadow-(--shadow-2)">
              {/* Regular weight like every other icon: fill is kept for active states. */}
              <PlayIcon size={18} className="translate-x-px" aria-hidden />
            </span>
          </span>
        )}

        {!hasSop && !noteOnly && canEdit && (
          <span className="absolute bottom-1.5 left-1.5 sm:bottom-2 sm:left-2 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium bg-ink-800 text-ink-200 ring-1 ring-ink-600">
            <PlusIcon size={12} aria-hidden />
            Add SOP
          </span>
        )}

        {embed && (
          <span className="absolute top-2 right-2 max-sm:hidden rounded-sm px-1.5 py-0.5 text-[11px] font-medium bg-ink-800 text-ink-100 ring-1 ring-ink-600">
            {embed.label}
          </span>
        )}
      </button>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="min-w-0 p-3.5 max-sm:py-3 flex-1 flex flex-col gap-1">
        <h3 className="text-sm font-medium text-ink-50 line-clamp-2 [overflow-wrap:anywhere]" title={topic.title}>
          {topic.title}
        </h3>
        {topic.summary && (
          <p className="text-xs leading-relaxed text-ink-300 line-clamp-2 [overflow-wrap:anywhere]">{topic.summary}</p>
        )}
        {hasNote && hasSop && (
          <p className="flex items-center gap-1 text-[11px] text-ink-300">
            <NotePencilIcon size={12} aria-hidden /> With a written note
          </p>
        )}

        {canEdit && (
          <div className="mt-auto -mb-1 -mr-1 pt-1 flex items-center justify-end gap-0.5">
            <button
              className="btn-ghost tap-target p-1.5 text-ink-300"
              aria-label={`Edit topic ${topic.title}`}
              onClick={onEdit}
            >
              <PencilSimpleIcon size={16} aria-hidden />
            </button>
            <button
              className="btn-ghost tap-target p-1.5 text-ink-300 hover:text-rose-700 dark:hover:text-rose-400"
              aria-label={`Delete topic ${topic.title}`}
              onClick={onDelete}
            >
              <TrashIcon size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
