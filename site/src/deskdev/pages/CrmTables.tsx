import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  CaretRightIcon, ColumnsIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, RowsIcon, TrashIcon,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import Layout from '../components/Layout'
import { EmptyState, SkeletonBlock, SkeletonLine } from '../components/ui-foundation'
import ConfirmDialog from '../components/ConfirmDialog'
import TableFormModal from '../components/crm/TableFormModal'
import Popover, { MenuItem } from '../components/crm/Popover'
import { useStagger } from '../components/motion'
import { useNow } from '../components/growth/shared'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, fmtRelative } from '../lib/format'
import type { CrmTable } from '../lib/types'

// One ruled list instead of a grid of boxes: name · columns · rows · updated · menu.
// Phones: name spans the row, the figures sit on a second line under it.
const ROW_GRID =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_8.5rem_2.75rem]'

/** Row-shaped placeholder while the store rehydrates. */
function TablesSkeleton() {
  return (
    <div className="card overflow-hidden" role="status" aria-busy="true" aria-label="Loading tables">
      <div className="hidden md:block h-9 border-b border-ink-600" />
      <div className="divide-y divide-ink-600">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={classNames('grid gap-3 px-4 py-4 items-center', ROW_GRID)}>
            <div className="flex items-center gap-3 min-w-0">
              <SkeletonBlock w={10} h={36} rounded="md" />
              <div className="flex-1 space-y-2">
                <SkeletonLine w={i % 2 ? '38%' : '52%'} />
                <SkeletonLine w="22%" className="h-3" />
              </div>
            </div>
            <SkeletonLine w={48} className="hidden md:block h-3" />
            <SkeletonLine w={40} className="hidden md:block h-3" />
            <SkeletonLine w={64} className="hidden md:block h-3" />
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CrmTables() {
  const user = useCurrentUser()
  const canEdit = can(user, 'crm', 'edit')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const hydrated = useStore((s) => s.hydrated)
  const crmTables = useStore((s) => s.crmTables)
  const crmColumns = useStore((s) => s.crmColumns)
  const crmRows = useStore((s) => s.crmRows)
  const clients = useStore((s) => s.clients)
  const deleteCrmTable = useStore((s) => s.deleteCrmTable)

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CrmTable | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CrmTable | null>(null)
  const [menu, setMenu] = useState<{ table: CrmTable; anchor: HTMLElement } | null>(null)

  // Quick-create entry point (?new=1 from the command palette) — open the
  // create modal once (during render: the flag is URL state), then strip the
  // flag so refresh/back doesn't reopen it.
  const newFlag = searchParams.get('new') === '1'
  const [newSeen, setNewSeen] = useState(false)
  if (newFlag !== newSeen) {
    setNewSeen(newFlag)
    if (newFlag && canEdit) {
      setEditTarget(null)
      setFormOpen(true)
    }
  }
  useEffect(() => {
    if (!newFlag) return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [newFlag, searchParams, setSearchParams])

  const tables = useMemo(
    () => [...crmTables].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [crmTables],
  )

  // An edit stamped ahead of this clock (another device's skew, a seed) reads
  // as "now", never "Updated in 4h".
  const now = useNow()
  const updatedLabel = (iso: string) => fmtRelative(new Date(Math.min(new Date(iso).getTime(), now)).toISOString())

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])

  const counts = useMemo(() => {
    const map = new Map<string, { cols: number; rows: number }>()
    for (const t of crmTables) map.set(t.id, { cols: 0, rows: 0 })
    for (const c of crmColumns) {
      const e = map.get(c.tableId)
      if (e) e.cols += 1
    }
    for (const r of crmRows) {
      const e = map.get(r.tableId)
      if (e) e.rows += 1
    }
    return map
  }, [crmTables, crmColumns, crmRows])

  // First load of the list this session: rows arrive 40ms apart (never again).
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('crm-tables')

  const newTableButton = canEdit && (
    <button
      className="btn-primary pointer-coarse:min-h-11"
      onClick={() => {
        setEditTarget(null)
        setFormOpen(true)
      }}
    >
      <PlusIcon size={16} aria-hidden />
      New table
    </button>
  )

  return (
    <Layout title="CRM" subtitle={`${tables.length} custom table${tables.length === 1 ? '' : 's'}`}>
      <div className="mx-auto max-w-6xl space-y-4">
        {!hydrated ? (
          <TablesSkeleton />
        ) : tables.length === 0 ? (
          <EmptyState
            glyph="crm"
            title="No tables yet"
            description="Build Airtable-style tables with text, number, select, date, checkbox, and URL columns."
            action={newTableButton || undefined}
          />
        ) : (
          <>
            {newTableButton && <div className="flex justify-end max-sm:[&>*]:w-full">{newTableButton}</div>}

            <div className="card overflow-hidden">
              <div
                className={classNames('hidden md:grid gap-3 px-4 py-2.5 border-b border-ink-600 section-title text-[11px]', ROW_GRID)}
                aria-hidden
              >
                <span>Table</span>
                <span className="text-right">Columns</span>
                <span className="text-right">Rows</span>
                <span className="text-right">Updated</span>
                <span />
              </div>
              <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)}>
                {tables.map((t) => {
                  const client = t.clientId ? clientById.get(t.clientId) : undefined
                  const count = counts.get(t.id) ?? { cols: 0, rows: 0 }
                  return (
                    <li
                      key={t.id}
                      data-item-kind="crm table" data-item-id={t.id} data-item-label={t.name} data-item-path={`/crm/${t.id}`}
                      className={classNames(
                        // A ruled row can't scale without its hairlines shifting: its press
                        // is a deeper tint, on press-down (the link covers the row).
                        'group relative grid gap-x-3 gap-y-2 px-4 py-3.5 items-center hover:bg-ink-700/40 has-[a:active]:bg-ink-700/70 transition-colors duration-150 ease-[ease]',
                        ROW_GRID,
                      )}
                    >
                      <Link
                        to={`/crm/${t.id}`}
                        className="min-w-0 flex items-center gap-3 rounded-md pointer-coarse:min-h-11 [-webkit-touch-callout:none] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 after:absolute after:inset-0 after:content-['']"
                      >
                        {/* The table's colour as a tall swatch: identity without a heavy top bar. */}
                        <span
                          className={classNames('w-1.5 h-9 rounded-full shrink-0', !t.color && 'bg-ink-500')}
                          style={t.color ? { backgroundColor: t.color } : undefined}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span
                            className="block text-sm font-medium text-ink-50 truncate group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors duration-150 ease-[ease]"
                            title={t.name}
                          >
                            {t.name}
                          </span>
                          <span className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-ink-300">
                            {client && (
                              <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                                <span
                                  className={classNames('w-2 h-2 rounded-full shrink-0', !client.color && 'bg-ink-400')}
                                  style={client.color ? { backgroundColor: client.color } : undefined}
                                  aria-hidden
                                />
                                <span className="truncate">{client.name}</span>
                              </span>
                            )}
                            {/* Phones: the figures ride under the name. */}
                            <span className="md:hidden inline-flex items-center gap-3 tabular-nums">
                              <span className="inline-flex items-center gap-1">
                                <ColumnsIcon size={14} className="text-ink-400" aria-hidden />
                                {count.cols} column{count.cols === 1 ? '' : 's'}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <RowsIcon size={14} className="text-ink-400" aria-hidden />
                                {count.rows} row{count.rows === 1 ? '' : 's'}
                              </span>
                              <span>Updated {updatedLabel(t.updatedAt)}</span>
                            </span>
                          </span>
                        </span>
                      </Link>

                      <span className="hidden md:block text-right text-sm tabular-nums text-ink-100">
                        {count.cols}
                        <span className="sr-only"> column{count.cols === 1 ? '' : 's'}</span>
                      </span>
                      <span className="hidden md:block text-right text-sm tabular-nums text-ink-100">
                        {count.rows}
                        <span className="sr-only"> row{count.rows === 1 ? '' : 's'}</span>
                      </span>
                      {/* Under its own column heading the word "Updated" would say it twice. */}
                      <span className="hidden md:block text-right text-xs text-ink-300 tabular-nums">
                        <span className="sr-only">Updated </span>
                        {updatedLabel(t.updatedAt)}
                      </span>

                      <span className="relative z-10 flex justify-end">
                        {canEdit ? (
                          <button
                            className="pressable tap-target p-1.5 rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700"
                            title="Table menu"
                            aria-label={`Table menu: ${t.name}`}
                            aria-haspopup="menu"
                            aria-expanded={menu?.table.id === t.id}
                            onClick={(e) => setMenu({ table: t, anchor: e.currentTarget })}
                          >
                            <DotsThreeIcon size={18} aria-hidden />
                          </button>
                        ) : (
                          <CaretRightIcon size={16} className="text-ink-400" aria-hidden />
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </div>

      <Popover
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        align="right"
        role="menu"
        label={menu ? `Table menu: ${menu.table.name}` : 'Table menu'}
      >
        {menu && (
          <>
            <MenuItem
              icon={PencilSimpleIcon}
              label="Rename / edit"
              onClick={() => {
                setEditTarget(menu.table)
                setMenu(null)
                setFormOpen(true)
              }}
            />
            <MenuItem
              icon={TrashIcon}
              label="Delete table"
              danger
              onClick={() => {
                setDeleteTarget(menu.table)
                setMenu(null)
              }}
            />
          </>
        )}
      </Popover>

      <TableFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        table={editTarget}
        onCreated={(id) => navigate(`/crm/${id}`)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete table"
        message={`Delete "${deleteTarget?.name}"? All of its columns and rows will be deleted too.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!deleteTarget) return
          deleteCrmTable(deleteTarget.id)
          toast.success('Table deleted')
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </Layout>
  )
}
