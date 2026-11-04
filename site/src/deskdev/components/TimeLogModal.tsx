import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ClockIcon, TrashIcon } from '@phosphor-icons/react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { DateField } from './pickers'
import { Field, FieldError, INVALID_INPUT } from './tasks/formBits'
import { IndicatorGroup, LayoutIndicator } from './motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, fmtDate, fmtMinutes, isoDate } from '../lib/format'
import type { Task, TimeEntry } from '../lib/types'
import { useResetOnChange } from '../lib/useResetOnChange'

const QUICK_MINUTES = [15, 30, 60, 120]
/** One entry holds at most a day. A slipped digit used to log 1,600 hours. */
const MAX_MINUTES = 24 * 60

/** Log time against a task + review/delete existing entries. */
export default function TimeLogModal({
  open, onClose, task,
}: {
  open: boolean
  onClose: () => void
  task: Task
}) {
  const user = useCurrentUser()
  const users = useStore((s) => s.users)
  const timeEntries = useStore((s) => s.timeEntries)
  const addTimeEntry = useStore((s) => s.addTimeEntry)
  const deleteTimeEntry = useStore((s) => s.deleteTimeEntry)

  const canEdit = can(user, 'tasks', 'edit')

  const [minutes, setMinutes] = useState(30)
  const [entryDate, setEntryDate] = useState<string | undefined>(isoDate())
  const [note, setNote] = useState('')
  const [pendingDelete, setPendingDelete] = useState<TimeEntry | null>(null)
  const [errors, setErrors] = useState<{ minutes?: string; date?: string }>({})

  useResetOnChange([open, task.id], () => {
    if (!open) return
    setMinutes(30)
    setEntryDate(isoDate())
    setNote('')
    setPendingDelete(null)
    setErrors({})
  })

  const entries = useMemo(
    () =>
      timeEntries
        .filter((e) => e.taskId === task.id)
        .sort(
          (a, b) =>
            b.entryDate.localeCompare(a.entryDate) ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [timeEntries, task.id],
  )
  const total = entries.reduce((sum, e) => sum + e.minutes, 0)

  const nameOf = (id?: string): string =>
    users.find((u) => u.id === id)?.fullName ?? 'Unknown'

  const canDelete = (e: TimeEntry): boolean =>
    canEdit && !!user && (user.role === 'admin' || e.userId === user.id)

  const submit = () => {
    // Whole minutes only: 1.5 is refused with the range message rather than
    // rounded behind the person's back (and 0.4 would have logged 0m).
    const whole = Math.round(minutes || 0)
    const nextErrors = {
      minutes:
        whole < 1 && Number.isInteger(minutes || 0)
          ? 'Enter minutes worked'
          : whole > MAX_MINUTES || !Number.isInteger(minutes || 0)
            ? 'Enter 1 to 1,440 minutes'
            : undefined,
      date: entryDate ? undefined : 'Pick a date',
    }
    if (nextErrors.minutes || nextErrors.date || !entryDate) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    addTimeEntry({
      taskId: task.id,
      clientId: task.clientId,
      entryDate,
      minutes: whole,
      note: note.trim() || undefined,
    })
    toast.success('Time logged')
    setMinutes(30)
    setNote('')
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Log time — ${task.title}`}>
        <div className="space-y-5">
          {canEdit && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-ink-200" id="timelog-minutes-label">
                  Minutes
                </span>
                {/* Presets as one segmented control (the selection glides between
                    them), then a free field for anything else. */}
                <div className="flex flex-wrap items-center gap-2">
                  <IndicatorGroup id="timelog-minutes">
                    <div
                      role="group"
                      aria-labelledby="timelog-minutes-label"
                      className="grid grid-cols-4 gap-1 rounded-lg border border-ink-600 bg-ink-850/60 p-1 max-sm:w-full"
                    >
                      {QUICK_MINUTES.map((m) => {
                        const active = minutes === m
                        return (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={active}
                            className={classNames(
                              'pressable relative min-w-12 rounded-md px-3 py-1.5 text-xs font-medium tabular-nums pointer-coarse:min-h-11',
                              active
                                ? 'text-brand-700 dark:text-brand-300'
                                : 'text-ink-200 hover:bg-ink-700 hover:text-ink-50',
                            )}
                            onClick={() => {
                              setMinutes(m)
                              setErrors((x) => ({ ...x, minutes: undefined }))
                            }}
                          >
                            {active && (
                              <LayoutIndicator
                                layoutId="timelog-minutes"
                                radius={6}
                                className="absolute inset-0 border border-brand-500/35 bg-brand-500/12"
                              />
                            )}
                            <span className="relative">{fmtMinutes(m)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </IndicatorGroup>
                  <input
                    type="number"
                    min={1}
                    max={MAX_MINUTES}
                    inputMode="numeric"
                    className={classNames('input w-28 tabular-nums pointer-coarse:min-h-11 max-sm:flex-1', INVALID_INPUT)}
                    value={minutes || ''}
                    placeholder="Custom"
                    aria-label="Custom minutes"
                    aria-invalid={!!errors.minutes || undefined}
                    onChange={(e) => {
                      setMinutes(Number(e.target.value))
                      setErrors((x) => ({ ...x, minutes: undefined }))
                    }}
                  />
                </div>
                {errors.minutes && <FieldError>{errors.minutes}</FieldError>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date" error={errors.date}>
                  <DateField
                    value={entryDate}
                    onChange={(v) => {
                      setEntryDate(v)
                      setErrors((x) => ({ ...x, date: undefined }))
                    }}
                  />
                </Field>
                <Field label={<>Note <span className="text-ink-300 font-normal">(optional)</span></>}>
                  <input
                    className="input w-full"
                    value={note}
                    placeholder="What did you work on?"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
              </div>
              <button className="btn-primary w-full justify-center pointer-coarse:min-h-11" onClick={submit}>
                <ClockIcon size={14} aria-hidden />
                Log time
              </button>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="section-title">Logged entries</h3>
              <span className="text-xs text-ink-300 whitespace-nowrap">
                Total{' '}
                <span className="tabular-nums text-ink-100">
                  {fmtMinutes(total)}
                </span>
              </span>
            </div>
            {entries.length === 0 ? (
              <div className="text-sm text-ink-300 text-center py-6 border border-dashed border-ink-600 rounded-lg">
                No time logged on this task yet.
              </div>
            ) : (
              <div className="card divide-y divide-ink-600 overflow-hidden">
                {entries.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium tabular-nums text-ink-50">
                          {fmtMinutes(e.minutes)}
                        </span>
                        <span className="min-w-0 text-xs text-ink-300 [overflow-wrap:anywhere]">
                          {nameOf(e.userId)} · <span className="tabular-nums">{fmtDate(e.entryDate)}</span>
                        </span>
                      </div>
                      {e.note && (
                        <div className="text-xs text-ink-200 mt-0.5 truncate" title={e.note}>{e.note}</div>
                      )}
                    </div>
                    {canDelete(e) && (
                      <button
                        className="pressable tap-target p-1.5 rounded-md text-ink-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-700 shrink-0 pointer-coarse:-my-2.5"
                        title="Delete entry"
                        aria-label="Delete entry"
                        onClick={() => setPendingDelete(e)}
                      >
                        <TrashIcon size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete time entry"
        message={
          pendingDelete
            ? `Delete ${fmtMinutes(pendingDelete.minutes)} logged on ${fmtDate(pendingDelete.entryDate)}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingDelete) return
          deleteTimeEntry(pendingDelete.id)
          toast.success('Entry deleted')
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  )
}
