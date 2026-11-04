import { useMemo } from 'react'
import { useStore, useCurrentUser } from '../store/useStore'
import { isSupabaseConfigured } from '../lib/supabase'
import type { CubeSnapshot } from './engine'

export function cubeSnapshot(now: string): CubeSnapshot {
  const state = useStore.getState()
  return {
    user: state.users.find((user) => user.id === state.currentUserId) ?? null,
    users: state.users, leads: state.leads, tasks: state.tasks, projects: state.projects,
    projectEngagements: state.projectEngagements,
    unavailable: !state.hydrated || (isSupabaseConfigured && !state.synced)
      ? ['users', 'leads', 'tasks', 'projects', 'projectEngagements']
      : state.loadError ?? [],
    timezone: state.workspaceSettings.growthBusinessHours.tz,
    now,
  }
}

export function useCubeSnapshot(now: string): CubeSnapshot {
  const user = useCurrentUser()
  const users = useStore((state) => state.users)
  const leads = useStore((state) => state.leads)
  const tasks = useStore((state) => state.tasks)
  const projects = useStore((state) => state.projects)
  const projectEngagements = useStore((state) => state.projectEngagements)
  const hydrated = useStore((state) => state.hydrated)
  const synced = useStore((state) => state.synced)
  const loadError = useStore((state) => state.loadError)
  const timezone = useStore((state) => state.workspaceSettings.growthBusinessHours.tz)
  return useMemo(() => ({ user, users, leads, tasks, projects, projectEngagements, now, timezone,
    unavailable: !hydrated || (isSupabaseConfigured && !synced) ? ['users', 'leads', 'tasks', 'projects', 'projectEngagements'] : loadError ?? [],
  }), [user, users, leads, tasks, projects, projectEngagements, now, timezone, hydrated, synced, loadError])
}
