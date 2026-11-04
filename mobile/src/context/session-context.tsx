import React, { createContext, useContext, useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { startRealtime, stopRealtime } from '@/lib/realtime'
import type { User } from '@/lib/types'
import { useCurrentUser, useStore } from '@/store/useStore'

/**
 * Session state for the whole app — the mobile counterpart of the web app's
 * AuthGate + useCurrentUser. In local mode the "session" is simply the
 * store's currentUserId; in remote mode the Supabase session (persisted in
 * AsyncStorage) is mirrored into the store (LB portal pattern).
 */
interface SessionCtx {
  user: User | null
  isAdmin: boolean
  /** True once the persisted store has rehydrated and hydrate() has run. */
  ready: boolean
}

const Ctx = createContext<SessionCtx>({ user: null, isAdmin: false, ready: false })

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const [persisted, setPersisted] = useState(useStore.persist.hasHydrated())

  // Wait for the AsyncStorage rehydration, then run the app hydrate pass
  // (remote fetchAll when configured + auto-archive sweep + due reminders).
  useEffect(() => {
    const unsub = useStore.persist.onFinishHydration(() => setPersisted(true))
    return unsub
  }, [])

  useEffect(() => {
    if (!persisted) return
    void (async () => {
      await useStore.getState().hydrate()
      if (isSupabaseConfigured) {
        const { data } = await supabase.auth.getSession()
        // Configured but no Supabase session → drop the stale local-mode login
        // so the user re-authenticates against Supabase (enables sync).
        if (!data.session && useStore.getState().currentUserId) {
          useStore.setState({ currentUserId: null })
        } else if (data.session) {
          // The persisted user must be the session's, or every write is
          // refused (db.ts 'account-changed'): switch and pull again.
          if (await useStore.getState().syncSessionUser(data.session.user.id)) {
            await useStore.getState().hydrate()
          }
          startRealtime()
        }
      }
    })()
  }, [persisted])

  // Remote mode: keep the store's auth in sync with the Supabase session, and
  // start/stop the realtime mirror. A signed-out session clears the user.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const me = useStore.getState().currentUserId
      if (!session) {
        useStore.setState({ currentUserId: null })
        stopRealtime()
      } else if (me !== null && me !== session.user.id) {
        stopRealtime()
        void useStore.getState().syncSessionUser(session.user.id)
          .then(() => useStore.getState().hydrate())
          .then(startRealtime)
      } else if (event === 'SIGNED_IN') {
        void useStore.getState().hydrate().then(startRealtime)
      }
    })
    return () => {
      subscription.unsubscribe()
      stopRealtime()
    }
  }, [])

  // Refetch when the app returns to the foreground (belt-and-suspenders on top
  // of realtime, e.g. after being backgrounded past a dropped socket).
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useStore.getState().hydrate()
    })
    return () => sub.remove()
  }, [])

  return (
    <Ctx.Provider
      value={{
        user,
        isAdmin: user?.role === 'admin',
        ready: persisted && hydrated,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useSession(): SessionCtx {
  return useContext(Ctx)
}
