import {
  CalendarBlankIcon, CaretCircleDownIcon, CheckSquareIcon, FunctionIcon, HashIcon, type Icon, LinkSimpleIcon,
  TagIcon, TextTIcon, UserIcon,
} from '@phosphor-icons/react'
import type { CrmCellValue, CrmColumnType, CrmSelectOption } from '../../lib/types'

// ─── Column type metadata ────────────────────────────────────────────────────

export const COLUMN_TYPES: { type: CrmColumnType; label: string; icon: Icon }[] = [
  { type: 'text', label: 'Text', icon: TextTIcon },
  { type: 'number', label: 'Number', icon: HashIcon },
  { type: 'select', label: 'Select', icon: CaretCircleDownIcon },
  { type: 'multi_select', label: 'Multi-select', icon: TagIcon },
  { type: 'date', label: 'Date', icon: CalendarBlankIcon },
  { type: 'checkbox', label: 'Checkbox', icon: CheckSquareIcon },
  { type: 'url', label: 'URL', icon: LinkSimpleIcon },
  { type: 'person', label: 'Person', icon: UserIcon },
  { type: 'formula', label: 'Formula', icon: FunctionIcon },
]

/** Default and limits of a column's width in px (057). */
export const COLUMN_WIDTH = { default: 180, min: 80, max: 800 } as const

export function clampWidth(px: number): number {
  return Math.round(Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, px)))
}

export function columnTypeMeta(type: CrmColumnType) {
  return COLUMN_TYPES.find((t) => t.type === type) ?? COLUMN_TYPES[0]
}

/** Shared color swatches for tables and select options. */
export const TABLE_SWATCHES = [
  { value: '#0ea5e9', name: 'Sky' },
  { value: '#8b5cf6', name: 'Violet' },
  { value: '#10b981', name: 'Green' },
  { value: '#f59e0b', name: 'Amber' },
  { value: '#f43f5e', name: 'Rose' },
  { value: '#ec4899', name: 'Pink' },
  { value: '#14b8a6', name: 'Teal' },
  { value: '#f97316', name: 'Orange' },
  { value: '#64748b', name: 'Slate' },
]
export const SWATCHES = TABLE_SWATCHES.map((s) => s.value)

// ─── Defensive cell-value parsing ────────────────────────────────────────────
// Cell values may be legacy leftovers from a column type change — every parser
// accepts any CrmCellValue and degrades gracefully instead of crashing.

export function asText(v: CrmCellValue | undefined): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ')
  return ''
}

export function asNumber(v: CrmCellValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v)
  }
  return null
}

export function asOptionId(v: CrmCellValue | undefined): string | null {
  if (typeof v === 'string' && v) return v
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0]
  return null
}

export function asOptionIds(v: CrmCellValue | undefined): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v) return [v]
  return []
}

export function asBool(v: CrmCellValue | undefined): boolean {
  return v === true || v === 'true' || v === 1
}

export function asDateString(v: CrmCellValue | undefined): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return null
}

// ─── OptionChip ──────────────────────────────────────────────────────────────

/** Colored chip for a select/multi_select option — neutral when no color. */
export function OptionChip({
  option, fallbackLabel,
}: {
  option?: CrmSelectOption
  fallbackLabel?: string
}) {
  const label = option?.label ?? fallbackLabel ?? '—'
  const color = option?.color
  if (!color) {
    return (
      <span className="chip max-w-full bg-ink-700 text-ink-100 border-ink-500">
        <span className="truncate">{label}</span>
      </span>
    )
  }
  // The raw swatch as text failed AA on its own tint (amber 2.1:1 in light).
  // Half-mixed toward the strongest ink, it darkens in light and lightens in
  // dark, and clears 4.5:1 for every swatch in both themes.
  return (
    <span
      className="chip max-w-full"
      style={{
        backgroundColor: `${color}26`,
        borderColor: `${color}4d`,
        color: `color-mix(in oklab, ${color} 50%, rgb(var(--ink-50)))`,
      }}
    >
      <span className="truncate">{label}</span>
    </span>
  )
}
