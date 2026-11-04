export function fmtMoney(n?: number): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/** A 0–1 ratio (or a raw %) as a rounded percentage. `fmtPercent(0.42)` → "42%". */
export function fmtPercent(ratio?: number, digits = 0): string {
  if (ratio == null || Number.isNaN(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

/** A duration in ms as a compact human string: "14m", "2h 15m", "3d 4h". */
export function fmtDuration(ms?: number | null): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/** Thousands-separated integer. `fmtNumber(1200)` → "1,200". */
export function fmtNumber(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

export function fmtDate(iso?: string): string {
  if (!iso) return '—'
  // Parse date-only strings as local dates, not UTC midnight
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function fmtRelative(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso).getTime()
  const now = Date.now()
  const diff = d - now
  const abs = Math.abs(diff)
  const day = 24 * 60 * 60 * 1000
  const hr = 60 * 60 * 1000
  const min = 60 * 1000
  const sign = diff < 0 ? -1 : 1
  if (abs < min) return 'now'
  if (abs < hr) return `${sign < 0 ? '' : 'in '}${Math.round(abs / min)}m${sign < 0 ? ' ago' : ''}`
  if (abs < day) return `${sign < 0 ? '' : 'in '}${Math.round(abs / hr)}h${sign < 0 ? ' ago' : ''}`
  const days = Math.round(abs / day)
  return `${sign < 0 ? '' : 'in '}${days}d${sign < 0 ? ' ago' : ''}`
}

/** 90 -> "1h 30m", 45 -> "45m", 120 -> "2h" */
export function fmtMinutes(mins: number): string {
  const total = Math.max(0, Math.round(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function fmtTime(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * A time range, compacted so it fits a narrow card without being truncated.
 * "10:00 AM – 11:00 AM" → "10:00 – 11:00 AM": the meridiem is stated once when both ends
 * share it. Nothing is lost — it just stops the range wrapping or getting clipped in the
 * seven-column meetings board.
 */
export function fmtTimeRangeParts(
  startIso?: string,
  endIso?: string,
): { start: string; end?: string } {
  const start = fmtTime(startIso)
  if (!endIso) return { start }
  const end = fmtTime(endIso)

  const m = /\s(AM|PM)$/i.exec(start)
  const n = /\s(AM|PM)$/i.exec(end)
  // Same half of the day → say it once: "10:00 – 11:00 AM".
  if (m && n && m[1].toUpperCase() === n[1].toUpperCase()) {
    return { start: start.slice(0, m.index), end }
  }
  return { start, end }
}

export function fmtTimeRange(startIso?: string, endIso?: string): string {
  const { start, end } = fmtTimeRangeParts(startIso, endIso)
  return end ? `${start} – ${end}` : start
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  return `${fmtDate(iso)}, ${fmtTime(iso)}`
}

/** Local-timezone calendar date as 'YYYY-MM-DD'. */
export function isoDate(d: Date | string = new Date()): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const x = typeof d === 'string' ? new Date(d) : d
  const y = x.getFullYear()
  const mo = String(x.getMonth() + 1).padStart(2, '0')
  const da = String(x.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

export function daysUntil(iso?: string): number | null {
  if (!iso) return null
  const d = new Date(iso).getTime()
  const now = Date.now()
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24))
}

export function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ')
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

const BRAND_COLORS = [
  'bg-rose-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-sky-500', 'bg-violet-500', 'bg-fuchsia-500',
  'bg-teal-500', 'bg-orange-500',
]

export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return BRAND_COLORS[Math.abs(h) % BRAND_COLORS.length]
}
