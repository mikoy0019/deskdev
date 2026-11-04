import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightIcon, CheckCircleIcon, PaperPlaneRightIcon, RobotIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import { useStore, useCurrentUser } from '../store/useStore'
import { can as canDo } from '../lib/permissions'
import { classNames, isoDate } from '../lib/format'
import { respond, STARTERS, type AssistantData, type AssistantReply, type Can, type ProposedAction } from '../lib/assistant'

type Turn =
  | { id: string; from: 'you'; text: string }
  | { id: string; from: 'assistant'; reply: AssistantReply; outcome?: { ok: boolean; text: string; to?: string } | 'cancelled' }

const KEY = 'deskdev-assistant:v1'
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))

/**
 * The DeskDev Assistant (revision 10): ask about the workspace in plain words
 * and it answers from the data you can see — rules, not a paid AI service, so
 * nothing leaves DeskDev. It can also create and update tasks or add a
 * client, but only after showing exactly what will change and getting a yes.
 * The conversation lasts for this browser session.
 */
export default function Assistant() {
  const me = useCurrentUser()
  const users = useStore((s) => s.users)
  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const leads = useStore((s) => s.leads)
  const events = useStore((s) => s.events)
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const addClient = useStore((s) => s.addClient)

  const storageKey = `${KEY}:${me?.id ?? 'anon'}`
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      return raw ? (JSON.parse(raw) as Turn[]) : []
    } catch {
      return []
    }
  })
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(turns.slice(-60)))
    } catch {
      /* a full or blocked session store: the chat still works, it just won't survive a reload */
    }
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, storageKey])

  const data: AssistantData = useMemo(
    () => ({ me: me ?? null, users, clients, projects, tasks, leads, events, today: isoDate() }),
    [me, users, clients, projects, tasks, leads, events],
  )
  const allowed: Can = (feature, level) => canDo(me, feature, level)

  const ask = (text: string) => {
    const q = text.trim()
    if (!q) return
    const reply = respond(q, data, allowed)
    setTurns((t) => [...t, { id: newId(), from: 'you', text: q }, { id: newId(), from: 'assistant', reply }])
    setDraft('')
    inputRef.current?.focus()
  }

  const settle = (id: string, outcome: Extract<Turn, { from: 'assistant' }>['outcome']) =>
    setTurns((t) => t.map((x) => (x.id === id && x.from === 'assistant' ? { ...x, outcome } : x)))

  const run = (turnId: string, action: ProposedAction) => {
    try {
      if (action.kind === 'create_task') {
        const id = addTask({
          clientId: action.clientId,
          projectId: action.projectId,
          title: action.title,
          assigneeId: action.assigneeId,
          dueDate: action.dueDate,
          priority: action.priority ?? 'med',
        })
        settle(turnId, { ok: true, text: `Created “${action.title}”.`, to: `/tasks?task=${id}` })
      } else if (action.kind === 'update_task') {
        const { status, ...rest } = action.patch
        if (Object.keys(rest).length) updateTask(action.taskId, rest)
        if (status && !setTaskStatus(action.taskId, status)) {
          settle(turnId, { ok: false, text: 'Not done: finish the task’s open subtasks first, or you don’t have edit access to tasks.' })
          return
        }
        const title = tasks.find((t) => t.id === action.taskId)?.title ?? 'the task'
        settle(turnId, { ok: true, text: `Updated “${title}”.`, to: `/tasks?task=${action.taskId}` })
      } else {
        const id = addClient({ name: action.name })
        settle(turnId, { ok: true, text: `Added ${action.name}.`, to: `/clients/${id}` })
      }
    } catch (e) {
      settle(turnId, { ok: false, text: e instanceof Error ? e.message : 'That couldn’t be done. Try again.' })
    }
  }

  return (
    <Layout title="Assistant" subtitle="Answers from your workspace — nothing leaves DeskDev" subtitleShort="Ask about your workspace">
      <div className="mx-auto flex h-[calc(100dvh-11rem)] max-w-3xl flex-col gap-3 max-md:h-[calc(100dvh-11rem-var(--tabbar-h,0px))]">
        <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="card min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {turns.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-brand-600 dark:text-brand-400" aria-hidden>
                <RobotIcon size={24} />
              </span>
              <p className="text-display text-base font-semibold text-ink-50">Ask about your workspace</p>
              <p className="max-w-[52ch] text-sm text-ink-300">
                Tasks, projects, leads, meetings and clients — answered from what you can see. It can also create and update tasks, and it always asks before changing anything.
              </p>
            </div>
          )}
          {turns.map((t) =>
            t.from === 'you' ? (
              <div key={t.id} className="flex justify-end">
                <p dir="auto" className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white [overflow-wrap:anywhere]">{t.text}</p>
              </div>
            ) : (
              <AssistantTurn key={t.id} turn={t} onConfirm={(a) => run(t.id, a)} onCancel={() => settle(t.id, 'cancelled')} onAsk={ask} />
            ),
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
          {(turns.length === 0 ? STARTERS : STARTERS.slice(0, 4)).map((s) => (
            <button key={s} type="button" className="chip pressable border-ink-600 text-ink-200 hover:border-brand-500 hover:text-ink-50" onClick={() => (s === 'Create a task' ? (setDraft('create a task '), inputRef.current?.focus()) : ask(s))}>
              {s}
            </button>
          ))}
          {turns.length > 0 && (
            <button type="button" className="chip pressable ml-auto border-ink-600 text-ink-300 hover:text-ink-50" onClick={() => setTurns([])}>
              <TrashIcon size={12} aria-hidden /> Clear
            </button>
          )}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            ask(draft)
          }}
        >
          <label className="sr-only" htmlFor="assistant-input">Ask the Assistant</label>
          <input
            id="assistant-input"
            ref={inputRef}
            className="input min-w-0 flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. my tasks this week · create a task Update the menu for Casa Palma due Friday"
            autoComplete="off"
            maxLength={500}
            autoFocus
          />
          <button type="submit" className="btn-primary shrink-0" disabled={!draft.trim()} aria-label="Send">
            <PaperPlaneRightIcon size={16} aria-hidden />
          </button>
        </form>
      </div>
    </Layout>
  )
}

