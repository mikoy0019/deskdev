import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CaretDownIcon, CaretRightIcon, DotsThreeIcon, FolderSimpleIcon, FolderSimplePlusIcon, MagnifyingGlassIcon,
  PencilSimpleIcon, PlayIcon, PlusIcon, TrashIcon, TrayIcon, VideoCameraIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import ConfirmDialog from '../components/ConfirmDialog'
import Popover, { MenuItem } from '../components/crm/Popover'
import RecordingModal, { type RecordingModalState } from '../components/recordings/RecordingModal'
import RecordingPlayer from '../components/recordings/RecordingPlayer'
import { EmptyState, SkeletonCard } from '../components/ui-foundation'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, fmtDate } from '../lib/format'
import { parseVideoUrl } from '../lib/videoEmbed'
import { useMediaQuery } from '../pwa/useMediaQuery'
import type { Client, MeetingRecording, RecordingFolder } from '../lib/types'

/**
 * A place in the tree. 'all' and 'unfiled'; a client (everything of it), its
 * general shelf (no project or category), one of its projects, one of its
 * categories. Kept in ?f= so a folder can be linked to.
 */
type Place = 'all' | 'unfiled' | `c:${string}` | `g:${string}` | `p:${string}` | `f:${string}`

function inPlace(r: MeetingRecording, place: Place, clientIds: Set<string>): boolean {
  if (place === 'all') return true
  const known = r.clientId && clientIds.has(r.clientId)
  if (place === 'unfiled') return !known
  const [kind, id] = [place.slice(0, 1), place.slice(2)]
  if (kind === 'c') return r.clientId === id
  if (kind === 'g') return r.clientId === id && !r.projectId && !r.folderId
  if (kind === 'p') return r.projectId === id
  return r.folderId === id
}

/**
 * Meeting Recordings (revision 8): links to where the videos live, filed by
 * client — each project a folder of its own, plus the client's categories.
 */
