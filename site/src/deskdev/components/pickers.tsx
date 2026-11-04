import { useStore } from '../store/useStore'
import { classNames } from '../lib/format'
import { activeUsers } from '../lib/permissions'
import type {
  Priority, ProjectStatus, TaskStatus, Engagement, Recurrence, ClientStatus,
} from '../lib/types'

// Shared form controls for feature pages — all controlled, styled like .input.
// Selects that allow an empty choice emit `undefined` (not '') so results can
// be passed straight into store patches; ClientSelect uses '' for all/none so
// it also works as a filter value.

const selectClass = 'input w-full'

// ─── ClientSelect ────────────────────────────────────────────────────────────

const statusDot: Record<ClientStatus, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  ended: 'bg-ink-400',
}

export function ClientSelect({
  value, onChange, allowAll, allowNone, autoFocus,
}: {
  /** Client id, or '' for the all/none option */
  value: string
  onChange: (clientId: string) => void
  /** Adds an "All clients" option (value '') — for filters */
  allowAll?: boolean
  /** Adds a "No client" option (value '') — for optional fields */
  allowNone?: boolean
  autoFocus?: boolean
}) {
  const clients = useStore((s) => s.clients)
  const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name))
  const selected = clients.find((c) => c.id === value)
  return (
    <div className="relative">
      {selected && (
        <span
          className={classNames(
            'absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none',
            statusDot[selected.status],
          )}
          aria-hidden
        />
      )}
      <select
        className={classNames(selectClass, selected && 'pl-7')}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowAll && <option value="">All clients</option>}
        {!allowAll && allowNone && <option value="">No client</option>}
        {!allowAll && !allowNone && value === '' && (
          <option value="" disabled>
            Select a client…
          </option>
        )}
        {sorted.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.company ? ` — ${c.company}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── AssigneeSelect ──────────────────────────────────────────────────────────

export function AssigneeSelect({
  value, onChange, allowUnassigned,
}: {
  value: string | undefined
  onChange: (userId: string | undefined) => void
  allowUnassigned?: boolean
}) {
  const users = useStore((s) => s.users)
  // Offboarded people are not offered. One who still holds this record stays
  // listed (and says so), so opening the form doesn't silently reassign it.
  const sorted = [...activeUsers(users), ...users.filter((u) => u.deactivatedAt && u.id === value)].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  )
  return (
    <select
      className={selectClass}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {allowUnassigned && <option value="">Unassigned</option>}
      {sorted.map((u) => (
        <option key={u.id} value={u.id}>
          {u.fullName} ({u.deactivatedAt ? 'deactivated' : u.role})
        </option>
      ))}
    </select>
  )
}

// ─── ProjectCategorySelect ───────────────────────────────────────────────────

export function ProjectCategorySelect({
  clientId, value, onChange, allowNone,
}: {
  /** Categories are scoped per client — disabled with a hint until one is chosen */
  clientId: string | undefined
  value: string | undefined
  onChange: (categoryId: string | undefined) => void
  allowNone?: boolean
}) {
  const projectCategories = useStore((s) => s.projectCategories)
  if (!clientId) {
    return (
      <select className={classNames(selectClass, 'opacity-60')} value="" disabled>
        <option value="">Select a client first</option>
      </select>
    )
  }
  const options = projectCategories
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  return (
    <select
      className={selectClass}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {allowNone && <option value="">No category</option>}
      {!allowNone && options.length === 0 && (
        <option value="" disabled>
          No categories yet
        </option>
      )}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

// ─── ClientCategorySelect ────────────────────────────────────────────────────

export function ClientCategorySelect({
  value, onChange, allowNone,
}: {
  value: string | undefined
  onChange: (categoryId: string | undefined) => void
  allowNone?: boolean
}) {
  const clientCategories = useStore((s) => s.clientCategories)
  const options = [...clientCategories].sort((a, b) => a.sortOrder - b.sortOrder)
  return (
    <select
      className={selectClass}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {allowNone && <option value="">No category</option>}
      {!allowNone && options.length === 0 && (
        <option value="" disabled>
          No categories yet
        </option>
      )}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

// ─── Enum selects ────────────────────────────────────────────────────────────

function EnumSelect<T extends string>({
  value, onChange, options,
}: {
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <select
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

const PRIORITY_OPTIONS: [Priority, string][] = [
  ['low', 'Low'],
  ['med', 'Medium'],
  ['high', 'High'],
]

export function PrioritySelect({
  value, onChange,
}: {
  value: Priority
  onChange: (v: Priority) => void
}) {
  return <EnumSelect value={value} onChange={onChange} options={PRIORITY_OPTIONS} />
}

const PROJECT_STATUS_OPTIONS: [ProjectStatus, string][] = [
  ['backlog', 'Backlog'],
  ['planning', 'Planning'],
  ['in_progress', 'In Progress'],
  ['waiting', 'Waiting'],
  ['done', 'Done'],
]

export function ProjectStatusSelect({
  value, onChange, allowed,
}: {
  value: ProjectStatus
  onChange: (v: ProjectStatus) => void
  /** The statuses the project's stage allows (lib/projectPhase statusesFor); the current one always shows. */
  allowed?: readonly ProjectStatus[]
}) {
  const options = allowed ? PROJECT_STATUS_OPTIONS.filter(([v]) => v === value || allowed.includes(v)) : PROJECT_STATUS_OPTIONS
  return <EnumSelect value={value} onChange={onChange} options={options} />
}

const TASK_STATUS_OPTIONS: [TaskStatus, string][] = [
  ['todo', 'To Do'],
  ['in_progress', 'In Progress'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
]

export function TaskStatusSelect({
  value, onChange,
}: {
  value: TaskStatus
  onChange: (v: TaskStatus) => void
}) {
  return <EnumSelect value={value} onChange={onChange} options={TASK_STATUS_OPTIONS} />
}

const ENGAGEMENT_OPTIONS: [Engagement, string][] = [
  ['full_time', 'Full Time'],
  ['part_time', 'Part Time'],
  ['gig_on_call', 'Gig — On Call'],
]

export function EngagementSelect({
  value, onChange,
}: {
  value: Engagement
  onChange: (v: Engagement) => void
}) {
  return <EnumSelect value={value} onChange={onChange} options={ENGAGEMENT_OPTIONS} />
}

const RECURRENCE_OPTIONS: [Recurrence, string][] = [
  ['none', 'Does not repeat'],
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
]

export function RecurrenceSelect({
  value, onChange,
}: {
  value: Recurrence
  onChange: (v: Recurrence) => void
}) {
  return <EnumSelect value={value} onChange={onChange} options={RECURRENCE_OPTIONS} />
}

// ─── Date fields ─────────────────────────────────────────────────────────────

export function DateField({
  value, onChange, min,
}: {
  /** YYYY-MM-DD */
  value?: string
  onChange: (v: string | undefined) => void
  min?: string
}) {
  return (
    <input
      type="date"
      className="input w-full"
      value={value ?? ''}
      min={min}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  )
}

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DateTimeField({
  valueIso, onChange,
}: {
  /** Full ISO timestamp (what the store expects for startsAt/endsAt) */
  valueIso?: string
  onChange: (iso: string | undefined) => void
}) {
  return (
    <input
      type="datetime-local"
      className="input w-full"
      value={toLocalInput(valueIso)}
      onChange={(e) =>
        onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)
      }
    />
  )
}
