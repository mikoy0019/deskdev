import type { CrmColumnType } from '../../lib/types'

/**
 * A link as people type one: an optional http(s)://, then a host with a dot.
 * No other scheme gets through: the cell opens what it holds as a web link.
 */
const URL_SHAPE = /^(https?:\/\/)?[^\s./:]+\.[^\s]+$/i

/**
 * Why typed text can't be stored in a column of this type, or null when it
 * can. Empty text always can: it clears the cell.
 */
export function draftError(type: CrmColumnType, text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (type === 'number' && !Number.isFinite(Number(trimmed))) return 'Enter a valid number'
  if (type === 'url' && !URL_SHAPE.test(trimmed)) return 'Enter a link, like example.com'
  return null
}
