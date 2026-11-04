import { useState } from 'react'

function read(key: string): string {
  try { return sessionStorage.getItem(key) ?? '' } catch { return '' }
}

/** Per-user, per-room drafts last for this browser session without crossing accounts. */
export function useMessageDraft(kind: 'chat' | 'channel', roomId: string, userId?: string) {
  const key = `deskdev-draft:${userId ?? 'signed-out'}:${kind}:${roomId}`
  const [state, setState] = useState(() => ({ key, value: read(key) }))
  if (state.key !== key) setState({ key, value: read(key) })
  const value = state.key === key ? state.value : read(key)
  return [value, (next: string) => {
    if (userId) {
      try {
        if (next) sessionStorage.setItem(key, next)
        else sessionStorage.removeItem(key)
      } catch { /* A blocked or full storage never blocks composing. */ }
    }
    setState({ key, value: next })
  }] as const
}
