import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { CircleNotchIcon, ShieldWarningIcon } from '@phosphor-icons/react'
import BrandMark from '../components/ui/BrandMark'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import {
  clearHandoffState, handoffIsTrusted, pendingHandoffState, readHandoff, siteLoginUrl, usesSiteLogin,
  type Handoff,
} from '../lib/siteLogin'
import { useStore } from '../store/useStore'
import { isStandalone } from '../pwa/platform'

/** A handoff that needs a yes before it signs anyone in. */
interface Pending {
  handoff: Handoff
  /** The account the tokens belong to (verified with the server). */
  email: string
  /** A different account signed in here now, which Continue signs out. */
  replacing: string | null
  /** Whether anyone is signed in here (Cancel goes home instead of to login). */
  hasSession: boolean
}

// Landing route for the NixGen site's Team login. The site signs in against the
// same Supabase project and redirects here with the session tokens in the URL
// fragment (see lib/siteLogin.ts). Registered OUTSIDE AuthGate — the visitor
// isn't signed in to this origin yet.
//
// Login CSRF: a link anyone can craft carries tokens too, so nothing is stored
// until the tokens are checked. The session is applied straight away only when
// the fragment echoes the one-time state this tab minted before leaving for the
// site (or it just renews the user already signed in here). Anything else —
// a login started on the site itself, a stranger's link, a different user than
// the one signed in — asks "Continue as …?" first.
export default function AuthCallback() {
  const adoptSession = useStore((s) => s.adoptSession)
  const logout = useStore((s) => s.logout)
  const navigate = useNavigate()
  // Read once: the effect strips the fragment, and StrictMode re-runs effects.
  const [handoff] = useState(() => readHandoff(window.location.hash))
  // Reading doesn't consume it (StrictMode runs initialisers twice); the effect clears it.
  const [expectedState] = useState(() => pendingHandoffState())
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  // Back to whichever sign-in this visitor uses, with the reason. The
  // installed app never leaves its scope for the site's /login.
  const fail = useCallback(
    (error: string) => {
      if (usesSiteLogin && !isStandalone()) window.location.replace(siteLoginUrl({ error }))
      else navigate(`/login?error=${error}`, { replace: true })
    },
    [navigate],
  )

  const apply = useCallback(
    async (h: Handoff, signOutFirst: boolean) => {
      // Another user's workspace must not carry over: sign them out here (this
      // device only) and wipe the per-user store before the new session lands.
      if (signOutFirst) await logout()
      const { data, error } = await supabase.auth.setSession({
        access_token: h.accessToken,
        refresh_token: h.refreshToken,
      })
      if (error || !data.user) {
        console.warn('[auth] handoff rejected:', error?.message)
        return fail('session')
      }
      await adoptSession(data.user.id)
      try {
        navigate(h.next, { replace: true })
      } catch {
        navigate('/', { replace: true })
      }
    },
    [adoptSession, fail, logout, navigate],
  )

  useEffect(() => {
    if (started.current || !isSupabaseConfigured) return
    started.current = true
    // Tokens must not linger in history, the address bar, or a bookmark.
    window.history.replaceState(null, '', window.location.pathname)
    // One use, whatever happens next.
    clearHandoffState()
    if (!handoff) return fail('handoff')

    void (async () => {
      // Whose tokens are these? Asked of the server; nothing is stored yet.
      const { data: incoming, error } = await supabase.auth.getUser(handoff.accessToken)
      if (error || !incoming.user) {
        console.warn('[auth] handoff rejected:', error?.message)
        return fail('session')
      }
      const { data: current } = await supabase.auth.getSession()
      const currentUser = current.session?.user ?? null
      if (
        handoffIsTrusted({
          handoffState: handoff.state,
          expectedState,
          incomingUserId: incoming.user.id,
          currentUserId: currentUser?.id ?? null,
        })
      ) {
        return apply(handoff, false)
      }
      setPending({
        handoff,
        email: incoming.user.email ?? 'another account',
        replacing: currentUser && currentUser.id !== incoming.user.id ? (currentUser.email ?? 'the current account') : null,
        hasSession: currentUser !== null,
      })
    })()
  }, [apply, expectedState, fail, handoff])

  const accept = async () => {
    if (!pending || busy) return
    setBusy(true)
    await apply(pending.handoff, pending.replacing !== null)
  }

  const decline = () => {
    // The tokens are dropped unused. Someone signed in stays signed in.
    const hadSession = pending?.hasSession ?? false
    setPending(null)
    navigate(hadSession ? '/' : '/login', { replace: true })
  }

  // Local mode has no Supabase session to receive.
  if (!isSupabaseConfigured) return <Navigate to="/login" replace />

  if (pending) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-ink-900 px-4 pt-(--safe-top) pb-(--safe-bottom)">
        <div className="card w-full max-w-sm p-6 sm:p-8 animate-fade-rise" role="dialog" aria-labelledby="handoff-title">
          <div className="flex flex-col items-center text-center">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 flex items-center justify-center">
              <ShieldWarningIcon size={22} className="text-amber-700 dark:text-amber-400" aria-hidden />
            </div>
            <h1 id="handoff-title" className="mt-4 text-display text-lg font-semibold text-ink-50 [overflow-wrap:anywhere]">
              Continue as {pending.email}?
            </h1>
            <p className="mt-2 text-sm text-ink-200 leading-relaxed [overflow-wrap:anywhere]">
              {pending.replacing ? (
                <>
                  This signs <strong className="text-ink-50">{pending.replacing}</strong> out of DeskDev on this
                  device and opens the workspace as <strong className="text-ink-50">{pending.email}</strong>.
                </>
              ) : (
                <>This sign-in link wasn&apos;t started from this tab. Continue only if you just logged in as this account.</>
              )}
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" className="btn-primary w-full min-w-0 justify-center pointer-coarse:min-h-11 [overflow-wrap:anywhere]" onClick={() => void accept()} disabled={busy} autoFocus>
              {busy ? 'Signing you in…' : `Continue as ${pending.email}`}
            </button>
            <button type="button" className="btn-ghost w-full min-w-0 justify-center pointer-coarse:min-h-11 [overflow-wrap:anywhere]" onClick={decline} disabled={busy}>
              {pending.replacing ? `Stay signed in as ${pending.replacing}` : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-ink-900 px-4 pt-(--safe-top) pb-(--safe-bottom)">
      <div className="flex flex-col items-center text-center animate-fade-rise">
        <BrandMark size={44} />
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-200" role="status">
          <CircleNotchIcon size={14} className="animate-spin" aria-hidden />
          Signing you in…
        </p>
      </div>
    </div>
  )
}
