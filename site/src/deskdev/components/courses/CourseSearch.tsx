import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GraduationCapIcon, MagnifyingGlassIcon, StackIcon, VideoCameraIcon, XIcon } from '@phosphor-icons/react'
import { useStore } from '../../store/useStore'
import { classNames } from '../../lib/format'
import { useResetOnChange } from '../../lib/useResetOnChange'

type Hit = {
  id: string
  kind: 'course' | 'module' | 'topic'
  label: string
  /** Where it lives, e.g. "Wordpress + Elementor › Basics". */
  context: string
  courseId: string
  /** Set for topic hits with a video, so Enter opens the player. */
  topicId?: string
  score: number
}

const KIND_META = {
  course: { icon: GraduationCapIcon, label: 'Course' },
  module: { icon: StackIcon, label: 'Module' },
  topic: { icon: VideoCameraIcon, label: 'Topic' },
} as const

const MAX_HITS = 8

/**
 * Rank a candidate against the query. Prefix beats word-start beats substring,
 * so typing "elem" surfaces "Elementor Basics" above "Intro to Elementor".
 */
function scoreMatch(haystack: string, needle: string): number {
  const h = haystack.toLowerCase()
  const i = h.indexOf(needle)
  if (i === -1) return 0
  if (i === 0) return 3
  return /\s|[-_/]/.test(h[i - 1] ?? '') ? 2 : 1
}

/** Search across courses, modules, and topics with keyboard-driven suggestions. */
export default function CourseSearch() {
  const navigate = useNavigate()
  const courses = useStore((s) => s.courses)
  const courseModules = useStore((s) => s.courseModules)
  const courseTopics = useStore((s) => s.courseTopics)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []

    const courseById = new Map(courses.map((c) => [c.id, c]))
    const moduleById = new Map(courseModules.map((m) => [m.id, m]))
    const out: Hit[] = []

    for (const c of courses) {
      const score = Math.max(scoreMatch(c.title, q), scoreMatch(c.description ?? '', q) ? 1 : 0)
      if (score) out.push({ id: c.id, kind: 'course', label: c.title, context: 'Course', courseId: c.id, score: score + 0.3 })
    }
    for (const m of courseModules) {
      const score = scoreMatch(m.title, q)
      if (!score) continue
      const course = courseById.get(m.courseId)
      if (!course) continue
      out.push({ id: m.id, kind: 'module', label: m.title, context: course.title, courseId: course.id, score: score + 0.15 })
    }
    for (const t of courseTopics) {
      const score = Math.max(scoreMatch(t.title, q), scoreMatch(t.summary ?? '', q) || scoreMatch(t.notes ?? '', q) ? 1 : 0)
      if (!score) continue
      const mod = moduleById.get(t.moduleId)
      const course = mod ? courseById.get(mod.courseId) : undefined
      if (!mod || !course) continue
      out.push({
        id: t.id, kind: 'topic', label: t.title,
        context: `${course.title} › ${mod.title}`,
        courseId: course.id, topicId: t.id, score,
      })
    }

    return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, MAX_HITS)
  }, [query, courses, courseModules, courseTopics])

  // Reset the highlight whenever the result set changes under it.
  useResetOnChange([query], () => setActive(0))

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = (hit: Hit) => {
    setOpen(false)
    setQuery('')
    // Topic hits deep-link so the course page can scroll to and open it.
    navigate(hit.topicId ? `/courses/${hit.courseId}?topic=${hit.topicId}` : `/courses/${hit.courseId}`)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (!hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) go(hit)
    }
  }

  const showPanel = open && query.trim().length >= 2

  return (
    <div ref={rootRef} className="relative w-full max-w-sm">
      <MagnifyingGlassIcon
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden
      />
      <input
        ref={inputRef}
        className="input w-full pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
        type="search"
        enterKeyHint="search"
        aria-label="Search courses"
        value={query}
        placeholder="Search courses, modules, videos…"
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="course-search-results"
        aria-autocomplete="list"
        // Focus stays in the field while the arrows move the highlight: this
        // is what tells a screen reader which result is current.
        aria-activedescendant={showPanel && hits[active] ? `course-search-option-${active}` : undefined}
      />
      {query && (
        <button
          type="button"
          className="pressable tap-target absolute right-1 top-1/2 -translate-y-1/2 inline-flex size-7 items-center justify-center rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="Clear search"
          onClick={() => { setQuery(''); inputRef.current?.focus() }}
        >
          <XIcon size={14} aria-hidden />
        </button>
      )}

      {/* No open/close motion: it follows typing (keyboard-initiated, many a
          day) — the list is simply there with the results. */}
      {showPanel && (
        <div
          id="course-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute z-40 mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-800 p-1 shadow-(--shadow-3) max-h-80 overflow-y-auto overscroll-contain"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-xs text-ink-300 [overflow-wrap:anywhere]">No matches for “{query.trim()}”.</p>
          ) : (
            hits.map((hit, i) => {
              const { icon: Icon, label: kindLabel } = KIND_META[hit.kind]
              return (
                <button
                  type="button"
                  key={`${hit.kind}-${hit.id}`}
                  id={`course-search-option-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={classNames(
                    'pressable w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 pointer-coarse:py-3 text-left',
                    i === active ? 'bg-ink-700' : 'hover:bg-ink-700/60',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                >
                  <Icon size={16} className="text-ink-400 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-ink-50 truncate">{hit.label}</span>
                    <span className="block text-[11px] text-ink-300 truncate">{hit.context}</span>
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-300 shrink-0">
                    {kindLabel}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
