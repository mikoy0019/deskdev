import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRightIcon, ArrowSquareOutIcon, PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react'
import { FormField, INPUT_INVALID } from '../settings/formKit'
import { useStore, useCurrentUser } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { isHttpsUrl } from '../../lib/showcase'
import { classNames } from '../../lib/format'
import type { Project } from '../../lib/types'
import { ShowcaseStatusBadge } from './showcaseBits'

/**
 * ProjectDetail's showcase block: the project's live link (https only, the
 * server CHECK refuses anything else) and the showcase item drafted from it.
 * A done project with a live link gets a draft; a declined client or a
 * white-label category files it hidden, with a note saying why.
 */
export default function ProjectShowcasePanel({ project }: { project: Project }) {
  const user = useCurrentUser()
  const item = useStore((s) => s.showcaseItems.find((i) => i.projectId === project.id))
  const autoPublish = useStore((s) => s.workspaceSettings.showcaseAutoPublish)
  const updateProject = useStore((s) => s.updateProject)
  const canEdit = can(user, 'projects', 'edit')
  const canOpen = can(user, 'showcase', 'view')

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The route reuses this component across projects: drop the previous one's edit.
  const [forId, setForId] = useState(project.id)
  if (forId !== project.id) {
    setForId(project.id)
    setEditing(false)
    setError(null)
  }

  const startEdit = () => {
    setValue(project.liveUrl ?? '')
    setError(null)
    setEditing(true)
  }

  const save = () => {
    const next = value.trim()
    if (next && !isHttpsUrl(next)) {
      setError('Use a full https:// link.')
      return
    }
    if (next !== (project.liveUrl ?? '')) {
      const result = updateProject(project.id, { liveUrl: next || undefined })
      if (!result.ok) {
        setError(result.error ?? 'The link was not saved.')
        return
      }
      const stored = useStore.getState().projects.find((p) => p.id === project.id)?.liveUrl ?? ''
      if (stored !== next) {
        setError('The link was not saved. You need edit access to projects.')
        return
      }
      toast.success(next ? 'Live link saved' : 'Live link removed')
    }
    setEditing(false)
  }

  return (
    <section aria-labelledby="project-showcase" className="mt-6">
      <h3 id="project-showcase" className="text-display text-base font-semibold text-ink-50 mb-3">Showcase</h3>
      <div className="divide-y divide-ink-600 rounded-lg border border-ink-600 bg-ink-850/40">
        <div className="px-4 py-3">
          {editing ? (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <FormField label="Live link" hint="Must start with https://. Leave it empty to remove it." error={error}>
                {(c) => (
                  <input
                    {...c}
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    placeholder="https://"
                    className={classNames('input w-full', INPUT_INVALID)}
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value)
                      if (error) setError(null)
                    }}
                  />
                )}
              </FormField>
              <div className="mt-3 flex gap-2 [&>button]:flex-1 pointer-coarse:[&>button]:min-h-11">
                <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          ) : (
            <>
              <div className="text-xs text-ink-300">Live link</div>
              {project.liveUrl ? (
                <div className="mt-1 flex items-center gap-1">
                  <a
                    href={project.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-center gap-1.5 text-sm text-brand-700 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 pointer-coarse:min-h-11"
                  >
                    <span className="truncate">{project.liveUrl.replace(/^https:\/\//, '')}</span>
                    <ArrowSquareOutIcon size={14} className="shrink-0" aria-hidden />
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      className="pressable tap-target -mr-2 ml-auto shrink-0 rounded-md p-2 text-ink-300 hover:bg-ink-700 hover:text-ink-50"
                      aria-label="Edit live link"
                      title="Edit live link"
                      onClick={startEdit}
                    >
                      <PencilSimpleIcon size={14} aria-hidden />
                    </button>
                  )}
                </div>
              ) : canEdit ? (
                <button type="button" className="btn-secondary mt-2 w-full justify-center pointer-coarse:min-h-11" onClick={startEdit}>
                  <PlusIcon size={16} aria-hidden />
                  Add live link
                </button>
              ) : (
                <div className="mt-1 text-sm text-ink-300">Not set</div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3">
          {item ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-ink-300">Showcase item</span>
                <ShowcaseStatusBadge status={item.status} />
              </div>
              {item.status === 'hidden' && item.consentNote && (
                <p className="mt-2 text-xs leading-relaxed text-ink-200 [overflow-wrap:anywhere]">{item.consentNote}</p>
              )}
              {item.status === 'ready' && item.consent === 'granted' && autoPublish && (
                <p className="mt-2 text-xs leading-relaxed text-ink-300">
                  Goes live once its link check passes. Until that check runs, an admin publishes it by hand.
                </p>
              )}
              {item.linkStatus === 'down' && (
                <p className="mt-2 text-xs leading-relaxed text-rose-700 dark:text-rose-400">
                  The link check failed, so the card is off the site.
                </p>
              )}
              {canOpen && (
                <Link
                  to={`/showcase?item=${item.id}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 pointer-coarse:min-h-11"
                >
                  Open in Showcase
                  <ArrowRightIcon size={12} aria-hidden />
                </Link>
              )}
            </>
          ) : (
            <>
              <div className="text-xs text-ink-300">Showcase item</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-300">
                {project.status === 'done' && project.liveUrl
                  ? 'No showcase item for this project.'
                  : 'A draft is created when this project is done and has a live link.'}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
