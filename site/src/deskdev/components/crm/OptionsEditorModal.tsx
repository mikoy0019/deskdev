import { useId, useState } from 'react'
import { CaretDownIcon, CaretUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import Modal from '../Modal'
import { useStore } from '../../store/useStore'
import { OptionChip, SWATCHES } from './columnMeta'
import { m, SPRING, useInputModality } from '../motion'
import type { CrmColumn, CrmSelectOption } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'

function newOptionId(): string {
  return `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Option list manager for select / multi_select columns — label + color per
 * option, add / remove / reorder. Commits once on Save via updateCrmColumn.
 */
export default function OptionsEditorModal({
  open, onClose, column,
}: {
  open: boolean
  onClose: () => void
  column: CrmColumn
}) {
  const updateCrmColumn = useStore((s) => s.updateCrmColumn)
  const [draft, setDraft] = useState<CrmSelectOption[]>([])
  const [newLabel, setNewLabel] = useState('')
  const uid = useId()
  // A moved option glides to its new slot (spatial: you see where it went);
  // moved from the keyboard, it simply jumps.
  const glide = useInputModality() !== 'keyboard'

  useResetOnChange([open, column], () => {
    if (!open) return
    setDraft(column.options.map((o) => ({ ...o })))
    setNewLabel('')
  })

  const patch = (id: string, p: Partial<CrmSelectOption>) => {
    setDraft((d) => d.map((o) => (o.id === id ? { ...o, ...p } : o)))
  }

  const move = (index: number, delta: number) => {
    setDraft((d) => {
      const next = [...d]
      const target = index + delta
      if (target < 0 || target >= next.length) return d
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const cycleColor = (o: CrmSelectOption) => {
    const i = SWATCHES.indexOf(o.color ?? '')
    patch(o.id, { color: SWATCHES[(i + 1) % SWATCHES.length] })
  }

  const addOption = () => {
    const label = newLabel.trim()
    if (!label) return
    setDraft((d) => [
      ...d,
      { id: newOptionId(), label, color: SWATCHES[d.length % SWATCHES.length] },
    ])
    setNewLabel('')
  }

  const save = () => {
    const cleaned = draft.filter((o) => o.label.trim() !== '')
    updateCrmColumn(column.id, { options: cleaned })
    toast.success('Options saved')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Options — ${column.name}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save options
          </button>
        </>
      }
    >
      <div className="space-y-2">
        {draft.length === 0 && (
          <p className="text-sm text-ink-300">No options yet — add the first one below.</p>
        )}

        {draft.map((o, i) => (
          <m.div
            key={o.id}
            layout={glide ? 'position' : false}
            transition={SPRING.ui}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              className="pressable tap-target shrink-0 rounded-full"
              title="Change color"
              aria-label={`Change color: ${o.label || 'option'}`}
              onClick={() => cycleColor(o)}
            >
              <span
                className="block w-6 h-6 rounded-full border border-ink-500"
                style={{ backgroundColor: o.color ?? SWATCHES[8] }}
                aria-hidden
              />
            </button>
            <input
              className="input flex-1 min-w-0 py-1.5"
              aria-label="Option label"
              value={o.label}
              onChange={(e) => patch(o.id, { label: e.target.value })}
            />
            {/* A fixed slot for the preview, so every label field ends on one line. */}
            <span className="max-sm:hidden w-28 shrink-0 min-w-0 flex">
              <OptionChip option={o} />
            </span>
            <div className="flex flex-col pointer-coarse:flex-row">
              <button
                type="button"
                className="pressable tap-target p-0.5 rounded-sm text-ink-300 hover:text-ink-50 disabled:opacity-30"
                disabled={i === 0}
                title="Move up"
                aria-label={`Move up: ${o.label || 'option'}`}
                onClick={() => move(i, -1)}
              >
                <CaretUpIcon size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="pressable tap-target p-0.5 rounded-sm text-ink-300 hover:text-ink-50 disabled:opacity-30"
                disabled={i === draft.length - 1}
                title="Move down"
                aria-label={`Move down: ${o.label || 'option'}`}
                onClick={() => move(i, 1)}
              >
                <CaretDownIcon size={14} aria-hidden />
              </button>
            </div>
            <button
              type="button"
              className="pressable tap-target p-1.5 rounded-lg text-ink-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-700"
              title="Remove option"
              aria-label={`Remove option: ${o.label || 'option'}`}
              onClick={() => setDraft((d) => d.filter((x) => x.id !== o.id))}
            >
              <TrashIcon size={16} aria-hidden />
            </button>
          </m.div>
        ))}

        <div className="pt-3 border-t border-ink-600 space-y-1.5">
          <label htmlFor={`${uid}-new`} className="block text-xs font-medium text-ink-200">New option label</label>
          <div className="flex items-center gap-2">
            <input
              id={`${uid}-new`}
              className="input flex-1 min-w-0 py-1.5"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addOption()
              }}
            />
            <button className="btn-secondary shrink-0 pointer-coarse:min-h-11" onClick={addOption}>
              <PlusIcon size={16} aria-hidden />
              Add
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
