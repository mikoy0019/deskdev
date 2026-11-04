import { ArrowSquareOutIcon, PencilSimpleIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { useHeld } from '../courses/useHeld'
import { useStore } from '../../store/useStore'
import { parseVideoUrl } from '../../lib/videoEmbed'
import { fmtDate } from '../../lib/format'
import type { MeetingRecording } from '../../lib/types'

/**
 * Plays a recording in DeskDev when its link can be embedded safely (the
 * same allowlist as course SOPs); any other link gets a button that opens it.
 */
export default function RecordingPlayer({
  recording,
  onClose,
  onEdit,
}: {
  recording: MeetingRecording | null
  onClose: () => void
  onEdit?: (r: MeetingRecording) => void
}) {
  const held = useHeld(recording)
  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const folders = useStore((s) => s.recordingFolders)
  const embed = held ? parseVideoUrl(held.url) : null
  const client = held?.clientId ? clients.find((c) => c.id === held.clientId) : undefined
  const project = held?.projectId ? projects.find((p) => p.id === held.projectId) : undefined
  const folder = held?.folderId ? folders.find((f) => f.id === held.folderId) : undefined
  const where = [client?.name, project?.title ?? folder?.name].filter(Boolean).join(' › ')

  return (
    <Modal
      open={recording !== null}
      onClose={onClose}
      wide
      title={held?.title ?? 'Recording'}
      footer={
        <>
          {held && onEdit && (
            <button type="button" className="btn-ghost mr-auto" onClick={() => onEdit(held)}>
              <PencilSimpleIcon size={14} aria-hidden /> Edit
            </button>
          )}
          {held && (
            <a className="btn-ghost" href={held.url} target="_blank" rel="noopener noreferrer">
              Open original <ArrowSquareOutIcon size={14} aria-hidden />
            </a>
          )}
          <button type="button" className="btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      {held && (
        <div className="space-y-4">
          {(held.recordedOn || where) && (
            <p className="text-xs text-ink-300">
              {held.recordedOn && <span className="tabular-nums">{fmtDate(held.recordedOn)}</span>}
              {held.recordedOn && where && <span aria-hidden> · </span>}
              {where}
            </p>
          )}
          {embed ? (
            <div className="relative w-full overflow-hidden rounded-lg bg-[#0b0c10] ring-1 ring-ink-600" style={{ aspectRatio: '16 / 9' }}>
              {embed.kind === 'iframe' ? (
                <iframe
                  src={embed.src}
                  title={`Recording: ${held.title}`}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <video src={embed.src} controls className="absolute inset-0 h-full w-full" />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-ink-600 bg-ink-800/60 px-4 py-10 text-center">
              <p className="max-w-[48ch] text-sm text-ink-200">This link can’t be played inside DeskDev, so it opens where it lives.</p>
              <a className="btn-primary" href={held.url} target="_blank" rel="noopener noreferrer">
                Open recording <ArrowSquareOutIcon size={14} aria-hidden />
              </a>
            </div>
          )}
          {held.notes && (
            <p dir="auto" className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-800/60 p-3 text-sm leading-relaxed text-ink-100 [overflow-wrap:anywhere]">
              {held.notes}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
