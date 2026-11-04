import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowRightIcon, CheckIcon, ClipboardTextIcon, CodeIcon, PaperPlaneTiltIcon, RocketLaunchIcon,
} from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import OnboardingModal, { useOriginLead } from './OnboardingModal'
import ShareFormDialog from '../forms/ShareFormDialog'
import { Field } from '../tasks/formBits'
import { useCurrentUser, useStore } from '../../store/useStore'
import { can, isAdmin } from '../../lib/permissions'
import { classNames, fmtDate } from '../../lib/format'
import { ONBOARDING_FORM, formProgress, onboardingPrefill } from '../../lib/forms'
import { quickFormState } from '../../lib/quickForm'
import { PHASES, PHASE_LABEL, phaseOf } from '../../lib/projectPhase'
import { isHttpsUrl } from '../../lib/showcase'
import type { Project, ProjectPhase } from '../../lib/types'

// The project's stage bar: Onboarding → Development → Launched, with the one
// action each stage needs. Onboarding ends with the form completed and
// "Proceed to development"; development ends with "Development done", which
// takes the live URL and launches the project (its portfolio draft follows).

const ICON: Record<ProjectPhase, typeof CodeIcon> = {
  onboarding: ClipboardTextIcon,
  development: CodeIcon,
  launched: RocketLaunchIcon,
}

/** "Development done": the live URL, then launched (status done → 037 drafts the portfolio entry). */
function LaunchModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const setProjectPhase = useStore((s) => s.setProjectPhase)
  const [url, setUrl] = useState(project.liveUrl ?? '')
  const trimmed = url.trim()
  const error = trimmed && !isHttpsUrl(trimmed) ? 'Use the full https:// address of the live site' : null

  const launch = () => {
    if (error) return
    const result = setProjectPhase(project.id, 'launched', { liveUrl: trimmed || undefined })
    if (!result.ok) {
      toast.error(result.error ?? 'Could not launch the project')
      return
    }
    toast.success(trimmed ? 'Launched — its portfolio draft is in Portfolio' : 'Launched')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Development done"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={Boolean(error)} onClick={launch}>
            <RocketLaunchIcon size={14} aria-hidden /> Mark as launched
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink-200">
          This marks <strong className="text-ink-50">{project.title}</strong> done and launched. With the live URL, a
          portfolio draft is created for the developer to fill in; an admin publishes it to the website.
        </p>
        <Field
          label="Live site URL"
          error={error}
          hint={!trimmed ? <p className="text-[11px] text-amber-700 dark:text-amber-400">Without a live URL no portfolio draft is created.</p> : undefined}
        >
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            className="input w-full"
            placeholder="https://client-site.com"
            value={url}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
        </Field>
      </div>
    </Modal>
  )
}

