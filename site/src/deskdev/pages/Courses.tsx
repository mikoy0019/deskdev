import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CaretRightIcon, GraduationCapIcon, ListBulletsIcon, PencilSimpleIcon, PlusIcon, StackIcon,
  TrashIcon, VideoCameraIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import ConfirmDialog from '../components/ConfirmDialog'
import CourseModal from '../components/courses/CourseModal'
import CourseSearch from '../components/courses/CourseSearch'
import { EmptyState } from '../components/ui-foundation'
import { Skeleton, useStagger } from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames } from '../lib/format'
import type { Course } from '../lib/types'

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * "Open course" as the row's visible cue. The whole row is the link (its
 * title is the stretched anchor, so the accessible name is the course), so
 * this is decoration for the eye and hidden from assistive tech.
 */
function OpenCue({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={classNames(
        'inline-flex items-center gap-1 text-xs font-medium text-ink-300 transition-colors duration-150 group-hover:text-ink-50',
        className,
      )}
    >
      Open course
      <CaretRightIcon size={14} className="shrink-0" />
    </span>
  )
}

/** The library index while the store loads: rows shaped like the real ones. */
function CoursesSkeleton() {
  return (
    <ul className="card divide-y divide-ink-600 overflow-hidden" aria-busy="true" aria-label="Loading courses">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-4 px-5 py-4">
          <Skeleton w={16} h={10} rounded="sm" className="mt-1" />
          <div className="space-y-2">
            <Skeleton w={i % 2 ? '38%' : '52%'} h={13} rounded="sm" />
            <Skeleton w={i % 2 ? '70%' : '61%'} h={10} rounded="sm" />
          </div>
          <Skeleton w={180} h={10} rounded="sm" className="mt-1 max-sm:hidden" />
        </li>
      ))}
    </ul>
  )
}

/**
 * Training library index — one row per course, numbered in library order,
 * with its module / topic / SOP counts. A list, not a grid of cards: a course
 * is something you scan for and open, and the counts line up as a column.
 */