function AssistantTurn({
  turn,
  onConfirm,
  onCancel,
  onAsk,
}: {
  turn: Extract<Turn, { from: 'assistant' }>
  onConfirm: (a: ProposedAction) => void
  onCancel: () => void
  onAsk: (text: string) => void
}) {
  const { reply, outcome } = turn
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-700 text-brand-600 dark:text-brand-400" aria-hidden>
        <RobotIcon size={15} />
      </span>
      <div className="min-w-0 max-w-[85%] space-y-2">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-100">{reply.text}</p>

        {reply.items && reply.items.length > 0 && (
          <ul className="divide-y divide-ink-600 overflow-hidden rounded-lg border border-ink-600">
            {reply.items.map((it) => (
              <li key={it.id}>
                {it.to ? (
                  <Link to={it.to} className="pressable flex items-center gap-2 px-3 py-2 hover:bg-ink-700/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-50">{it.label}</span>
                      {it.detail && <span className="block truncate text-[11px] text-ink-300">{it.detail}</span>}
                    </span>
                    <ArrowRightIcon size={14} className="shrink-0 text-ink-400" aria-hidden />
                  </Link>
                ) : (
                  <span className="block px-3 py-2 text-sm text-ink-50">{it.label}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {reply.review && (
          <div className="rounded-lg border border-brand-500/40 bg-brand-600/5 p-3">
            <p className="text-sm font-medium text-ink-50">{reply.review.title}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {reply.review.lines.map((l) => (
                <div key={l.label} className="contents">
                  <dt className="text-ink-300">{l.label}</dt>
                  <dd className="min-w-0 text-ink-50 [overflow-wrap:anywhere]">{l.value}</dd>
                </div>
              ))}
            </dl>
            {outcome === undefined ? (
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-primary" onClick={() => onConfirm(reply.review!.action)}>Confirm</button>
                <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
              </div>
            ) : outcome === 'cancelled' ? (
              <p className="mt-3 text-xs text-ink-300">Cancelled — nothing changed.</p>
            ) : (
              <p className={classNames('mt-3 flex items-center gap-1.5 text-sm', outcome.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')} role={outcome.ok ? undefined : 'alert'}>
                {outcome.ok ? <CheckCircleIcon size={15} aria-hidden /> : <WarningCircleIcon size={15} aria-hidden />}
                {outcome.text}
                {outcome.to && <Link to={outcome.to} className="ml-1 underline">Open</Link>}
              </p>
            )}
          </div>
        )}

        {reply.suggestions && reply.suggestions.length > 0 && !reply.review && (
          <div className="flex flex-wrap gap-1.5">
            {reply.suggestions.map((s) => (
              <button key={s} type="button" className="chip pressable border-ink-600 text-ink-200 hover:border-brand-500 hover:text-ink-50" onClick={() => onAsk(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
