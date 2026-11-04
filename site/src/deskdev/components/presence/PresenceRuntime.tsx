import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCurrentUser } from '../../store/useStore'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { isDeactivated } from '../../lib/permissions'
import { AWAY_AFTER_MS, PRESENCE_HEARTBEAT_MS, PRESENCE_TOPIC, aggregatePresence, type PresenceStatus } from '../../lib/presence'
import { usePresence } from './usePresence'

/** Active while the tab is visible and someone touched it in the last few minutes. */
function useActivityStatus(): PresenceStatus {
  const [status, setStatus] = useState<PresenceStatus>(() =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'away' : 'active',
  )
  useEffect(() => {
    let timer = 0
    let last = 0
    const away = () => setStatus('away')
    const touch = () => {
      const now = Date.now()
      // pointermove fires constantly: re-arm at most once a second.
      if (now - last < 1000) return
      last = now
      if (document.visibilityState === 'hidden') return
      setStatus('active')
      window.clearTimeout(timer)
      timer = window.setTimeout(away, AWAY_AFTER_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(timer)
        away()
      } else {
        last = 0
        touch()
      }
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'] as const
    for (const e of events) window.addEventListener(e, touch, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    touch()
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, touch)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  return status
}

/**
 * Joins the presence channel for the signed-in person and keeps their status
 * there (revision 7). The channel is private: its policies (056) let only
 * active, signed-in accounts read or publish presence on this topic. In local
 * mode there is no channel, so the only person "here" is you.
 */
export default function PresenceRuntime() {
  const user = useCurrentUser()
  const status = useActivityStatus()
  const userId = user && !isDeactivated(user) ? user.id : null
  const channelRef = useRef<RealtimeChannel | null>(null)
  // Read when the channel (re)joins; kept current by the effect at the end.
  const statusRef = useRef(status)
  const [connected, setConnected] = useState(() => navigator.onLine)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const online = () => setConnected(true)
    const offline = () => { setConnected(false); usePresence.setState({ online: {}, live: false }) }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline) }
  }, [])

  useEffect(() => {
    if (!userId || !connected) {
      usePresence.setState({ online: {}, live: false })
      return
    }
    if (!isSupabaseConfigured) return
    const ch = supabase.channel(PRESENCE_TOPIC, { config: { private: true, presence: { key: userId } } })
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const failed = () => {
      if (!alive) return
      usePresence.setState({ online: {}, live: false })
      retry ??= setTimeout(() => { if (alive) setAttempt((n) => n + 1) }, 5000)
    }
    const publish = async () => {
      if (!alive || ch.state !== 'joined') return
      if (await ch.track({ status: statusRef.current, at: new Date().toISOString() }) !== 'ok') failed()
    }
    channelRef.current = ch
    ch.on('presence', { event: 'sync' }, () => {
      if (alive) usePresence.setState({ online: aggregatePresence(ch.presenceState()), live: true })
    })
    ch.subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        clearTimeout(retry); retry = undefined
        void publish()
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        failed()
      }
    })
    const heartbeat = setInterval(() => {
      void publish()
      if (alive && ch.state === 'joined') usePresence.setState({ online: aggregatePresence(ch.presenceState()) })
    }, PRESENCE_HEARTBEAT_MS)
    return () => {
      alive = false
      clearTimeout(retry)
      clearInterval(heartbeat)
      channelRef.current = null
      void ch.untrack()
      void supabase.removeChannel(ch)
      usePresence.setState({ online: {}, live: false })
    }
  }, [userId, connected, attempt])

  // Local mode: you, as you are.
  useEffect(() => {
    if (isSupabaseConfigured || !userId) return
    usePresence.setState({ online: connected ? { [userId]: status } : {}, live: connected })
  }, [userId, status, connected])

  // Remote: publish a status change on the joined channel.
  useEffect(() => {
    statusRef.current = status
    const ch = channelRef.current
    if (ch && ch.state === 'joined') void ch.track({ status, at: new Date().toISOString() })
  }, [status])

  return null
}
