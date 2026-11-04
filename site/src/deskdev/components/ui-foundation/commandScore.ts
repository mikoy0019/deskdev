/**
 * Ranking for the command palette's actions. Lower is better; null = no match.
 *
 * The label decides first, keywords only help: a loose subsequence match over
 * label + keywords used to put "#announcements" ahead of "Compact density"
 * for the query "compact". Tiers:
 *
 *   0  the label starts with the query
 *   1  a word of the label starts with the query
 *   2  the label contains the query
 *   3  every word of the query starts a word of the label or the keywords
 *   4  the label matches as a tight subsequence (typo tolerance: "prjcts")
 */
/** A score from the first tier: the label itself starts with the query. */
export const isLabelPrefix = (score: number): boolean => score < 1

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Gaps between the matched characters of a subsequence; null when it isn't one. */
function subsequenceGaps(query: string, text: string): number | null {
  let from = 0
  let gaps = 0
  for (const ch of query) {
    const found = text.indexOf(ch, from)
    if (found === -1) return null
    gaps += found - from
    from = found + 1
  }
  return gaps
}

export function scoreCommand(query: string, label: string, keywords = ''): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const l = label.toLowerCase()
  // Shorter labels first within a tier: "Tasks" before "Tasks archive".
  const length = l.length * 0.001

  if (l.startsWith(q)) return length
  const labelWords = words(l)
  if (labelWords.some((w) => w.startsWith(q))) return 1 + length
  if (l.includes(q)) return 2 + length

  const all = [...labelWords, ...words(keywords)]
  const tokens = words(q)
  if (tokens.length > 0 && tokens.every((t) => all.some((w) => w.startsWith(t)))) return 3 + length

  // Subsequence over the label alone, and only a tight one: at most one
  // skipped character per typed character, starting on the label's first
  // letter, so three letters scattered across a long label don't count.
  const compact = q.replace(/\s+/g, '')
  const bare = labelWords.join(' ')
  const gaps = compact.length >= 3 && bare[0] === compact[0] ? subsequenceGaps(compact, bare) : null
  if (gaps !== null && gaps <= compact.length) return 4 + gaps * 0.01 + length

  return null
}
