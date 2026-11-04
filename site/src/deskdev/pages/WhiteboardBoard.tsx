import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeftIcon, CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import { EmptyState, SkeletonLine } from '../components/ui-foundation'
import WhiteboardEditor, { type SaveStatus } from '../whiteboard/WhiteboardEditor'
import { openWhiteboard, updateWhiteboard, type WhiteboardMeta, type WhiteboardScene } from '../whiteboard/whiteboardApi'
import { classNames, fmtRelative } from '../lib/format'

/**
 * One whiteboard, full-bleed (revision 9): the title (click to rename), the
 * save state, and the shared Excalidraw canvas. Concurrent changes merge
 * automatically; pending drawing changes have a device recovery copy.
 */
export default function WhiteboardBoard() {
  const { boardId = '' } = useParams()
  const [board, setBoard] = useState<{ meta: WhiteboardMeta; scene: WhiteboardScene } | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mount, setMount] = useState(0)
  const [version, setVersion] = useState(1)
  const [status, setStatus] = useState<SaveStatus>({ kind: 'saved' })
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  // A reload bumps the key; only the newest answer lands, none after leaving.
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey((k) => k + 1), [])
  useEffect(() => {
    let live = true
    openWhiteboard(boardId).then(
      (b) => {
        if (!live) return
        setLoadError(null)
        setBoard(b)
        if (b) setVersion(b.meta.version)
        setStatus({ kind: 'saved', at: b?.meta.updatedAt })
        setMount((n) => n + 1)
      },
      (e: unknown) => { if (live) setLoadError(e instanceof Error ? e.message : 'The board could not be opened.') },
    )
    return () => { live = false }
  }, [boardId, reloadKey])

  const onSaved = useCallback((v: number) => setVersion(v), [])

  const rename = async () => {
    setRenaming(false)
    const next = titleDraft.trim()
    if (!board || !next || next === board.meta.title) return
    try {
      await updateWhiteboard(board.meta.id, { title: next })
      setBoard({ ...board, meta: { ...board.meta, title: next } })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'The title could not be saved.' })
    }
  }

  const title = board?.meta.title ?? 'Whiteboard'

  return (
    <Layout title="Whiteboard" subtitle={board ? board.meta.title : undefined} bare>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-ink-600 bg-ink-850 px-3 py-1.5">
          <Link to="/whiteboard" className="btn-ghost px-2 pointer-coarse:min-h-11" aria-label="All whiteboards" title="All whiteboards">
            <ArrowLeftIcon size={16} aria-hidden />
          </Link>
          {board && (renaming ? (
            <input
              className="input w-64 max-w-full py-1 text-sm font-semibold"
              aria-label="Board title"
              value={titleDraft}
              autoFocus
              maxLength={120}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void rename()
                }
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <button
              type="button"
              className="pressable min-w-0 max-w-[50vw] truncate rounded-md px-1 text-left text-sm font-semibold text-ink-50 hover:text-brand-700 dark:hover:text-brand-400"
              title="Click to rename"
              onClick={() => {
                setTitleDraft(board.meta.title)
                setRenaming(true)
              }}
            >
              {title}
            </button>
          ))}
          <SaveBadge status={status} />

        </div>

        <div className="relative min-h-0 flex-1">
          {loadError ? (
            <div className="p-6">
              <EmptyState
                glyph="search-empty"
                title="This board could not be opened"
                description={loadError}
                action={<button type="button" className="btn-primary" onClick={() => void load()}>Try again</button>}
              />
            </div>
          ) : board === undefined ? (
            <div className="space-y-3 p-6" role="status" aria-busy="true" aria-label="Loading board">
              <SkeletonLine w="30%" className="h-4" />
              <SkeletonLine w="60%" className="h-64" />
            </div>
          ) : board === null ? (
            <div className="p-6">
              <EmptyState
                glyph="search-empty"
                title="Whiteboard not found"
                description="It may have been deleted, or the link is out of date."
                action={<Link to="/whiteboard" className="btn-secondary"><ArrowLeftIcon size={14} aria-hidden /> All whiteboards</Link>}
              />
            </div>
          ) : (
            <WhiteboardEditor
              key={mount}
              boardId={board.meta.id}
              title={board.meta.title}
              scene={board.scene}
              version={version}
              onStatus={setStatus}
              onSaved={onSaved}
            />
          )}
        </div>
      </div>
    </Layout>
  )
}

function SaveBadge({ status }: { status: SaveStatus }) {
  const base = 'ml-auto flex items-center gap-1.5 text-xs'
  if (status.kind === 'saving' || status.kind === 'pending') {
    return (
      <span className={classNames(base, 'text-ink-300')} aria-live="polite">
        <CircleNotchIcon size={13} className="animate-spin" aria-hidden /> Saving…
      </span>
    )
  }
  if (status.kind === 'saved') {
    return (
      <span className={classNames(base, 'text-ink-300')} aria-live="polite">
        <CheckCircleIcon size={13} className="text-emerald-700 dark:text-emerald-400" aria-hidden />
        {status.at ? `Saved ${fmtRelative(status.at)}` : 'Saved'}
      </span>
    )
  }
  if (status.kind === 'conflict') return null
  return (
    <span className={classNames(base, 'text-rose-700 dark:text-rose-400')} role="alert">
      <WarningCircleIcon size={13} aria-hidden /> {status.message}
    </span>
  )
}
