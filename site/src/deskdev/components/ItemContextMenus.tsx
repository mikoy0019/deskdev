import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCurrentUser, useStore } from '../store/useStore'
import { isDeactivated } from '../lib/permissions'
import { appUrl } from '../pwa/paths'
import { usePresence } from './presence/usePresence'
import Popover from './crm/Popover'
import Modal from './Modal'

type Target = { anchor: HTMLElement; kind: string; id: string; label: string; path?: string; point?: { x: number; y: number }; properties: Record<string, string>; actions: { label: string; run: () => void }[] }
const field = 'input, textarea, select, [contenteditable="true"], [role="textbox"]'

/** Delegate to the item's existing controls so permissions and confirmation flows stay authoritative. */
export default function ItemContextMenus() {
  const navigate = useNavigate()
  const me = useCurrentUser()
  const users = useStore((s) => s.users)
  const online = usePresence((s) => s.online)
  const [target, setTarget] = useState<Target | null>(null)
  const [properties, setProperties] = useState<Target | null>(null)

  useEffect(() => {
    const resolve = (element: Element, personOnly = false): Target | null => {
      const person = element.closest<HTMLElement>('[data-person-id]')
      if (person) {
        const user = users.find((u) => u.id === person.dataset.personId)
        if (!user) return null
        const actions = []
        if (user.id !== me?.id && !isDeactivated(user)) actions.push({ label: 'Message', run: () => {
          const id = useStore.getState().startConversation([user.id])
          if (id) navigate(`/messages/${id}`)
          else toast.error('The conversation could not be opened')
        } })
        if (user.email) actions.push({ label: 'Copy email address', run: () => { void navigator.clipboard.writeText(user.email!).catch(() => toast.error('Could not copy email')) } })
        if (user.id === me?.id) actions.push({ label: 'Edit my profile', run: () => navigate('/settings?section=profile') })
        return { anchor: person, kind: 'user', id: user.id, label: user.fullName, properties: { Name: user.fullName, Title: user.title ?? '', Role: user.role, Email: user.email ?? '', Status: online[user.id] === 'active' ? 'Active' : online[user.id] === 'away' ? 'Away' : 'Offline' }, actions }
      }
      if (personOnly) return null
      const item = element.closest<HTMLElement>('[data-item-kind]') ?? element.closest<HTMLElement>('a[href]')
      if (!item) return null
      const kind = item.dataset.itemKind ?? 'link'
      const id = item.dataset.itemId ?? ''
      const raw = item.getAttribute('href')
      const url = raw ? new URL(raw, window.location.href) : null
      if (kind === 'link' && (!url || url.origin !== location.origin || !url.pathname.startsWith('/'))) return null
      const path = item.dataset.itemPath
      const label = item.dataset.itemLabel ?? item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 120) ?? kind
      const actions = [...item.querySelectorAll<HTMLButtonElement>('button')]
        .filter((b) => !b.disabled && /^(edit|delete|reply|download|rename|archive|pin|move|play|open|copy|board menu|folder menu)\b/i.test(b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''))
        .map((button) => ({ label: button.getAttribute('aria-label') ?? button.textContent!.trim(), run: () => { if (button.isConnected) button.click() } }))
      if (kind === 'meeting' || kind === 'calendar event') actions.unshift({ label: 'Open details', run: () => item.click() })
      const state = useStore.getState()
      const record = (kind === 'project' ? state.projects : kind === 'client' ? state.clients : kind === 'meeting' ? state.events : kind === 'recording' ? state.meetingRecordings : []).find((row) => row.id === id) as unknown as Record<string, unknown> | undefined
      const details: Record<string, string> = {}
      for (const key of ['status', 'createdAt', 'updatedAt', 'startsAt', 'endsAt', 'dueDate', 'recordedOn']) if (typeof record?.[key] === 'string') details[key] = record[key]
      return { anchor: item, kind, id, label, path: path ? appUrl(path) : url?.href,
        properties: { Name: label, Type: kind, ...(id ? { ID: id } : {}), ...details }, actions }
    }
    const context = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest(field) || event.target.closest('.excalidraw')) return
      const next = resolve(event.target)
      if (!next) return
      event.preventDefault()
      setTarget({ ...next, point: { x: event.clientX, y: event.clientY } })
    }
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(field)) return
      const person = event.target.closest<HTMLElement>('[data-person-id]')
      if (!person || (person.parentElement?.closest('button, a') && !person.matches('button'))) return
      const next = resolve(person, true)
      if (!next) return
      event.preventDefault(); event.stopPropagation()
      setTarget(next)
    }
    const personContext = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-person-id]') && !event.target.closest(field)) {
        context(event)
        if (event.defaultPrevented) event.stopPropagation()
      }
    }
    const key = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target.closest(field)) return
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const next = resolve(event.target)
        if (next) { event.preventDefault(); setTarget(next) }
      } else if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-person-id]')) {
        const next = resolve(event.target, true)
        if (next) { event.preventDefault(); setTarget(next) }
      }
    }
    document.addEventListener('contextmenu', context)
    document.addEventListener('contextmenu', personContext, true)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('contextmenu', context); document.removeEventListener('contextmenu', personContext, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key) }
  }, [users, me?.id, online, navigate])

  const run = (action: () => void) => { setTarget(null); window.setTimeout(action, 0) }
  return <>
    <Popover anchor={target?.anchor ?? null} point={target?.point} onClose={() => setTarget(null)} role="menu" label={target?.kind === 'user' ? 'User actions' : 'Item actions'}>
      <div className="min-w-52" onClick={(e) => e.stopPropagation()}>
        <p className="max-w-72 truncate px-3 py-2 text-xs text-ink-300">{target?.label}</p>
        {target?.path && <>
          <button type="button" role="menuitem" className="btn-ghost w-full justify-start" onClick={() => run(() => window.location.assign(target.path!))}>Open</button>
          <a role="menuitem" className="btn-ghost w-full justify-start" href={target.path} target="_blank" rel="noopener noreferrer">Open in a new tab</a>
          <button type="button" role="menuitem" className="btn-ghost w-full justify-start" onClick={() => run(() => { void navigator.clipboard.writeText(target.path!).catch(() => toast.error('Could not copy link')) })}>Copy link</button>
        </>}
        {target?.actions.map((action, i) => <button type="button" role="menuitem" className="btn-ghost w-full justify-start" key={`${action.label}:${i}`} onClick={() => run(action.run)}>{action.label}</button>)}
        <button type="button" role="menuitem" className="btn-ghost w-full justify-start" onClick={() => run(() => setProperties(target))}>Properties</button>
      </div>
    </Popover>
    <Modal open={!!properties} onClose={() => setProperties(null)} title={`${properties?.kind === 'user' ? 'User' : 'Item'} properties`}>
      <dl className="space-y-3">{Object.entries(properties?.properties ?? {}).filter(([, value]) => value).map(([name, value]) => <div key={name}><dt className="text-xs text-ink-300">{name}</dt><dd className="break-words text-sm text-ink-50">{value}</dd></div>)}</dl>
    </Modal>
  </>
}
