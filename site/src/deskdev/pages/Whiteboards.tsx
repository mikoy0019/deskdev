import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  DotsThreeIcon, FolderSimpleIcon, FolderSimplePlusIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon,
  ScribbleIcon, TrashIcon, TrayIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import ConfirmDialog from '../components/ConfirmDialog'
import Popover, { MenuItem, POPOVER_ROW } from '../components/crm/Popover'
import { EmptyState, SkeletonCard } from '../components/ui-foundation'
import { useStore, useCurrentUser } from '../store/useStore'
import { isAdmin } from '../lib/permissions'
import { classNames, fmtRelative } from '../lib/format'
import {
  createWhiteboard, createWhiteboardFolder, deleteWhiteboard, deleteWhiteboardFolder, listWhiteboards,
  renameWhiteboardFolder, updateWhiteboard, type WhiteboardFolder, type WhiteboardMeta,
} from '../whiteboard/whiteboardApi'

type Place = 'all' | 'unfiled' | `f:${string}`

/**
 * Whiteboard (revision 9): the team's drawings, in folders. A board opens
 * full-screen in the Excalidraw editor; everyone can draw on every board,
 * and the person who made it (or an admin) can delete it.
 */
export default function Whiteboards() {
  const user = useCurrentUser()
  const users = useStore((s) => s.users)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const place = (params.get('f') ?? 'all') as Place
  const go = (p: Place) => setParams(p === 'all' ? {} : { f: p }, { replace: true })

  const [data, setData] = useState<{ folders: WhiteboardFolder[]; boards: WhiteboardMeta[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<{ kind: 'board' | 'folder' | 'rename-folder' | 'rename-board'; anchor: HTMLElement; id?: string } | null>(null)
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ kind: 'board' | 'folder'; id: string; anchor: HTMLElement } | null>(null)
  const [moveFor, setMoveFor] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'board' | 'folder'; id: string; label: string } | null>(null)

  // A reload bumps the key; only the newest answer lands, none after leaving.
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey((k) => k + 1), [])
  useEffect(() => {
    let live = true
    listWhiteboards().then(
      (value) => { if (live) { setData(value); setLoadError(null) } },
      (e: unknown) => { if (live) setLoadError(e instanceof Error ? e.message : 'Whiteboards could not be loaded.') },
    )
    return () => { live = false }
  }, [reloadKey])

  // ?new=1 from the command palette: a new board, opened straight away.
  const newFlag = params.get('new') === '1'
  useEffect(() => {
    if (!newFlag) return
    void createWhiteboard({ title: 'Untitled board' }).then(
      (meta) => navigate(`/whiteboard/${meta.id}`, { replace: true }),
      (e: unknown) => setLoadError(e instanceof Error ? e.message : 'The board could not be created.'),
    )
  }, [newFlag, navigate])

  const folders = useMemo(() => data?.folders ?? [], [data])
  const boards = useMemo(() => data?.boards ?? [], [data])
  const nameOf = (id?: string) => users.find((u) => u.id === id)?.fullName
  const canDelete = (createdBy?: string) => isAdmin(user) || createdBy === user?.id
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return boards
      .filter((b) => place === 'all' || (place === 'unfiled' ? !b.folderId || !folders.some((f) => f.id === b.folderId) : b.folderId === place.slice(2)))
      .filter((b) => !q || b.title.toLowerCase().includes(q))
  }, [boards, folders, place, query])
  const count = (p: Place) => boards.filter((b) => p === 'all' || (p === 'unfiled' ? !b.folderId : b.folderId === p.slice(2))).length

  const submit = async () => {
    if (!form) return
    setFormError(null)
    try {
      if (form.kind === 'board') {
        const meta = await createWhiteboard({ title: name, folderId: place.startsWith('f:') ? place.slice(2) : undefined })
        navigate(`/whiteboard/${meta.id}`)
        return
      }
      if (form.kind === 'folder') {
        const folder = await createWhiteboardFolder(name)
        go(`f:${folder.id}`)
        toast.success('Folder added')
      } else if (form.kind === 'rename-folder' && form.id) {
        await renameWhiteboardFolder(form.id, name)
        toast.success('Folder renamed')
      } else if (form.kind === 'rename-board' && form.id) {
        await updateWhiteboard(form.id, { title: name })
        toast.success('Board renamed')
      }
      setForm(null)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'That could not be saved.')
    }
  }

  const openForm = (kind: NonNullable<typeof form>['kind'], anchor: HTMLElement, id?: string, initial = '') => {
    setName(initial)
    setFormError(null)
    setForm({ kind, anchor, id })
  }

  const placeLabel = place === 'all' ? 'All boards' : place === 'unfiled' ? 'Not in a folder' : folders.find((f) => f.id === place.slice(2))?.name ?? 'Folder'

  return (
    <Layout title="Whiteboard" subtitle={data ? `${boards.length} board${boards.length === 1 ? '' : 's'}` : 'Loading…'}>
      <div className="flex gap-5 max-md:flex-col">
        <aside className="card self-start p-2 md:w-60 md:shrink-0 max-md:w-full" aria-label="Whiteboard folders">
          <ul className="space-y-0.5 max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:space-y-0">
            <FolderRow icon={<TrayIcon size={15} aria-hidden />} label="All boards" n={count('all')} active={place === 'all'} onClick={() => go('all')} />
            <FolderRow icon={<FolderSimpleIcon size={15} aria-hidden />} label="Not in a folder" n={count('unfiled')} active={place === 'unfiled'} onClick={() => go('unfiled')} />
            {folders.map((f) => (
              <FolderRow
                key={f.id}
                icon={<FolderSimpleIcon size={15} weight="fill" aria-hidden />}
                label={f.name}
                n={count(`f:${f.id}`)}
                active={place === `f:${f.id}`}
                onClick={() => go(`f:${f.id}`)}
                onMenu={(anchor) => setMenu({ kind: 'folder', id: f.id, anchor })}
              />
            ))}
          </ul>
          <button
            type="button"
            className="pressable mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-300 hover:bg-ink-700/60 hover:text-ink-50"
            onClick={(e) => openForm('folder', e.currentTarget)}
          >
            <FolderSimplePlusIcon size={14} aria-hidden /> New folder
          </button>
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-display min-w-0 truncate text-base font-semibold text-ink-50">{placeLabel}</h2>
            <label className="relative ml-auto w-full sm:w-56">
              <MagnifyingGlassIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
              <input className="input w-full pl-9" placeholder="Search boards" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search boards" />
            </label>
            <button type="button" className="btn-primary" onClick={(e) => openForm('board', e.currentTarget, undefined, '')}>
              <PlusIcon size={16} aria-hidden /> New whiteboard
            </button>
          </div>

          {loadError ? (
            <EmptyState
              glyph="search-empty"
              title="Whiteboards could not be loaded"
              description={loadError}
              action={<button type="button" className="btn-primary" onClick={() => void load()}>Try again</button>}
            />
          ) : !data ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState
              icon={ScribbleIcon}
              title={query.trim() ? 'No boards match' : 'No whiteboards here yet'}
              description={query.trim() ? 'Try another word, or another folder.' : 'Sketch a flow, a site map or a plan. Boards save themselves as you draw.'}
              action={!query.trim() ? (
                <button type="button" className="btn-primary" onClick={(e) => openForm('board', e.currentTarget)}>
                  <PlusIcon size={16} aria-hidden /> New whiteboard
                </button>
              ) : undefined}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Whiteboards">
              {shown.map((b) => (
                <li key={b.id} data-item-kind="whiteboard" data-item-id={b.id} data-item-label={b.title} data-item-path={`/whiteboard/${b.id}`} className="card card-hover group/board relative flex flex-col overflow-hidden">
                  <button
                    type="button"
                    className="flex flex-1 flex-col text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                    onClick={() => navigate(`/whiteboard/${b.id}`)}
                  >
                    <span className="flex aspect-[16/9] w-full items-center justify-center border-b border-ink-600 bg-ink-800 text-ink-400">
                      <ScribbleIcon size={36} aria-hidden />
                    </span>
                    <span className="flex flex-col gap-1 p-3.5">
                      <span className="line-clamp-2 text-sm font-medium text-ink-50 [overflow-wrap:anywhere]">{b.title}</span>
                      <span className="text-[11px] text-ink-300">
                        Edited {fmtRelative(b.updatedAt)}{nameOf(b.updatedBy) ? ` by ${nameOf(b.updatedBy)}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Board menu: ${b.title}`}
                    className="pressable absolute right-2 top-2 flex size-8 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-ink-300 opacity-0 shadow-(--shadow-1) hover:text-ink-50 focus:opacity-100 group-hover/board:opacity-100 pointer-coarse:opacity-100"
                    onClick={(e) => setMenu({ kind: 'board', id: b.id, anchor: e.currentTarget })}
                  >
                    <DotsThreeIcon size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Popover anchor={form?.anchor ?? null} onClose={() => setForm(null)} align="right" label={form?.kind === 'board' ? 'New whiteboard' : form?.kind === 'folder' ? 'New folder' : 'Rename'}>
        <form className="w-64 space-y-2 p-3 max-sm:w-full" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-ink-200">
              {form?.kind === 'board' ? 'Board title' : form?.kind === 'folder' ? 'Folder name' : 'New name'}
            </span>
            <input className="input w-full" value={name} autoFocus maxLength={form?.kind === 'board' || form?.kind === 'rename-board' ? 120 : 80} onChange={(e) => { setName(e.target.value); setFormError(null) }} placeholder={form?.kind === 'board' ? 'e.g. Site map' : 'e.g. Client flows'} />
          </label>
          {formError && <p className="text-xs text-rose-700 dark:text-rose-400" role="alert">{formError}</p>}
          <button type="submit" className="btn-primary w-full justify-center">
            {form?.kind === 'board' ? 'Create and open' : form?.kind === 'folder' ? 'Add folder' : 'Rename'}
          </button>
        </form>
      </Popover>

      <Popover anchor={menu?.anchor ?? null} onClose={() => setMenu(null)} role="menu" align="right" label="Actions">
        {menu?.kind === 'board' && (() => {
          const b = boards.find((x) => x.id === menu.id)
          if (!b) return null
          return (
            <>
              <MenuItem icon={PencilSimpleIcon} label="Rename" onClick={() => { const a = menu.anchor; setMenu(null); openForm('rename-board', a, b.id, b.title) }} />
              <MenuItem icon={FolderSimpleIcon} label="Move to folder…" onClick={() => { const a = menu.anchor; setMenu(null); setMoveFor({ id: b.id, anchor: a }) }} />
              {canDelete(b.createdBy) && (
                <MenuItem icon={TrashIcon} label="Delete board" danger onClick={() => { setMenu(null); setPendingDelete({ kind: 'board', id: b.id, label: b.title }) }} />
              )}
            </>
          )
        })()}
        {menu?.kind === 'folder' && (() => {
          const f = folders.find((x) => x.id === menu.id)
          if (!f) return null
          return (
            <>
              <MenuItem icon={PencilSimpleIcon} label="Rename" onClick={() => { const a = menu.anchor; setMenu(null); openForm('rename-folder', a, f.id, f.name) }} />
              {canDelete(f.createdBy) && (
                <MenuItem icon={TrashIcon} label="Delete folder" danger onClick={() => { setMenu(null); setPendingDelete({ kind: 'folder', id: f.id, label: f.name }) }} />
              )}
            </>
          )
        })()}
      </Popover>

      <Popover anchor={moveFor?.anchor ?? null} onClose={() => setMoveFor(null)} role="menu" align="right" label="Move to folder">
        {moveFor && (
          <>
            {[{ id: null as string | null, name: 'Not in a folder' }, ...folders].map((f) => (
              <button
                key={f.id ?? 'none'}
                type="button"
                role="menuitem"
                className={classNames(POPOVER_ROW, 'text-ink-100 hover:bg-ink-700')}
                onClick={() => {
                  const id = moveFor.id
                  setMoveFor(null)
                  void updateWhiteboard(id, { folderId: f.id }).then(load, (e: unknown) => toast.error(e instanceof Error ? e.message : 'The board could not be moved.'))
                }}
              >
                <FolderSimpleIcon size={15} className="text-ink-400" aria-hidden /> {f.name}
              </button>
            ))}
          </>
        )}
      </Popover>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'folder' ? 'Delete folder' : 'Delete whiteboard'}
        message={pendingDelete?.kind === 'folder'
          ? `Delete “${pendingDelete?.label ?? ''}”? Its boards stay, outside any folder.`
          : `Delete “${pendingDelete?.label ?? ''}” and its drawing? This can’t be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingDelete) return
          const run = pendingDelete.kind === 'folder' ? deleteWhiteboardFolder(pendingDelete.id) : deleteWhiteboard(pendingDelete.id)
          void run.then(
            () => {
              if (pendingDelete.kind === 'folder' && place === `f:${pendingDelete.id}`) go('all')
              toast.success(pendingDelete.kind === 'folder' ? 'Folder deleted' : 'Board deleted')
              return load()
            },
            (e: unknown) => toast.error(e instanceof Error ? e.message : 'That could not be deleted.'),
          )
        }}
        onClose={() => setPendingDelete(null)}
      />
    </Layout>
  )
}

function FolderRow({
  icon, label, n, active, onClick, onMenu,
}: {
  icon: React.ReactNode
  label: string
  n: number
  active: boolean
  onClick: () => void
  onMenu?: (anchor: HTMLElement) => void
}) {
  return (
    <li className="group/row relative flex shrink-0 items-center">
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
        <span className="min-w-0 flex-1 truncate max-md:whitespace-nowrap">{label}</span>
        <span className={classNames('text-[11px] tabular-nums text-ink-400', onMenu && 'md:group-hover/row:opacity-0')}>{n}</span>
      </button>
      {onMenu && (
        <button
          type="button"
          aria-label={`Folder menu: ${label}`}
          className="pressable flex size-6 items-center justify-center rounded-sm text-ink-300 hover:bg-ink-600 hover:text-ink-50 md:absolute md:right-1 md:opacity-0 md:focus:opacity-100 md:group-hover/row:opacity-100"
          onClick={(e) => onMenu(e.currentTarget)}
        >
          <DotsThreeIcon size={14} aria-hidden />
        </button>
      )}
    </li>
  )
}
