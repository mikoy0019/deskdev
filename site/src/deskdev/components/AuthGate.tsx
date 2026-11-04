import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore'

/** Redirects to /login when nobody is signed in, remembering where you were headed. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const currentUserId = useStore((s) => s.currentUserId)
  const location = useLocation()
  if (!currentUserId) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <>{children}</>
}
