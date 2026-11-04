import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CaretLeftIcon, GraduationCapIcon, NotePencilIcon, PencilSimpleIcon, PlusIcon, StackIcon, TrashIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import ConfirmDialog from '../components/ConfirmDialog'
import ModuleModal, { type ModuleModalState } from '../components/courses/ModuleModal'
import TopicModal, { type TopicModalState } from '../components/courses/TopicModal'
import SopModal from '../components/courses/SopModal'
import TopicCard from '../components/courses/TopicCard'
import { EmptyState } from '../components/ui-foundation'
import { Skeleton, useStagger } from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames } from '../lib/format'
import type { CourseModule, CourseTopic } from '../lib/types'

type PendingDelete =
  | { kind: 'module'; row: CourseModule }
  | { kind: 'topic'; row: CourseTopic }
  | null

/** A course while the store loads: a module header over a row of video tiles. */
function CourseSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading course">
      <Skeleton w={110} h={28} rounded="md" />
      {[0, 1].map((m) => (
        <div key={m} className="space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton w={18} h={10} rounded="sm" />
            <Skeleton w={m ? 140 : 190} h={14} rounded="sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2].map((t) => (
              <div key={t} className={classNames('card overflow-hidden', t === 2 && 'max-sm:hidden')}>
                <Skeleton rounded="sm" className="aspect-video w-full rounded-none" />
                <div className="space-y-2 p-3.5">
                  <Skeleton w="70%" h={12} rounded="sm" />
                  <Skeleton w="45%" h={10} rounded="sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One course: its modules, their topics, and the SOP video on each topic. */
export default function CourseDetail() {
  const { id = '' } = useParams()
  const user = useCurrentUser()
  const canEdit = can(user, 'courses', 'edit')

  const course = useStore((s) => s.courses.find((c) => c.id === id) ?? null)
  const hydrated = useStore((s) => s.hydrated)
  const courseModules = useStore((s) => s.courseModules)
  const courseTopics = useStore((s) => s.courseTopics)
  const deleteCourseModule = useStore((s) => s.deleteCourseModule)
  const deleteCourseTopic = useStore((s) => s.deleteCourseTopic)

  const [moduleModal, setModuleModal] = useState<ModuleModalState>(null)
  const [topicModal, setTopicModal] = useState<TopicModalState>(null)
  const [sopTopicId, setSopTopicId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)
  // First open of each course this session: the modules arrive in a short cascade.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLDivElement>(`course-${id}`)

  const modules = useMemo(
    () =>
      courseModules
        .filter((m) => m.courseId === id)
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    [courseModules, id],
  )

  const topicsByModule = useMemo(() => {
    const out = new Map<string, CourseTopic[]>()
    for (const t of courseTopics) {
      const list = out.get(t.moduleId)
      if (list) list.push(t)
      else out.set(t.moduleId, [t])
    }
    for (const list of out.values()) {
      list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
    }
    return out
  }, [courseTopics])

  // A search hit deep-links as ?topic=<id>; open that player once, then strip
  // the param so a refresh or a manual close doesn't reopen it.
  // (Opened during render — the param is URL state; the effect only strips it.)
  const deepLinkTopic = searchParams.get('topic')
  const [topicSeen, setTopicSeen] = useState<string | null>(null)
  if (deepLinkTopic !== topicSeen) {
    setTopicSeen(deepLinkTopic)
    if (deepLinkTopic) setSopTopicId(deepLinkTopic)
  }
  useEffect(() => {
    if (!deepLinkTopic) return
    const next = new URLSearchParams(searchParams)
    next.delete('topic')
    setSearchParams(next, { replace: true })
  }, [deepLinkTopic, searchParams, setSearchParams])

  // Track the SOP target by id, not by value, so saving a link re-renders the
  // open modal with the new URL instead of showing a stale snapshot.
  const sopTopic = sopTopicId ? courseTopics.find((t) => t.id === sopTopicId) ?? null : null

  // A cold deep link (a search hit, a shared URL) renders before the store has
  // loaded — hold a skeleton until it has, or every one flashes "not found".
  if (!course && !hydrated) {
    return (
      <Layout title="Course" subtitle="Loading…">
        <CourseSkeleton />
      </Layout>
    )
  }

  if (!course) {
    return (
      <Layout title="Course">
        <EmptyState
          icon={GraduationCapIcon}
          title="Course not found"
          description="It may have been deleted, or you may not have access to it."
          action={<Link to="/courses" className="btn-primary">Back to Courses</Link>}
        />
      </Layout>
    )
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    if (pendingDelete.kind === 'module') {
      deleteCourseModule(pendingDelete.row.id)
      toast.success('Module deleted')
    } else {
      deleteCourseTopic(pendingDelete.row.id)
      toast.success('Topic deleted')
    }
  }

  return (
    <Layout title={course.title} subtitle={course.description}>
      <div className="flex items-center justify-between gap-3 mb-6">
        <Link to="/courses" className="btn-ghost -ml-2 text-xs pointer-coarse:min-h-11">
          <CaretLeftIcon size={14} aria-hidden /> All courses
        </Link>
        {canEdit && (
          <button
            className="btn-primary"
            onClick={() => setModuleModal({ mode: 'new', courseId: course.id })}
          >
            <PlusIcon size={16} aria-hidden /> New module
          </button>
        )}
      </div>

      {modules.length === 0 ? (
        <EmptyState
          icon={StackIcon}
          title="No modules yet"
          description={
            canEdit
              ? 'Add a module, then add topics inside it. Each topic can carry one SOP video.'
              : 'This course has no published modules yet.'
          }
          action={
            canEdit ? (
              <button
                className="btn-primary"
                onClick={() => setModuleModal({ mode: 'new', courseId: course.id })}
              >
                <PlusIcon size={16} aria-hidden />
                New module
              </button>
            ) : undefined
          }
        />
      ) : (
        // Modules are chapters, not boxes: a numbered heading on a hairline,
        // then its video tiles straight on the page (no card around cards).
        <div ref={attachStagger} className={classNames('space-y-10', staggerClass)}>
          {modules.map((mod, i) => {
            const topics = topicsByModule.get(mod.id) ?? []
            return (
              <section key={mod.id} aria-labelledby={`module-${mod.id}`} className="border-t border-ink-600 pt-4">
                <header className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="shrink-0 text-xs tabular-nums text-ink-300" aria-hidden>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <h2 id={`module-${mod.id}`} className="text-display text-base font-semibold text-ink-50 [overflow-wrap:anywhere]">
                        {mod.title}
                      </h2>
                      <p className="mt-0.5 text-[11px] tabular-nums text-ink-300">
                        {topics.length} topic{topics.length === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="-mr-1.5 -mt-1 flex items-center gap-0.5 shrink-0">
                      <button
                        className="btn-ghost tap-target p-1.5 text-ink-300"
                        aria-label={'Add a video to ' + mod.title}
                        title="Add a video"
                        onClick={() => setTopicModal({ mode: 'new', moduleId: mod.id, kind: 'video' })}
                      >
                        <PlusIcon size={16} aria-hidden />
                      </button>
                      <button
                        className="btn-ghost tap-target p-1.5 text-ink-300"
                        aria-label={'Add a note to ' + mod.title}
                        title="Add a note"
                        onClick={() => setTopicModal({ mode: 'new', moduleId: mod.id, kind: 'note' })}
                      >
                        <NotePencilIcon size={16} aria-hidden />
                      </button>
                      <button
                        className="btn-ghost tap-target p-1.5 text-ink-300"
                        aria-label={'Edit module ' + mod.title}
                        onClick={() => setModuleModal({ mode: 'edit', module: mod })}
                      >
                        <PencilSimpleIcon size={16} aria-hidden />
                      </button>
                      <button
                        className="btn-ghost tap-target p-1.5 text-ink-300 hover:text-rose-700 dark:hover:text-rose-400"
                        aria-label={'Delete module ' + mod.title}
                        onClick={() => setPendingDelete({ kind: 'module', row: mod })}
                      >
                        <TrashIcon size={16} aria-hidden />
                      </button>
                    </div>
                  )}
                </header>

                {topics.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-ink-500 px-4 py-5">
                    <p className="text-sm text-ink-300">No topics in this module yet.</p>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="btn-secondary text-xs"
                          onClick={() => setTopicModal({ mode: 'new', moduleId: mod.id, kind: 'video' })}
                        >
                          <PlusIcon size={14} aria-hidden />
                          Add a video
                        </button>
                        <button
                          className="btn-secondary text-xs"
                          onClick={() => setTopicModal({ mode: 'new', moduleId: mod.id, kind: 'note' })}
                        >
                          <NotePencilIcon size={14} aria-hidden />
                          Add a note
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {topics.map((topic) => (
                      <TopicCard
                        key={topic.id}
                        topic={topic}
                        canEdit={canEdit}
                        onOpenSop={() => setSopTopicId(topic.id)}
                        onEdit={() => setTopicModal({ mode: 'edit', topic })}
                        onDelete={() => setPendingDelete({ kind: 'topic', row: topic })}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      <ModuleModal state={moduleModal} onClose={() => setModuleModal(null)} />
      <TopicModal state={topicModal} onClose={() => setTopicModal(null)} />
      <SopModal topic={sopTopic} canEdit={canEdit} onClose={() => setSopTopicId(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'module' ? 'Delete this module?' : 'Delete this topic?'}
        message={
          pendingDelete?.kind === 'module'
            ? `"${pendingDelete.row.title}" and every topic inside it will be permanently removed.`
            : `"${pendingDelete?.row.title ?? ''}", with its video link and note, will be permanently removed.`
        }
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Layout>
  )
}
