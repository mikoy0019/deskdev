import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRightIcon, CheckCircleIcon, CircleIcon } from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../../store/useStore'
import { activeUsers, isAdmin } from '../../lib/permissions'
import { classNames } from '../../lib/format'
import { useIsStandalone } from '../../pwa/useMediaQuery'
import { m, Presence, TWEEN } from '../motion'
import type { ExitCustom } from '../motion/Presence'
import { guideView, setupProgress, setupSteps, type GuideMemory, type GuideView, type SetupFacts } from './setupSteps'
import { onGuideMemoryChange, readGuideMemory, showSetupGuide, writeGuideMemory } from './setupGuideMemory'

// The card arrives with the page (no entrance of its own) and leaves with a
// short fade; instantly when it was hidden from the keyboard.
const leave = {
  open: { opacity: 1 },
  closed: ({ instant }: ExitCustom) => ({ opacity: 0, transition: instant ? TWEEN.instant : TWEEN.modalExit }),
}

const quietAction = 'btn-ghost shrink-0 h-7 px-2.5 text-xs pointer-coarse:h-11'

/**
 * First run: a new workspace opens on a row of zeros and empty cards. This
 * card says what to do next: five steps, each a link to where it is done,
 * each ticking itself from the workspace's own data. Admins only. "Hide"
 * puts it away for this person on this device (the toast's Undo and the
 * palette's "Show setup guide" bring it back); when every step is done it
 * says so once and does not come back. The rules live in setupSteps.ts.
 */
export default function SetupGuide() {
  const user = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  // Before the first pull an empty workspace is unknown, not "new".
  if (!user || !hydrated || !isAdmin(user)) return null
  return <Guide key={user.id} userId={user.id} />
}

function Guide({ userId }: { userId: string }) {
  const clients = useStore((s) => s.clients.length)
  const projects = useStore((s) => s.projects.length)
  const activePeople = useStore((s) => activeUsers(s.users).length)
  // Only people who can still sign in count as answering leads.
  const leadOwners = useStore((s) => {
    const pool = s.workspaceSettings.growthOwnerPool
    return activeUsers(s.users).filter((u) => pool.includes(u.id)).length
  })
  const installedHere = useIsStandalone()
  const facts: SetupFacts = { clients, projects, activePeople, leadOwners, installedHere }

  const [memory, setMemory] = useState<GuideMemory>(() => readGuideMemory(userId))
  // Brought back from outside the card (Undo, the palette): read it again.
  useEffect(() => onGuideMemoryChange(() => setMemory(readGuideMemory(userId))), [userId])
  // "You're set up" is shown for the rest of this visit, though `finished`
  // is already recorded.
  const [justFinished, setJustFinished] = useState(false)

  const view = guideView(true, facts, memory)
  // Recorded during render (not in an effect) so the card never flickers
  // between two states: once shown, the guide stays through its steps.
  if (view === 'steps' && !memory.started) setMemory({ ...memory, started: true })
  if (view === 'done') {
    setMemory({ ...memory, finished: true })
    setJustFinished(true)
  }
  useEffect(() => {
    if (Object.keys(memory).length > 0) writeGuideMemory(userId, memory)
  }, [userId, memory])

  // "Done" removes the button that was pressed: focus goes to the step's link,
  // or to Hide when that tick finished the guide. Never to <body>.
  const cardRef = useRef<HTMLElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    const card = cardRef.current
    if (!card || card.contains(document.activeElement)) return
    const next = card.querySelector<HTMLElement>('[data-step="install"]') ?? card.querySelector<HTMLElement>('button')
    next?.focus({ preventScroll: true })
  })

  const shown: GuideView = justFinished && !memory.hidden ? 'done' : view
  const steps = setupSteps(facts, memory)
  const hide = () => {
    setMemory({ ...memory, hidden: true })
    // The button leaves with the card: hand focus to the page, not <body>.
    document.getElementById('dd-main')?.focus({ preventScroll: true })
    toast('Setup guide hidden', { action: { label: 'Undo', onClick: () => showSetupGuide(userId) } })
  }

  return (
    <Presence initial={false}>
      {shown !== 'none' && (
        <m.section
          key="setup-guide"
          ref={cardRef}
          aria-labelledby="setup-guide-title"
          className="card overflow-hidden"
          variants={leave}
          initial={false}
          animate="open"
          exit="closed"
        >
          {shown === 'done' ? (
            <div className="flex items-center gap-3 px-4 py-3" role="status">
              <CheckCircleIcon size={18} weight="fill" aria-hidden className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="min-w-0 flex-1 text-sm text-ink-200">
                <span id="setup-guide-title" className="font-medium text-ink-50">You’re set up.</span>{' '}
                Every step is done.
              </p>
              <button type="button" className={classNames(quietAction, '-mr-1.5 pointer-coarse:-my-2')} onClick={hide}>
                Hide
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-ink-600 px-4 py-3">
                <h2 id="setup-guide-title" className="flex min-w-0 items-baseline gap-2 text-display text-base font-semibold text-ink-50">
                  <span className="truncate">Set up your workspace</span>
                  <span className="shrink-0 font-sans text-sm font-normal tabular-nums text-ink-300">
                    {setupProgress(steps)}
                  </span>
                </h2>
                <button type="button" className={classNames(quietAction, '-mr-1.5 pointer-coarse:-my-2')} onClick={hide}>
                  Hide
                </button>
              </div>
              <ol className="divide-y divide-ink-600">
                {steps.map((step) => (
                  <li key={step.id} className="flex items-center">
                    <Link
                      to={step.to}
                      data-step={step.id}
                      className="pressable-card density-row flex min-w-0 flex-1 items-center gap-3 px-4 hover:bg-ink-700/50 focus-visible:ring-inset focus-visible:ring-offset-0 pointer-coarse:min-h-11"
                    >
                      {step.done ? (
                        <CheckCircleIcon size={18} weight="fill" aria-hidden className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <CircleIcon size={18} aria-hidden className="shrink-0 text-ink-400" />
                      )}
                      <span className={classNames('min-w-0 flex-1 text-sm', step.done ? 'text-ink-300' : 'font-medium text-ink-50')}>
                        {step.label}
                        <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                      </span>
                      {/* The install row ends in its Done button instead: an arrow
                          before it sat 60px left of the arrows above. */}
                      {!step.done && step.id !== 'install' && <ArrowRightIcon size={14} aria-hidden className="shrink-0 text-ink-400" />}
                    </Link>
                    {/* A desktop browser can't see the phone: this one step can be ticked by hand. */}
                    {step.id === 'install' && !step.done && (
                      <button
                        type="button"
                        className={classNames(quietAction, 'mr-1.5')}
                        aria-label={`Mark “${step.label}” as done`}
                        onClick={() => {
                          refocus.current = true
                          setMemory({ ...memory, installDone: true })
                        }}
                      >
                        Done
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </m.section>
      )}
    </Presence>
  )
}
