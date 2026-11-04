import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileTextIcon } from '@phosphor-icons/react'
import Modal from './Modal'
import { ClientSelect, DateField } from './pickers'
import { useStore } from '../store/useStore'
import { buildEodReport } from '../lib/eod'
import { fmtMinutes, isoDate } from '../lib/format'
import { CopyGlyph, FormField, useCopied } from './settings/formKit'

/** The shared End-of-Day report UX — live preview + copy to clipboard. */
export default function EodReportModal({
  open, onClose, defaultClientId, defaultDate,
}: {
  open: boolean
  onClose: () => void
  defaultClientId?: string
  /** YYYY-MM-DD — defaults to today */
  defaultDate?: string
}) {
  const clients = useStore((s) => s.clients)
  const tasks = useStore((s) => s.tasks)
  const taskActivity = useStore((s) => s.taskActivity)
  const events = useStore((s) => s.events)
  const timeEntries = useStore((s) => s.timeEntries)
  const users = useStore((s) => s.users)
  const saveEodReport = useStore((s) => s.saveEodReport)

  const [clientId, setClientId] = useState('')
  const [date, setDate] = useState(isoDate())

  // Re-seed from the defaults each time the modal opens (or they change while
  // open) — adjusted during render so the first open frame is already right.
  const seedKey = open ? `${defaultClientId ?? ''}|${defaultDate ?? ''}` : null
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (seedKey !== seededFor) {
    setSeededFor(seedKey)
    if (seedKey !== null) {
      setClientId(defaultClientId ?? '')
      setDate(defaultDate ?? isoDate())
    }
  }

  const client = clients.find((c) => c.id === clientId)

  const report = useMemo(() => {
    if (!client) return ''
    return buildEodReport({
      client,
      date,
      tasks,
      activity: taskActivity,
      events,
      timeEntries,
      users,
    })
  }, [client, date, tasks, taskActivity, events, timeEntries, users])

  const totalMinutes = useMemo(
    () =>
      timeEntries
        .filter((e) => e.clientId === clientId && e.entryDate === date)
        .reduce((sum, e) => sum + e.minutes, 0),
    [timeEntries, clientId, date],
  )

  const [copied, flashCopied] = useCopied()

  const copy = async () => {
    if (!report || !clientId) return
    // Copying is the deliberate "I'm using this report" action, so it's also
    // when we persist it (upsert per author/client/day) — which is what lets
    // n8n log/email EOD reports downstream.
    saveEodReport({ clientId, reportDate: date, content: report, totalMinutes })
    try {
      await navigator.clipboard.writeText(report)
      flashCopied()
      toast.success('Report copied & saved')
    } catch {
      toast.error('Saved, but could not copy to clipboard')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="End of Day Report"
      wide
      footer={
        <>
          {/* Phones: the total takes its own line above the two actions. */}
          <span className="mr-auto text-xs text-ink-300 max-sm:flex-[1_0_100%]!">
            Hours logged:{' '}
            <span className="tabular-nums text-ink-100">
              {fmtMinutes(totalMinutes)}
            </span>
          </span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!report}
            onClick={copy}
          >
            <CopyGlyph copied={copied} />
            Copy report
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <FormField label="Client">
            <ClientSelect value={clientId} onChange={setClientId} autoFocus />
          </FormField>
          <FormField label="Date">
            <DateField value={date} onChange={(v) => setDate(v ?? isoDate())} />
          </FormField>
        </div>

        {report ? (
          // Keyed by client + day: a different report fades in (120ms) rather
          // than swapping text under the reader's eye; edits to the same one don't.
          <pre
            key={`${clientId}|${date}`}
            tabIndex={0}
            aria-label="Report preview"
            className="max-h-80 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-900/60 p-4 font-mono text-xs leading-relaxed text-ink-100 shadow-(--shadow-inset) [overflow-wrap:anywhere] animate-route"
          >
            {report}
          </pre>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-500 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-1)" aria-hidden>
              <FileTextIcon size={18} />
            </span>
            <p className="text-sm text-ink-300">Pick a client to preview the report.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
