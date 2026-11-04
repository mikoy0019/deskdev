import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PresenceRuntime from './PresenceRuntime'
import { usePresence } from './usePresence'
import { AWAY_AFTER_MS } from '../../lib/presence'

const mock = vi.hoisted(() => ({ sync: () => {}, subscription: (state: string) => { void state },
  state: {} as Record<string, { status: string; at: string }[]>, track: vi.fn(async (value: unknown) => { void value; return 'ok' }), remove: vi.fn(), joins: 0 }))
vi.mock('../../store/useStore', () => ({ useCurrentUser: () => ({ id: 'alice', role: 'admin' }) }))
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  channel: () => {
    mock.joins++
    const channel = { state: 'joined', on: (_event: unknown, _filter: unknown, fn: () => void) => { mock.sync = fn; return channel },
      subscribe: (fn: (state: string) => void) => { mock.subscription = fn; return channel },
      presenceState: () => mock.state, track: mock.track, untrack: vi.fn() }
    return channel
  }, removeChannel: mock.remove,
} }))

let root: Root
beforeEach(() => {
  vi.useFakeTimers(); mock.track.mockClear(); mock.remove.mockClear(); mock.joins = 0
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.createElement('div'))
  usePresence.setState({ online: {}, live: false })
  act(() => root.render(createElement(PresenceRuntime)))
})
afterEach(() => { act(() => root.unmount()); vi.useRealTimers() })

it('clears stale people immediately on channel failure and rejoins', async () => {
  mock.state = { bob: [{ status: 'active', at: new Date().toISOString() }] }
  act(() => mock.sync()); expect(usePresence.getState().online.bob).toBe('active')
  act(() => mock.subscription('CHANNEL_ERROR'))
  expect(usePresence.getState()).toMatchObject({ online: {}, live: false })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(mock.joins).toBe(2)
  act(() => mock.sync()); expect(usePresence.getState().live).toBe(true)
})
it('publishes away after five idle minutes and active on new input', async () => {
  await act(async () => mock.subscription('SUBSCRIBED'))
  expect(mock.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_AFTER_MS + 10) })
  expect(mock.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'away' }))
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })))
  expect(mock.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }))
})
it('browser offline clears statuses; reconnect creates a fresh channel', () => {
  act(() => window.dispatchEvent(new Event('offline')))
  expect(usePresence.getState()).toMatchObject({ online: {}, live: false })
  expect(mock.remove).toHaveBeenCalled()
  act(() => window.dispatchEvent(new Event('online')))
  expect(mock.joins).toBe(2)
})
