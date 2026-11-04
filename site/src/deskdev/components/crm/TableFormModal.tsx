import { useId, useState } from 'react'
import { toast } from 'sonner'
import { WarningCircleIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { ClientSelect } from '../pickers'
import { useStore } from '../../store/useStore'
import { classNames } from '../../lib/format'
import { SWATCHES, TABLE_SWATCHES } from './columnMeta'
import { ColorSwatches } from '../calendar/calendarShared'
import type { CrmTable } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'

/** Create / edit modal for a CRM table — name, color swatch, optional client. */
export default function TableFormModal({
  open, onClose, table, onCreated,
}: {
  open: boolean
  onClose: () => void
  /** When set the modal edits this table instead of creating one */
  table?: CrmTable | null
  onCreated?: (id: string) => void
}) {
  const addCrmTable = useStore((s) => s.addCrmTable)
  const updateCrmTable = useStore((s) => s.updateCrmTable)

  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(SWATCHES[0])
  const [clientId, setClientId] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const uid = useId()

  useResetOnChange([open, table], () => {
    if (!open) return
    setName(table?.name ?? '')
    setColor(table?.color ?? SWATCHES[0])
    setClientId(table?.clientId ?? '')
    setNameError(null)
  })

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      // Said where it went wrong, under the field — not in a toast across the screen.
      setNameError('Table name is required')
      document.getElementById(`${uid}-name`)?.focus()
      return
    }
    if (table) {
      updateCrmTable(table.id, {
        name: trimmed,
        color,
        clientId: clientId || undefined,
      })
      toast.success('Table updated')
    } else {
      const id = addCrmTable({
        name: trimmed,
        color,
        clientId: clientId || undefined,
      })
      toast.success('Table created')
      onCreated?.(id)
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={table ? 'Edit table' : 'New table'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit}>
            {table ? 'Save changes' : 'Create table'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-name`} className="block text-xs font-medium text-ink-200">Name *</label>
          <input
            id={`${uid}-name`}
            className={classNames('input w-full', nameError && 'border-rose-500! focus:ring-rose-500/20!')}
            value={name}
            autoFocus
            placeholder="e.g. Leads Tracker"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${uid}-name-error` : undefined}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          {nameError && (
            <p id={`${uid}-name-error`} className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400 animate-fade">
              <WarningCircleIcon size={14} className="shrink-0" aria-hidden />
              {nameError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <span id={`${uid}-color`} className="block text-xs font-medium text-ink-200">Color</span>
          <ColorSwatches swatches={TABLE_SWATCHES} value={color} onChange={setColor} labelledBy={`${uid}-color`} />
        </div>

        <label className="block space-y-1.5">
          <span className="block text-xs font-medium text-ink-200">Client (optional)</span>
          <ClientSelect value={clientId} onChange={setClientId} allowNone />
        </label>
      </div>
    </Modal>
  )
}
