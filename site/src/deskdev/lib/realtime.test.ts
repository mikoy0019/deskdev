import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Supabase realtime: each channel records its status callback so the
// test can play SUBSCRIBED / CHANNEL_ERROR, and removeChannel() reports
// CLOSED on the removed channel the way realtime-js does.
type Status = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT'
type FakeChannel = { on: () => FakeChannel; subscribe: (cb: (s: Status) => void) => FakeChannel; report: (s: Status) => void }

const h = vi.hoisted(() => ({
  channels: [] as unknown[],
  connected: true,
  hydrate: vi.fn(async () => {}),
}))

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    channel: () => {
      let cb: ((s: Status) => void) | null = null
      const ch: FakeChannel = {
        on: () => ch,
        subscribe: (fn) => {
          cb = fn
          return ch
        },
        report: (s) => cb?.(s),
      }
      h.channels.push(ch)
      return ch
    },
    removeChannel: async (ch: FakeChannel) => {
      ch.report('CLOSED')
      return 'ok'
    },
    realtime: { isConnected: () => h.connected },
  },
}))
vi.mock('../store/useStore', () => ({
  useStore: { getState: () => ({ hydrate: h.hydrate }), setState: vi.fn() },
}))

import { isRealtimeJoined, kickRealtime, startRealtime, stopRealtime } from './realtime'

const channel = (i: number) => h.channels[i] as FakeChannel

beforeEach(() => {
  vi.useFakeTimers()
  stopRealtime()
  h.channels.length = 0
  h.connected = true
  h.hydrate.mockClear()
})

afterEach(() => {
  stopRealtime()
  vi.useRealTimers()
})

describe('realtime subscription', () => {
  it('reports joined only after SUBSCRIBED, over an open socket', () => {
    startRealtime()
    expect(isRealtimeJoined()).toBe(false)
    channel(0).report('SUBSCRIBED')
    expect(isRealtimeJoined()).toBe(true)
    h.connected = false
    expect(isRealtimeJoined()).toBe(false)
  })

  it('does not pull on the first join, but pulls the gap after a drop', async () => {
    startRealtime()
    channel(0).report('SUBSCRIBED')
    expect(h.hydrate).not.toHaveBeenCalled()

    channel(0).report('CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.channels).toHaveLength(2)
    channel(1).report('SUBSCRIBED')
    expect(h.hydrate).toHaveBeenCalledTimes(1)
  })

  it('ignores the CLOSED a torn-down channel still reports: one timer, backoff not doubled', async () => {
    startRealtime()
    // CHANNEL_ERROR, then removeChannel() makes the same channel report CLOSED.
    channel(0).report('CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.channels).toHaveLength(2)

    // Second failure: retries is 1, so 4 s — not 8 s as with a doubled count.
    channel(1).report('TIMED_OUT')
    await vi.advanceTimersByTimeAsync(3999)
    expect(h.channels).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.channels).toHaveLength(3)

    // And no stray timer from the stale CLOSED makes a fourth.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(h.channels).toHaveLength(3)
  })

  it('a late status from an old channel changes nothing', () => {
    startRealtime()
    channel(0).report('SUBSCRIBED')
    kickRealtime() // no-op: joined
    expect(h.channels).toHaveLength(1)
    h.connected = false
    kickRealtime()
    expect(h.channels).toHaveLength(2)
    h.connected = true
    channel(1).report('SUBSCRIBED')
    channel(0).report('CHANNEL_ERROR')
    expect(isRealtimeJoined()).toBe(true)
  })

  it('kickRealtime reconnects now instead of waiting out the backoff', async () => {
    startRealtime()
    // Several failures in a row push the delay up.
    for (let i = 0; i < 4; i++) {
      channel(i).report('CHANNEL_ERROR')
      await vi.advanceTimersByTimeAsync(60_000)
    }
    const before = h.channels.length
    channel(before - 1).report('CHANNEL_ERROR')
    kickRealtime()
    expect(h.channels).toHaveLength(before + 1)
    // The pending backoff timer is gone.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(h.channels).toHaveLength(before + 1)
  })

  it('stays down after an explicit stop', async () => {
    startRealtime()
    channel(0).report('SUBSCRIBED')
    stopRealtime()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(h.channels).toHaveLength(1)
    expect(isRealtimeJoined()).toBe(false)
  })
})
