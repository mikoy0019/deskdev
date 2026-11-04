import { useEffect } from 'react'
import { toast } from 'sonner'
import { useStore, useCurrentUser } from '../store/useStore'
import { isAdmin } from '../lib/permissions'
import { isSupabaseConfigured } from '../lib/supabase'
import { runOperations } from './operationsApi'

/** Demo mode runs on every DeskDev screen. Remote mode uses the database cron, not browser presence. */
export default function OperationsRuntime() {
  const user = useCurrentUser()
  const hydrated = useStore(s => s.hydrated)
  useEffect(() => {
    if (isSupabaseConfigured || !isAdmin(user) || !hydrated) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let reported = false
    let alive = true
    const run = () => {
      if (!alive) return
      void runOperations().catch(() => {
        if (!reported && alive) { toast.error('Cube automatic operations could not run. Open Cube Operations to inspect the error.'); reported = true }
      })
    }
    const stop = useStore.subscribe((next, previous) => {
      if (next.leads === previous.leads && next.tasks === previous.tasks && next.projects === previous.projects && next.users === previous.users && next.projectEngagements === previous.projectEngagements && next.workspaceSettings === previous.workspaceSettings && next.hydrated === previous.hydrated && next.loadError === previous.loadError && next.currentUserId === previous.currentUserId) return
      clearTimeout(timer)
      timer = setTimeout(run, 250)
    })
    run()
    const tick = setInterval(run, 60_000)
    return () => { alive = false; stop(); clearTimeout(timer); clearInterval(tick) }
  }, [user?.id, user?.role, user?.deactivatedAt, hydrated])
  return null
}