export default function Recordings() {
  const user = useCurrentUser()
  const canEdit = can(user, 'meetings', 'edit')
  const hydrated = useStore((s) => s.hydrated)
  const recordings = useStore((s) => s.meetingRecordings)
  const folders = useStore((s) => s.recordingFolders)
  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const deleteRecording = useStore((s) => s.deleteRecording)
  const addRecordingFolder = useStore((s) => s.addRecordingFolder)
  const renameRecordingFolder = useStore((s) => s.renameRecordingFolder)
  const deleteRecordingFolder = useStore((s) => s.deleteRecordingFolder)

  const [params, setParams] = useSearchParams()
  const place = (params.get('f') ?? 'all') as Place
  const go = (p: Place) => setParams(p === 'all' ? {} : { f: p }, { replace: true })
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<RecordingModalState>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MeetingRecording | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ folder: RecordingFolder; anchor: HTMLElement } | null>(null)
  const [folderForm, setFolderForm] = useState<{ clientId: string; folder?: RecordingFolder; anchor: HTMLElement } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [pendingFolderDelete, setPendingFolderDelete] = useState<RecordingFolder | null>(null)
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const phone = useMediaQuery('(max-width: 767.98px)')

  const clientIds = useMemo(() => new Set(clients.map((c) => c.id)), [clients])
  // A client shows when it is still running or has recordings.
  const shelf = useMemo(() => {
    const withRecordings = new Set(recordings.map((r) => r.clientId).filter(Boolean))
    return [...clients]
      .filter((c) => c.status !== 'ended' || withRecordings.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [clients, recordings])
  const count = (p: Place) => recordings.filter((r) => inPlace(r, p, clientIds)).length

  // ?new=1 (the command palette's quick-create): the form opens during render
  // (the flag is URL state), and the effect strips the flag so a refresh
  // doesn't open it again.
  const newFlag = params.get('new') === '1'
  const [newSeen, setNewSeen] = useState(false)
  if (newFlag !== newSeen) {
    setNewSeen(newFlag)
    if (newFlag && canEdit) setModal({ mode: 'new' })
  }
  useEffect(() => {
    if (!newFlag) return
    const next = new URLSearchParams(params)
    next.delete('new')
    setParams(next, { replace: true })
  }, [newFlag, params, setParams])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return recordings
      .filter((r) => inPlace(r, place, clientIds))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.notes?.toLowerCase().includes(q))
      .sort((a, b) => (b.recordedOn ?? b.createdAt).localeCompare(a.recordedOn ?? a.createdAt))
  }, [recordings, place, clientIds, query])

  const placeLabel = (p: Place): string => {
    if (p === 'all') return 'All recordings'
    if (p === 'unfiled') return 'No client'
    const id = p.slice(2)
    if (p.startsWith('c:')) return clients.find((c) => c.id === id)?.name ?? 'Client'
    if (p.startsWith('g:')) return `${clients.find((c) => c.id === id)?.name ?? 'Client'} › General`
    if (p.startsWith('p:')) {
      const pr = projects.find((x) => x.id === id)
      return `${clients.find((c) => c.id === pr?.clientId)?.name ?? 'Client'} › ${pr?.title ?? 'Project'}`
    }
    const f = folders.find((x) => x.id === id)
    return `${clients.find((c) => c.id === f?.clientId)?.name ?? 'Client'} › ${f?.name ?? 'Category'}`
  }

  const newHere = (): RecordingModalState => {
    if (place.startsWith('p:')) {
      const pr = projects.find((x) => x.id === place.slice(2))
      return { mode: 'new', clientId: pr?.clientId, projectId: pr?.id }
    }
    if (place.startsWith('f:')) {
      const f = folders.find((x) => x.id === place.slice(2))
      return { mode: 'new', clientId: f?.clientId, folderId: f?.id }
    }
    if (place.startsWith('c:') || place.startsWith('g:')) return { mode: 'new', clientId: place.slice(2) }
    return { mode: 'new' }
  }

  const saveFolder = () => {
    if (!folderForm) return
    try {
      if (folderForm.folder) {
        renameRecordingFolder(folderForm.folder.id, folderName)
        toast.success('Category renamed')
      } else {
        const id = addRecordingFolder({ clientId: folderForm.clientId, name: folderName })
        go(`f:${id}`)
        toast.success('Category added')
      }
      setFolderForm(null)
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : 'The category could not be saved.')
    }
  }

  const tree = (
    <FolderTree
      shelf={shelf}
      place={place}
      go={(p) => {
        go(p)
        setPickerAnchor(null)
      }}
      count={count}
      projects={projects}
      folders={folders}
      canEdit={canEdit}
      onNewFolder={(clientId, anchor) => {
        setFolderName('')
        setFolderError(null)
        setFolderForm({ clientId, anchor })
      }}
      onFolderMenu={(folder, anchor) => setFolderMenu({ folder, anchor })}
    />
  )

  if (!hydrated) {
    return (
      <Layout title="Meeting Recordings" subtitle="Loading…">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Meeting Recordings" subtitle={`${recordings.length} recording${recordings.length === 1 ? '' : 's'}`}>
      <div className="flex gap-5">
        {!phone && (
          <aside className="card w-64 shrink-0 self-start overflow-hidden p-2" aria-label="Recording folders">
            {tree}
          </aside>
        )}

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {phone ? (
              <button type="button" className="btn-secondary max-w-full" aria-haspopup="dialog" onClick={(e) => setPickerAnchor(e.currentTarget)}>
                <FolderSimpleIcon size={14} aria-hidden />
                <span className="truncate">{placeLabel(place)}</span>
                <CaretDownIcon size={12} aria-hidden />
              </button>
            ) : (
              <h2 className="text-display min-w-0 truncate text-base font-semibold text-ink-50">{placeLabel(place)}</h2>
            )}
            <label className="relative ml-auto w-full sm:w-56">
              <MagnifyingGlassIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
              <input className="input w-full pl-9" placeholder="Search recordings" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search recordings" />
            </label>
            {canEdit && (
              <button type="button" className="btn-primary" onClick={() => setModal(newHere())}>
                <PlusIcon size={16} aria-hidden /> Add recording
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              glyph="meetings"
              title={query.trim() ? 'No recordings match' : 'No recordings here yet'}
              description={query.trim() ? 'Try other words, or another folder.' : 'Paste a Loom, YouTube, Vimeo or Drive link to keep a meeting with its client and project.'}
              action={canEdit && !query.trim() ? (
                <button type="button" className="btn-primary" onClick={() => setModal(newHere())}>
                  <PlusIcon size={16} aria-hidden /> Add recording
                </button>
              ) : undefined}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Recordings">
              {shown.map((r) => (
                <RecordingCard
                  key={r.id}
                  recording={r}
                  where={place === 'all' || place.startsWith('c:') ? placeOf(r, clients, projects, folders) : undefined}
                  canEdit={canEdit}
                  onPlay={() => setPlaying(r.id)}
                  onEdit={() => setModal({ mode: 'edit', recording: r })}
                  onDelete={() => setPendingDelete(r)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {phone && (
        <Popover anchor={pickerAnchor} onClose={() => setPickerAnchor(null)} label="Folders">
          <div className="p-1">{tree}</div>
        </Popover>
      )}

      <Popover anchor={folderMenu?.anchor ?? null} onClose={() => setFolderMenu(null)} role="menu" align="right" label={folderMenu?.folder.name ?? 'Category'}>
        {folderMenu && (
          <>
            <MenuItem icon={PencilSimpleIcon} label="Rename" onClick={() => {
              setFolderName(folderMenu.folder.name)
              setFolderError(null)
              setFolderForm({ clientId: folderMenu.folder.clientId, folder: folderMenu.folder, anchor: folderMenu.anchor })
              setFolderMenu(null)
            }} />
            <MenuItem icon={TrashIcon} label="Delete category" danger onClick={() => {
              setPendingFolderDelete(folderMenu.folder)
              setFolderMenu(null)
            }} />
          </>
        )}
      </Popover>

      <Popover anchor={folderForm?.anchor ?? null} onClose={() => setFolderForm(null)} label={folderForm?.folder ? 'Rename category' : 'New category'}>
        <form
          className="w-64 space-y-2 p-3 max-sm:w-full"
          onSubmit={(e) => {
            e.preventDefault()
            saveFolder()
          }}
        >
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-ink-200">{folderForm?.folder ? 'Category name' : `New category for ${clients.find((c) => c.id === folderForm?.clientId)?.name ?? 'this client'}`}</span>
            <input className="input w-full" value={folderName} autoFocus maxLength={80} onChange={(e) => {
              setFolderName(e.target.value)
              setFolderError(null)
            }} placeholder="e.g. Kickoffs" />
          </label>
          {folderError && <p className="text-xs text-rose-700 dark:text-rose-400" role="alert">{folderError}</p>}
          <button type="submit" className="btn-primary w-full justify-center">{folderForm?.folder ? 'Rename' : 'Add category'}</button>
        </form>
      </Popover>

      <RecordingModal state={modal} onClose={() => setModal(null)} />
      <RecordingPlayer
        recording={recordings.find((r) => r.id === playing) ?? null}
        onClose={() => setPlaying(null)}
        onEdit={canEdit ? (r) => {
          setPlaying(null)
          setModal({ mode: 'edit', recording: r })
        } : undefined}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete recording"
        message={`“${pendingDelete?.title ?? ''}” leaves DeskDev. The video itself stays where it lives.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (pendingDelete) deleteRecording(pendingDelete.id)
          toast.success('Recording deleted')
        }}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingFolderDelete !== null}
        title="Delete category"
        message={`Delete “${pendingFolderDelete?.name ?? ''}”? Its recordings stay with the client, under General.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingFolderDelete) return
          deleteRecordingFolder(pendingFolderDelete.id)
          if (place === `f:${pendingFolderDelete.id}`) go(`g:${pendingFolderDelete.clientId}`)
          toast.success('Category deleted')
        }}
        onClose={() => setPendingFolderDelete(null)}
      />
    </Layout>
  )
}

function placeOf(r: MeetingRecording, clients: Client[], projects: { id: string; title: string }[], folders: RecordingFolder[]): string | undefined {
  const client = clients.find((c) => c.id === r.clientId)
  if (!client) return undefined
  const sub = r.projectId ? projects.find((p) => p.id === r.projectId)?.title : r.folderId ? folders.find((f) => f.id === r.folderId)?.name : undefined
  return sub ? `${client.name} › ${sub}` : client.name
}

function FolderTree({
  shelf, place, go, count, projects, folders, canEdit, onNewFolder, onFolderMenu,
}: {
  shelf: Client[]
  place: Place
  go: (p: Place) => void
  count: (p: Place) => number
  projects: { id: string; clientId: string; title: string }[]
  folders: RecordingFolder[]
  canEdit: boolean
  onNewFolder: (clientId: string, anchor: HTMLElement) => void
  onFolderMenu: (folder: RecordingFolder, anchor: HTMLElement) => void
}) {
  const openFor = place.startsWith('c:') || place.startsWith('g:') ? place.slice(2)
    : place.startsWith('p:') ? projects.find((p) => p.id === place.slice(2))?.clientId
      : place.startsWith('f:') ? folders.find((f) => f.id === place.slice(2))?.clientId
        : undefined
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(openFor ? [openFor] : []))
  const isOpen = (id: string) => expanded.has(id) || id === openFor
  const toggle = (id: string) => setExpanded((s) => {
    const next = new Set(s)
    if (next.has(id) || id === openFor) next.delete(id)
    else next.add(id)
    return next
  })
  const unfiled = count('unfiled')

  return (
    <nav aria-label="Folders">
      <ul className="space-y-0.5">
        <li><Row icon={<TrayIcon size={15} aria-hidden />} label="All recordings" n={count('all')} active={place === 'all'} onClick={() => go('all')} /></li>
        {unfiled > 0 && <li><Row icon={<FolderSimpleIcon size={15} aria-hidden />} label="No client" n={unfiled} active={place === 'unfiled'} onClick={() => go('unfiled')} /></li>}
      </ul>
      {shelf.length > 0 && <p className="section-title px-2 pb-1 pt-3">Clients</p>}
      <ul className="space-y-0.5">
        {shelf.map((c) => {
          const open = isOpen(c.id)
          const own = projects.filter((p) => p.clientId === c.id).sort((a, b) => a.title.localeCompare(b.title))
          const cats = folders.filter((f) => f.clientId === c.id).sort((a, b) => a.name.localeCompare(b.name))
          return (
            <li key={c.id}>
              <div className="flex items-center">
                <button
                  type="button"
                  className="pressable flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-400 hover:text-ink-50"
                  aria-label={open ? `Collapse ${c.name}` : `Expand ${c.name}`}
                  aria-expanded={open}
                  onClick={() => toggle(c.id)}
                >
                  {open ? <CaretDownIcon size={12} aria-hidden /> : <CaretRightIcon size={12} aria-hidden />}
                </button>
                <div className="min-w-0 flex-1">
                  <Row
                    icon={<span className={classNames('size-2 rounded-full', !c.color && 'bg-ink-400')} style={c.color ? { backgroundColor: c.color } : undefined} aria-hidden />}
                    label={c.name}
                    n={count(`c:${c.id}`)}
                    active={place === `c:${c.id}`}
                    onClick={() => {
                      go(`c:${c.id}`)
                      setExpanded((s) => new Set(s).add(c.id))
                    }}
                  />
                </div>
              </div>
              {open && (
                <ul className="ml-5 space-y-0.5 border-l border-ink-600 pl-2">
                  <li><Row icon={<FolderSimpleIcon size={15} aria-hidden />} label="General" n={count(`g:${c.id}`)} active={place === `g:${c.id}`} onClick={() => go(`g:${c.id}`)} /></li>
                  {own.map((p) => (
                    <li key={p.id}><Row icon={<VideoCameraIcon size={15} aria-hidden />} label={p.title} n={count(`p:${p.id}`)} active={place === `p:${p.id}`} onClick={() => go(`p:${p.id}`)} /></li>
                  ))}
                  {cats.map((f) => (
                    <li key={f.id}>
                      <Row
                        icon={<FolderSimpleIcon size={15} weight="fill" aria-hidden />}
                        label={f.name}
                        n={count(`f:${f.id}`)}
                        active={place === `f:${f.id}`}
                        onClick={() => go(`f:${f.id}`)}
                        menu={canEdit ? (anchor) => onFolderMenu(f, anchor) : undefined}
                      />
                    </li>
                  ))}
                  {canEdit && (
                    <li>
                      <button type="button" className="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-300 hover:bg-ink-700/60 hover:text-ink-50" onClick={(e) => onNewFolder(c.id, e.currentTarget)}>
                        <FolderSimplePlusIcon size={14} aria-hidden /> New category
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Row({
  icon, label, n, active, onClick, menu,
}: {
  icon: React.ReactNode
  label: string
  n: number
  active: boolean
  onClick: () => void
  menu?: (anchor: HTMLElement) => void
}) {
  return (
    <div className="group/row relative flex items-center">
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        className={classNames(
          'pressable flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm pointer-coarse:min-h-11',
          active ? 'bg-brand-600/10 text-brand-700 dark:text-brand-300' : 'text-ink-100 hover:bg-ink-700/60',
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-400">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={classNames('text-[11px] tabular-nums text-ink-400', menu && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0')}>{n}</span>
      </button>
      {menu && (
        <button
          type="button"
          aria-label={`Category menu: ${label}`}
          className="pressable absolute right-1 flex size-6 items-center justify-center rounded-sm text-ink-300 opacity-0 hover:bg-ink-600 hover:text-ink-50 focus:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
          onClick={(e) => menu(e.currentTarget)}
        >
          <DotsThreeIcon size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}

function RecordingCard({
  recording, where, canEdit, onPlay, onEdit, onDelete,
}: {
  recording: MeetingRecording
  where?: string
  canEdit: boolean
  onPlay: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [posterFailed, setPosterFailed] = useState(false)
  const embed = parseVideoUrl(recording.url)
  const poster = posterFailed ? undefined : recording.thumbnailUrl ?? embed?.thumbnail
  return (
    <li data-item-kind="recording" data-item-id={recording.id} data-item-label={recording.title} className="card card-hover flex flex-col overflow-hidden">
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${recording.title}`}
        className="relative block w-full overflow-hidden border-b border-ink-600 bg-ink-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
        style={{ aspectRatio: '16 / 9' }}
      >
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; third-party poster URLs
          <img src={poster} alt="" loading="lazy" onError={() => setPosterFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-ink-400"><VideoCameraIcon size={28} aria-hidden /></span>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-ink-800/95 text-ink-50 shadow-(--shadow-2) ring-1 ring-ink-600">
            <PlayIcon size={18} className="translate-x-px" aria-hidden />
          </span>
        </span>
        <span className="absolute right-2 top-2 rounded-sm bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-ink-100 ring-1 ring-ink-600">
          {embed?.label ?? 'Link'}
        </span>
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3 className="line-clamp-2 text-sm font-medium text-ink-50 [overflow-wrap:anywhere]" title={recording.title}>{recording.title}</h3>
        <p className="text-[11px] text-ink-300">
          {recording.recordedOn && <span className="tabular-nums">{fmtDate(recording.recordedOn)}</span>}
          {recording.recordedOn && where && <span aria-hidden> · </span>}
          {where}
        </p>
        {canEdit && (
          <div className="-mb-1 -mr-1 mt-auto flex items-center justify-end gap-0.5 pt-1">
            <button type="button" className="btn-ghost tap-target p-1.5 text-ink-300" aria-label={`Edit ${recording.title}`} onClick={onEdit}>
              <PencilSimpleIcon size={16} aria-hidden />
            </button>
            <button type="button" className="btn-ghost tap-target p-1.5 text-ink-300 hover:text-rose-700 dark:hover:text-rose-400" aria-label={`Delete ${recording.title}`} onClick={onDelete}>
              <TrashIcon size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