export default function ProjectStages({ project }: { project: Project }) {
  const user = useCurrentUser()
  const canEdit = can(user, 'projects', 'edit')
  const admin = isAdmin(user)
  const setProjectPhase = useStore((s) => s.setProjectPhase)
  const response = useStore((s) => s.formResponses.find((r) => r.form === ONBOARDING_FORM.key && r.projectId === project.id))
  const portfolio = useStore((s) => s.showcaseItems.find((i) => i.projectId === project.id))
  const client = useStore((s) => s.clients.find((c) => c.id === project.clientId))
  const lead = useOriginLead(project.clientId)
  const [formOpen, setFormOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [confirm, setConfirm] = useState<'skip' | 'reopen' | null>(null)

  const phase = phaseOf(project)
  const current = PHASES.indexOf(phase)
  const onboarded = response?.status === 'submitted'
  const progress = formProgress(ONBOARDING_FORM, response?.answers ?? {})
  const link = quickFormState(response)

  const move = (to: ProjectPhase, force = false) => {
    const result = setProjectPhase(project.id, to, { force })
    if (result.ok) toast.success(`Moved to ${PHASE_LABEL[to]}`)
    else toast.error(result.error ?? 'Could not change the stage')
  }

  return (
    <section aria-label="Project stage" className="mt-5 rounded-lg border border-ink-600 bg-ink-850/40 p-3 sm:p-4">
      <ol className="grid grid-cols-3 gap-2">
        {PHASES.map((p, i) => {
          const Icon = ICON[p]
          const done = i < current
          const active = i === current
          return (
            <li
              key={p}
              aria-current={active ? 'step' : undefined}
              className={classNames(
                'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium sm:text-[13px]',
                active ? 'bg-brand-600 text-white shadow-(--shadow-1)' : done ? 'text-ink-100' : 'text-ink-400',
              )}
            >
              <span
                className={classNames(
                  'grid size-5 shrink-0 place-items-center rounded-full',
                  active ? 'bg-white/20' : done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-ink-700',
                )}
                aria-hidden
              >
                {done ? <CheckIcon size={11} weight="bold" /> : <Icon size={11} />}
              </span>
              <span className="truncate">{PHASE_LABEL[p]}</span>
              <span className="sr-only">{done ? '(done)' : active ? '(current)' : '(next)'}</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-600 pt-3">
        {phase === 'onboarding' && (
          <>
            <p className="mr-auto text-[13px] text-ink-200">
              {onboarded
                ? 'Onboarding form complete. Ready for development.'
                : link === 'answered'
                  ? 'The client sent their answers — review and complete the form.'
                  : `Onboarding form: ${progress.done} of ${progress.required} required answered${link === 'open' ? ' · sent to the client' : ''}.`}
            </p>
            {canEdit && !onboarded && link !== 'answered' && (
              <button type="button" className="btn-ghost text-xs" onClick={() => setShareOpen(true)}>
                <PaperPlaneTiltIcon size={14} aria-hidden /> {link === 'open' ? 'Resend to client' : 'Send to client'}
              </button>
            )}
            <button type="button" className={onboarded ? 'btn-ghost text-xs' : 'btn-secondary text-xs'} onClick={() => setFormOpen(true)}>
              <ClipboardTextIcon size={14} aria-hidden /> {onboarded ? 'View form' : 'Onboarding form'}
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={!onboarded}
                title={onboarded ? undefined : 'Complete the onboarding form first'}
                onClick={() => move('development')}
              >
                Proceed to development <ArrowRightIcon size={14} aria-hidden />
              </button>
            )}
            {canEdit && admin && !onboarded && (
              <button type="button" className="btn-ghost text-xs text-ink-300" onClick={() => setConfirm('skip')}>
                Skip onboarding
              </button>
            )}
          </>
        )}

        {phase === 'development' && (
          <>
            <p className="mr-auto text-[13px] text-ink-200">
              In development{project.phaseChangedAt ? ` since ${fmtDate(project.phaseChangedAt)}` : ''}.
            </p>
            {response && (
              <button type="button" className="btn-ghost text-xs" onClick={() => setFormOpen(true)}>
                <ClipboardTextIcon size={14} aria-hidden /> Onboarding details
              </button>
            )}
            {canEdit && (
              <button type="button" className="btn-primary text-xs" onClick={() => setLaunchOpen(true)}>
                <RocketLaunchIcon size={14} aria-hidden /> Development done
              </button>
            )}
          </>
        )}

        {phase === 'launched' && (
          <>
            <p className="mr-auto text-[13px] text-ink-200">
              Launched{project.phaseChangedAt ? ` ${fmtDate(project.phaseChangedAt)}` : ''}.
              {portfolio ? ' ' : project.liveUrl ? '' : ' Add the live URL to draft its portfolio entry.'}
              {portfolio && (
                <Link to={`/showcase?item=${portfolio.id}`} className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
                  Fill in its portfolio entry
                </Link>
              )}
            </p>
            {response && (
              <button type="button" className="btn-ghost text-xs" onClick={() => setFormOpen(true)}>
                <ClipboardTextIcon size={14} aria-hidden /> Onboarding details
              </button>
            )}
            {canEdit && (
              <button type="button" className="btn-ghost text-xs text-ink-300" onClick={() => setConfirm('reopen')}>
                Reopen development
              </button>
            )}
          </>
        )}
      </div>

      {formOpen && <OnboardingModal project={project} onClose={() => setFormOpen(false)} />}
      {shareOpen && (
        <ShareFormDialog
          form={ONBOARDING_FORM.key}
          projectId={project.id}
          defaultTo={client?.email ?? lead?.email}
          name={lead?.name ?? client?.name}
          answers={onboardingPrefill({ project, client, lead })}
          onClose={() => setShareOpen(false)}
        />
      )}
      {launchOpen && <LaunchModal project={project} onClose={() => setLaunchOpen(false)} />}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'skip' ? 'Skip onboarding' : 'Reopen development'}
        message={
          confirm === 'skip'
            ? `Move "${project.title}" to development without the onboarding form? Use this for internal work or projects onboarded elsewhere.`
            : `Move "${project.title}" back to development? Its portfolio entry stays as it is.`
        }
        confirmLabel={confirm === 'skip' ? 'Skip to development' : 'Reopen'}
        onConfirm={() => move('development', confirm === 'skip')}
        onClose={() => setConfirm(null)}
      />
    </section>
  )
}
