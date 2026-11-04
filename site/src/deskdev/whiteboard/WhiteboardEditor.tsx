import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import { CaptureUpdateAction, Excalidraw, restoreElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { useTheme } from '../theme/ThemeContext'
import { assetUrl } from '../lib/basePath'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useCurrentUser, useStore } from '../store/useStore'
import { openWhiteboard, saveWhiteboardScene, type WhiteboardScene } from './whiteboardApi'
import { BoardSession } from './boardSession'
import { draftKey, sceneFingerprint } from './sceneMerge'

declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string } }
if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = assetUrl('/excalidraw/')

type OnChange = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>
type API = Parameters<NonNullable<ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0]
type Files = Parameters<OnChange>[2]
const UI_OPTIONS = { canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } } as const
export type SaveStatus =
  | { kind: 'saved'; at?: string }
  | { kind: 'saving' }
  | { kind: 'pending' }
  | { kind: 'conflict' | 'error' | 'too-large'; message: string }

export default function WhiteboardEditor({ boardId, title, scene, version, onStatus, onSaved, readOnly = false }: {
  boardId: string; title: string; scene: WhiteboardScene; version: number
  onStatus: (status: SaveStatus) => void
  onSaved: (version: number, updatedAt: string) => void
  readOnly?: boolean
}) {
  const { isDark } = useTheme()
  const user = useCurrentUser()
  const [api, setApi] = useState<API | null>(null)
  const [elementCount, setElementCount] = useState(0)
  const session = useRef<BoardSession | null>(null)
  const callbacks = useRef({ onStatus, onSaved })
  useEffect(() => { callbacks.current = { onStatus, onSaved } }, [onStatus, onSaved])
  const applying = useRef(false)
  const [initialData] = useState(() => ({ elements: restoreElements(scene.elements as Parameters<typeof restoreElements>[0], null), appState: scene.appState, files: scene.files as Files, scrollToContent: true }))

  useEffect(() => {
    if (!api || !user) return
    let alive = true
    let timer: number | undefined
    let pulling = false
    // Separate journal slots prevent one tab's acknowledgement erasing another tab's pending work.
    let tabId = crypto.randomUUID()
    try {
      tabId = sessionStorage.getItem('deskdev-whiteboard-tab') ?? tabId
      sessionStorage.setItem('deskdev-whiteboard-tab', tabId)
    } catch { /* Recovery still uses the account/board prefix if session storage is unavailable. */ }
    const key = `${draftKey(user.id, boardId)}:${tabId}`
    let journalFailed = false
    const current = new BoardSession(scene, version, {
      read: () => openWhiteboard(boardId),
      capture: () => {
        const state = api.getAppState()
        if (state.isLoading) return
        return { elements: api.getSceneElementsIncludingDeleted(), files: api.getFiles(), appState: { viewBackgroundColor: state.viewBackgroundColor, gridModeEnabled: state.gridModeEnabled } }
      },
      save: (v, next) => useStore.getState().currentUserId === user.id ? saveWhiteboardScene(boardId, v, next)
        : Promise.resolve({ ok: false, reason: 'error', message: 'The signed-in account changed. Drawing kept on this device.' }),
      journal: (next) => {
        try {
          if (next) localStorage.setItem(key, JSON.stringify(next))
          else localStorage.removeItem(key)
          journalFailed = false
        } catch {
          journalFailed = true
          callbacks.current.onStatus({ kind: 'error', message: 'Device storage is full. Keep this tab open until the drawing saves.' })
        }
      },
      receive: (next) => {
        if (!alive) return
        const state = api.getAppState()
        // Never replace the element objects underneath an unfinished gesture.
        // The pointer-up reconciliation (or fallback poll) applies the merge.
        if (state.isLoading || state.newElement || state.isResizing || state.selectedElementsAreBeingDragged) return
        applying.current = true
        api.addFiles(Object.values(next.files ?? {}) as Parameters<API['addFiles']>[0])
        api.updateScene({ elements: restoreElements(next.elements as Parameters<typeof restoreElements>[0], api.getSceneElementsIncludingDeleted()), captureUpdate: CaptureUpdateAction.NEVER, appState: {
          viewBackgroundColor: typeof next.appState?.viewBackgroundColor === 'string' ? next.appState.viewBackgroundColor : api.getAppState().viewBackgroundColor,
          gridModeEnabled: typeof next.appState?.gridModeEnabled === 'boolean' ? next.appState.gridModeEnabled : api.getAppState().gridModeEnabled,
        } })
        applying.current = false
      },
    })
    session.current = current
    const schedule = (delay = 650) => {
      if (!alive || readOnly || timer !== undefined) return
      timer = window.setTimeout(() => { timer = undefined; void flush() }, delay)
    }
    const flush = async () => {
      current.captureLive()
      if (readOnly || !current.dirty) return
      callbacks.current.onStatus({ kind: 'saving' })
      const result = await current.flush()
      if (!alive) return
      if (result.ok) {
        callbacks.current.onSaved(result.version, result.updatedAt)
        if (current.dirty) { callbacks.current.onStatus({ kind: 'pending' }); schedule() }
        else callbacks.current.onStatus({ kind: 'saved', at: result.updatedAt })
      } else {
        callbacks.current.onStatus({ kind: result.reason, message: result.message })
        if (result.reason !== 'too-large') schedule(3000)
      }
    }
    const pull = async () => {
      if (pulling || !alive) return
      pulling = true
      try { await current.pull(); if (current.dirty) schedule() }
      catch { /* The next notification, reconnect or reconciliation poll retries. */ }
      finally { pulling = false }
    }
    if (!readOnly) {
      try {
        const prefix = `${draftKey(user.id, boardId)}:`
        // Also recover an unsent drawing from a tab/browser that was closed.
        for (let i = 0; i < localStorage.length; i++) {
          const slot = localStorage.key(i)
          if (!slot?.startsWith(prefix)) continue
          const raw = localStorage.getItem(slot)
          if (raw) current.recover(JSON.parse(raw) as WhiteboardScene)
        }
        if (current.dirty) schedule()
      } catch { callbacks.current.onStatus({ kind: 'error', message: 'A recovery copy could not be read. Keep this tab open and export your drawing.' }) }
    }
    const change = () => {
      if (!readOnly && current.dirty) { callbacks.current.onStatus({ kind: 'pending' }); schedule() }
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      current.captureLive()
      if (current.dirty || journalFailed) { event.preventDefault(); event.returnValue = ''; void flush() }
    }
    const reconcile = () => { void pull(); if (current.dirty) schedule(0) }
    window.addEventListener('deskdev-whiteboard-edit', change)
    window.addEventListener('storage', reconcile)
    window.addEventListener('online', reconcile)
    window.addEventListener('focus', reconcile)
    window.addEventListener('beforeunload', beforeUnload)
    const poll = window.setInterval(reconcile, 5000)
    const channel = isSupabaseConfigured ? supabase.channel(`whiteboard:${boardId}:${tabId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whiteboards', filter: `id=eq.${boardId}` }, () => void pull())
      .subscribe((state) => { if (state === 'SUBSCRIBED') reconcile() }) : null
    void pull()
    return () => {
      alive = false
      session.current = null
      window.clearTimeout(timer)
      window.clearInterval(poll)
      window.removeEventListener('deskdev-whiteboard-edit', change)
      window.removeEventListener('storage', reconcile)
      window.removeEventListener('online', reconcile)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('beforeunload', beforeUnload)
      if (channel) void supabase.removeChannel(channel)
      if (!readOnly) void current.flush()
      current.dispose()
    }
    // Scene/version are the initial snapshot; the session owns all later versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, boardId, user?.id, readOnly])

  const onChange = useCallback<OnChange>((elements, state, files) => {
    setElementCount(elements.filter((element) => !element.isDeleted).length)
    const current = session.current
    if (!current || readOnly || applying.current) return
    const next: WhiteboardScene = { elements, appState: { viewBackgroundColor: state.viewBackgroundColor, gridModeEnabled: state.gridModeEnabled }, files }
    if (sceneFingerprint(next) === sceneFingerprint(current.scene)) return
    current.edit(next)
    window.dispatchEvent(new Event('deskdev-whiteboard-edit'))
  }, [readOnly])
  const onPointerUp = useCallback(() => {
    if (readOnly) return
    session.current?.captureLive()
    window.dispatchEvent(new Event('deskdev-whiteboard-edit'))
    window.setTimeout(() => { void session.current?.pull().catch(() => {}) }, 0)
  }, [readOnly])
  return <div className="dd-whiteboard h-full w-full">
    <span className="sr-only" role="status" aria-label="Drawing elements">{elementCount} shapes</span>
    <Excalidraw excalidrawAPI={setApi} initialData={initialData} theme={isDark ? 'dark' : 'light'} name={title}
      onChange={onChange} viewModeEnabled={readOnly}
      onPointerUp={onPointerUp}
      UIOptions={UI_OPTIONS} />
  </div>
}
