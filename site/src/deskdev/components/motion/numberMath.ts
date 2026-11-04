/** Pure helpers behind AnimatedNumber. */

/** Decimal places the target value is shown with (capped at 4). */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0
  const text = String(value)
  const exp = text.match(/e-(\d+)$/)
  if (exp) return Math.min(4, Number(exp[1]))
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : Math.min(4, text.length - dot - 1)
}

/** Locale grouping with the target's own precision ("1,250", "47.2"). */
export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Should a change from `from` to `to` count? Only a real change of a finite
 * number does — a refetch that lands on the same figure stays still.
 */
export function shouldCount(from: number | null, to: number): boolean {
  return from !== null && Number.isFinite(from) && Number.isFinite(to) && from !== to
}