export default function Courses() {
  const user = useCurrentUser()
  const canEdit = can(user, 'courses', 'edit')

  const courses = useStore((s) => s.courses)
  const courseModules = useStore((s) => s.courseModules)
  const courseTopics = useStore((s) => s.courseTopics)
  const deleteCourse = useStore((s) => s.deleteCourse)
  const hydrated = useStore((s) => s.hydrated)

  const [editing, setEditing] = useState<Course | 'new' | null>(null)
  const [confirming, setConfirming] = useState<Course | null>(null)
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('courses-list')

  // Counts per course in one pass — avoids an O(courses × modules) scan per card.
  const stats = useMemo(() => {
    const moduleIdsByCourse = new Map<string, string[]>()
    for (const m of courseModules) {
      const list = moduleIdsByCourse.get(m.courseId)
      if (list) list.push(m.id)
      else moduleIdsByCourse.set(m.courseId, [m.id])
    }
    const topicsByModule = new Map<string, { topics: number; sops: number }>()
    for (const t of courseTopics) {
      const cur = topicsByModule.get(t.moduleId) ?? { topics: 0, sops: 0 }
      cur.topics += 1
      if (t.sopVideoUrl) cur.sops += 1
      topicsByModule.set(t.moduleId, cur)
    }
    const out = new Map<string, { modules: number; topics: number; sops: number }>()
    for (const c of courses) {
      const ids = moduleIdsByCourse.get(c.id) ?? []
      let topics = 0
      let sops = 0
      for (const id of ids) {
        const s = topicsByModule.get(id)
        if (s) { topics += s.topics; sops += s.sops }
      }
      out.set(c.id, { modules: ids.length, topics, sops })
    }
    return out
  }, [courses, courseModules, courseTopics])

  const ordered = useMemo(
    () => courses.slice().sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    [courses],
  )

  return (
    <Layout title="Courses" subtitle="Training library and standard operating procedures">
      {/* Phones: count and New course share the first row; the search takes
          the whole second row (its placeholder was clipped beside the count). */}
      {/* An empty library has nothing to count or search, and the empty state
          below carries the one New course action. */}
      {!(hydrated && ordered.length === 0) && (
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* While the library loads, the count is a placeholder too — "No
            courses yet." would be a claim the store can't make yet. */}
        {!hydrated && ordered.length === 0 ? (
          // Sized like "4 courses" so the search beside it doesn't shift on load.
          <Skeleton w={62} h={12} rounded="sm" />
        ) : (
          <p className="text-sm text-ink-300 shrink-0 tabular-nums">
            {`${ordered.length} course${ordered.length === 1 ? '' : 's'}`}
          </p>
        )}
        <div className="flex min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
          <CourseSearch />
        </div>
        {canEdit && (
          <button className="btn-primary ml-auto" onClick={() => setEditing('new')}>
            <PlusIcon size={16} aria-hidden /> New course
          </button>
        )}
      </div>
      )}

      {!hydrated && ordered.length === 0 ? (
        <CoursesSkeleton />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={GraduationCapIcon}
          title="No courses yet"
          description={
            canEdit
              ? 'Create a course, add modules and topics, then attach an SOP video to any topic.'
              : 'Your admin has not published any training courses yet.'
          }
          action={
            canEdit ? (
              <button className="btn-primary" onClick={() => setEditing('new')}>
                <PlusIcon size={16} aria-hidden />
                New course
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul
          ref={attachStagger}
          className={classNames('card divide-y divide-ink-600 overflow-hidden', staggerClass)}
        >
          {ordered.map((course, i) => {
            const s = stats.get(course.id) ?? { modules: 0, topics: 0, sops: 0 }
            return (
              <li
                key={course.id}
                data-item-kind="course" data-item-id={course.id} data-item-label={course.title} data-item-path={`/courses/${course.id}`}
                // The whole row opens the course (stretched link); the edit and
                // delete buttons sit above it. The press scale answers the
                // link only, not the buttons.
                className="group relative flex items-start gap-2 transition-[background-color,scale] duration-(--dur-press) [transition-timing-function:ease,var(--ease-out)] hover:bg-ink-700/40 motion-safe:has-[a[data-row]:active]:scale-(--press-scale-card)"
              >
                <div className="grid min-w-0 flex-1 grid-cols-[1.75rem_minmax(0,1fr)] sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-3 sm:gap-x-4 py-4 pl-4 sm:pl-5">
                  <span className="pt-0.5 text-[11px] tabular-nums text-ink-300" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-ink-50 [overflow-wrap:anywhere]">
                      <Link
                        to={`/courses/${course.id}`}
                        data-row=""
                        className="rounded-sm outline-hidden after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand-500"
                      >
                        {course.title}
                      </Link>
                    </h2>
                    {course.description && (
                      <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-ink-300 line-clamp-2">
                        {course.description}
                      </p>
                    )}
                    {/* Phones: the counts and the open cue sit under the title. */}
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-ink-300 sm:hidden">
                      <span>{count(s.modules, 'module', 'modules')}</span>
                      <span>{count(s.topics, 'topic', 'topics')}</span>
                      <span>{count(s.sops, 'SOP', 'SOPs')}</span>
                    </p>
                    <OpenCue className="mt-2.5 sm:hidden" />
                  </div>
                  <dl className="hidden sm:grid grid-cols-[repeat(3,minmax(5.5rem,auto))] gap-x-5 pt-0.5 text-[11px] text-ink-300">
                    <div className="flex items-center gap-1.5">
                      <StackIcon size={14} className="shrink-0 text-ink-400" aria-hidden />
                      <dt className="sr-only">Modules</dt>
                      <dd className="tabular-nums">{count(s.modules, 'module', 'modules')}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ListBulletsIcon size={14} className="shrink-0 text-ink-400" aria-hidden />
                      <dt className="sr-only">Topics</dt>
                      <dd className="tabular-nums">{count(s.topics, 'topic', 'topics')}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <VideoCameraIcon size={14} className="shrink-0 text-ink-400" aria-hidden />
                      <dt className="sr-only">SOP videos</dt>
                      <dd className="tabular-nums">{count(s.sops, 'SOP', 'SOPs')}</dd>
                    </div>
                  </dl>
                </div>
                <div className="relative z-10 flex shrink-0 items-center gap-0.5 py-3 pr-2 sm:pr-3">
                  {canEdit && (
                    <>
                      <button
                        className="btn-ghost tap-target p-1.5 text-ink-300"
                        aria-label={`Edit ${course.title}`}
                        onClick={() => setEditing(course)}
                      >
                        <PencilSimpleIcon size={16} aria-hidden />
                      </button>
                      <button
                        className="btn-ghost tap-target p-1.5 text-ink-300 hover:text-rose-700 dark:hover:text-rose-400"
                        aria-label={`Delete ${course.title}`}
                        onClick={() => setConfirming(course)}
                      >
                        <TrashIcon size={16} aria-hidden />
                      </button>
                    </>
                  )}
                  <OpenCue className="ml-2 max-sm:hidden" />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <CourseModal
        state={editing}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={confirming !== null}
        title="Delete this course?"
        message={`"${confirming?.title ?? ''}" and all of its modules, topics, and SOP links will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete course"
        danger
        onConfirm={() => {
          if (confirming) {
            deleteCourse(confirming.id)
            toast.success('Course deleted')
          }
        }}
        onClose={() => setConfirming(null)}
      />
    </Layout>
  )
}
