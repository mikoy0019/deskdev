import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircleIcon, CircleIcon, ProhibitIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { FieldError, LABEL, Notice, radioKeys, useHeldWhile } from '../settings/formKit'
import { useStore } from '../../store/useStore'
import { classNames } from '../../lib/format'
import {
  LEAD_SERVICES, convertedProjectTitle, normalizeService, serviceLabel, starterTasksFor,
} from '../../lib/leads'
import type { ConvertLeadResult, Lead } from '../../lib/types'

const noop = () => {}

/**
 * Convert a lead: pick the service, see what it becomes (the client, the
 * project name, the starter tasks), then run it. The store does the work —
 * the convert_lead RPC in remote mode, the same steps locally — and this
 * lands on the new project. `lead` null = closed.
 */
export default function ConvertLeadModal({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const open = lead !== null
  // Hold the last lead so the panel keeps its content while it leaves.
  const shown = useHeldWhile(lead, open)

  // Keyed by lead: the picked service, the busy flag and the error start fresh.
  if (!shown) return null
  return <ConvertDialog key={shown.id} lead={shown} open={open} onClose={onClose} />
}

function ConvertDialog({ lead, open, onClose: onCloseProp }: { lead: Lead; open: boolean; onClose: () => void }) {
  // One identity for the life of the dialog: Modal re-runs its focus effect
  // (and pulls focus off the radios) whenever onClose changes, and callers
  // pass an inline closure.
  const closeRef = useRef(onCloseProp)
  useEffect(() => { closeRef.current = onCloseProp })
  const onClose = useCallback(() => closeRef.current(), [])
  const navigate = useNavigate()
  const convertLead = useStore((s) => s.convertLead)
  // The client this lands in when the lead is already linked to one, or its
  // email matched one at intake. Their own company name wins (as convert_lead).
  const existing = useStore((s) => s.clients.find((c) => c.id === (lead.clientId ?? lead.existingClientId)))

  const [service, setService] = useState<string | undefined>(() => normalizeService(lead.services?.[0]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Reopened on the same lead: the last attempt's error is stale.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setError(null)
  }
  const alive = useRef(true)
  useEffect(() => {
    // Set on every setup: StrictMode runs the cleanup once before the real mount.
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // The four services, plus anything else the form sent for this lead.
  const known = new Set<string>(LEAD_SERVICES.map((s) => s.key))
  const extra = (lead.services ?? [])
    .map((s) => normalizeService(s))
    .filter((s): s is string => !!s && !known.has(s))
  const options = [
    ...LEAD_SERVICES.map((s) => ({ key: s.key as string, label: s.label as string })),
    ...Array.from(new Set(extra)).map((key) => ({ key, label: serviceLabel(key) })),
  ]

  const company =
    existing?.company?.trim() || existing?.name.trim() || lead.company?.trim() || lead.name.trim() || 'New client'
  // The client record itself: an existing one keeps its name, a new one takes the lead's.
  const clientName = existing?.name.trim() || lead.name.trim() || 'New client'
  const title = convertedProjectTitle(lead, service, company)
  const tasks = starterTasksFor(service, company)

  const submit = async () => {
    if (busy || lead.spam) return
    setBusy(true)
    setError(null)
    let res: ConvertLeadResult
    try {
      res = await convertLead(lead.id, service)
    } catch {
      // Remote mode with no connection: the RPC rejects instead of answering.
      res = { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
    }
    if (!alive.current) return
    setBusy(false)
    if (!res.ok) {
      const message = res.error ?? 'Could not convert the lead'
      setError(message)
      toast.error(message)
      return
    }
    // Named as the Clients list will show it: the person, not the company on the project.
    const made = useStore.getState().clients.find((c) => c.id === res.clientId)
    toast.success(`${made?.name.trim() || clientName} is now a client`)
    onClose()
    if (res.projectId) navigate(`/projects/${res.projectId}`)
    else if (res.clientId) navigate(`/clients/${res.clientId}`)
  }

  return (
    <Modal
      open={open}
      // Not while it runs: the result would land on a closed dialog.
      onClose={busy ? noop : onClose}
      title="Convert to client"
      wide
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={busy || !!lead.spam}
            aria-busy={busy || undefined}
          >
            {busy ? 'Converting…' : 'Convert'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {lead.spam && (
          <Notice tone="danger" icon={ProhibitIcon}>
            This lead is in quarantine. Mark it as not spam before converting it.
          </Notice>
        )}

        <div className="flex flex-col gap-2">
          <span id="convert-service" className={LABEL}>Service</span>
          <div
            role="radiogroup"
            aria-labelledby="convert-service"
            aria-describedby="convert-service-hint"
            className="grid gap-2 sm:grid-cols-2"
            onKeyDown={radioKeys}
          >
            {options.map((o, i) => {
              const checked = service === o.key
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  // One tab stop for the group: the checked radio, or the first.
                  tabIndex={checked || (!service && i === 0) ? 0 : -1}
                  disabled={busy}
                  className={classNames(
                    'pressable flex min-h-10 items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm pointer-coarse:min-h-11',
                    'transition-[border-color,background-color,color] duration-150 ease-[ease]',
                    checked
                      ? 'border-brand-500/60 bg-brand-500/10 text-ink-50'
                      : 'border-ink-600 text-ink-100 hover:border-ink-500 hover:bg-ink-700/50',
                  )}
                  onClick={() => setService(o.key)}
                >
                  {checked
                    ? <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
                    : <CircleIcon size={16} className="shrink-0 text-ink-400" aria-hidden />}
                  <span className="min-w-0 truncate">{o.label}</span>
                </button>
              )
            })}
          </div>
          <p id="convert-service-hint" className="text-[11px] leading-relaxed text-ink-300">
            Sets the project name and the starter tasks.
          </p>
        </div>

        {/* What converting makes: ruled rows, not a box inside the dialog. */}
        <div>
          <h3 className="section-title text-[11px]">This creates</h3>
          <dl className="mt-2 divide-y divide-ink-600 border-y border-ink-600 text-sm">
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-ink-300">Client</dt>
              <dd className="min-w-0 text-ink-50 [overflow-wrap:anywhere]">
                {clientName}
                {company !== clientName && <span className="text-ink-300"> · {company}</span>}
                <span className="ml-2 text-xs text-ink-300">{existing ? 'existing client' : 'new'}</span>
              </dd>
            </div>
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-ink-300">Project</dt>
              <dd className="min-w-0 text-ink-50 [overflow-wrap:anywhere]">{title}</dd>
            </div>
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-ink-300">
                Tasks <span className="tabular-nums text-ink-400">{tasks.length}</span>
              </dt>
              <dd className="min-w-0">
                <ol className="space-y-1 text-ink-100">
                  {tasks.map((t, i) => (
                    <li key={t} className="flex gap-2 [overflow-wrap:anywhere]">
                      <span className="w-4 shrink-0 text-right tabular-nums text-ink-400" aria-hidden>{i + 1}</span>
                      <span className="min-w-0">{t}</span>
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
            The lead is marked won and linked to the client.
          </p>
        </div>

        <FieldError error={error} />
      </div>
    </Modal>
  )
}
