import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftIcon, CheckIcon, CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react'
import BrandMark from '../components/ui/BrandMark'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { isStandalone } from '../pwa/platform'

// Landing page for Supabase password-recovery links (sent from the "Forgot
// password?" affordance on Login). The email link redirects here with a
// recovery token in the URL; supabase-js parses it into a temporary session
// and fires PASSWORD_RECOVERY, after which updateUser({ password }) works.
// This route is registered OUTSIDE AuthGate — recovery links arrive
// unauthenticated.
//
// DeskDev is invite-only by design: there is NO public signup. This page only
// ever resets the password of an existing, admin-invited account.
//
// Email links open in the browser, never in the installed app (and on iOS the
// app keeps its own storage), so this usually runs in a browser tab while the
// person's real home is the app — the copy says to go back there and sign in.

type Phase = 'checking' | 'ready' | 'invalid' | 'done'

// The sign-in page's form language: 14px labels above, 40px fields (44px under
// a finger), and an inline alert with its own mark, never colour alone.
const LABEL = 'block text-sm font-medium text-ink-100 mb-1.5'
const FIELD =
  'input w-full h-10 pointer-coarse:h-11 aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20'

/** A field's own problem, under the field it belongs to (the input points at it). */
function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm leading-snug text-rose-700 dark:text-rose-300 animate-route">
      <WarningCircleIcon size={14} className="mt-[3px] shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function Alert({ children }: { children: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-left text-sm leading-snug text-rose-700 dark:text-rose-300 animate-route"
      role="alert"
      aria-live="assertive"
    >
      <WarningCircleIcon size={15} className="mt-px shrink-0" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </div>
  )
}

/** Supabase appends error details to the URL when a link is expired/used. */
function urlErrorDescription(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  return hash.get('error_description') ?? query.get('error_description')
}

/** Shown in a browser tab: the installed app needs its own sign-in afterwards. */
function AppNote() {
  if (isStandalone()) return null
  return (
    <p className="mt-3 text-xs text-ink-300 leading-relaxed">
      Use DeskDev as an app on your phone or computer? Go back to it afterwards and sign in there with
      your new password.
    </p>
  )
}

function Shell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center bg-ink-900 px-4 pt-[calc(var(--safe-top)+1.5rem)] pb-[calc(var(--safe-bottom)+1.5rem)]">
      <div className="card w-full max-w-sm p-6 sm:p-8 animate-fade-rise">
        <div className="flex flex-col items-center text-center">
          <BrandMark size={44} />
          <h1 className="text-display text-2xl font-medium mt-4 text-ink-50">DeskDev Studio</h1>
          <p className="mt-1 text-sm text-ink-200">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  )
}

export default function ResetPassword() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Checked here before anything is sent; each shows under its own field.
  const [fieldError, setFieldError] = useState<{ field: 'password' | 'confirm'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true

    // PASSWORD_RECOVERY fires once supabase-js has parsed the recovery token
    // from the URL. getSession() (which waits for that URL detection) covers
    // the case where the event already fired before this effect subscribed.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setPhase((p) => (p === 'done' ? p : 'ready'))
      }
    })
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setPhase((p) => (p === 'checking' ? (data.session ? 'ready' : 'invalid') : p))
    })

    return () => {
      active = false
      authSub.subscription.unsubscribe()
    }
  }, [])

  // Local mode has no email delivery and no Supabase auth — passwords are
  // managed by an admin in Settings, so recovery links can't exist here.
  if (!isSupabaseConfigured) {
    return (
      <Shell subtitle="Reset your password">
        <div className="mt-6 text-center">
          <p className="text-sm text-ink-100">Password reset isn&apos;t available in local mode.</p>
          <p className="mt-2 text-xs text-ink-200 leading-relaxed">
            This workspace runs without a hosted backend — accounts and passwords are managed by
            your admin in Settings. Use the demo accounts on the sign-in page.
          </p>
          <Link to="/login" className="btn-primary mt-5 pointer-coarse:min-h-11">
            <ArrowLeftIcon size={14} aria-hidden />
            Back to sign in
          </Link>
        </div>
      </Shell>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setFieldError(null)
    if (password.length < 8) {
      setFieldError({ field: 'password', message: 'Password must be at least 8 characters.' })
      document.getElementById('reset-password')?.focus()
      return
    }
    if (password !== confirm) {
      setFieldError({ field: 'confirm', message: 'Passwords do not match.' })
      document.getElementById('reset-confirm')?.focus()
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setBusy(false)
      setError(err.message)
      return
    }
    // The recovery session is temporary — sign out so the user signs in
    // normally (login() also loads their profile into the store). Global on
    // purpose: after a password change every other session, the installed
    // app's included, should have to use the new one.
    await supabase.auth.signOut()
    setBusy(false)
    setPhase('done')
  }

  if (phase === 'checking') {
    return (
      <Shell subtitle="Reset your password">
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-300">
          <CircleNotchIcon size={16} className="animate-spin" aria-hidden />
          Checking your reset link…
        </div>
      </Shell>
    )
  }

  if (phase === 'invalid') {
    return (
      <Shell subtitle="Reset your password">
        <div className="mt-6 text-center">
          <Alert>{urlErrorDescription() ?? 'This reset link is invalid or has expired.'}</Alert>
          <p className="mt-3 text-xs text-ink-200">
            Request a new link from the sign-in page with &ldquo;Forgot password?&rdquo;.
          </p>
          <Link to="/login" className="btn-primary mt-5 pointer-coarse:min-h-11">
            <ArrowLeftIcon size={14} aria-hidden />
            Back to sign in
          </Link>
        </div>
      </Shell>
    )
  }

  if (phase === 'done') {
    return (
      <Shell subtitle="Reset your password">
        <div className="mt-6 text-center">
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <CheckIcon size={18} className="text-emerald-700 dark:text-emerald-400" aria-hidden />
          </div>
          <p className="mt-3 text-sm font-medium text-ink-50">Password updated</p>
          <p className="mt-1 text-xs text-ink-200">Sign in with your new password.</p>
          <AppNote />
          <Link to="/login" className="btn-primary mt-5 pointer-coarse:min-h-11">Sign in here</Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell subtitle="Choose a new password">
      {/* noValidate: the checks below speak under each field, not in a browser bubble. */}
      <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="reset-password" className={LABEL}>
            New password
          </label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className={FIELD}
            placeholder="At least 8 characters"
            value={password}
            aria-invalid={fieldError?.field === 'password' || undefined}
            aria-describedby={fieldError?.field === 'password' ? 'reset-password-error' : undefined}
            onChange={(e) => {
              setPassword(e.target.value)
              if (fieldError) setFieldError(null)
            }}
          />
          {fieldError?.field === 'password' && <FieldError id="reset-password-error">{fieldError.message}</FieldError>}
        </div>
        <div>
          <label htmlFor="reset-confirm" className={LABEL}>
            Confirm password
          </label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            enterKeyHint="go"
            required
            minLength={8}
            className={FIELD}
            value={confirm}
            aria-invalid={fieldError?.field === 'confirm' || undefined}
            aria-describedby={fieldError?.field === 'confirm' ? 'reset-confirm-error' : undefined}
            onChange={(e) => {
              setConfirm(e.target.value)
              if (fieldError) setFieldError(null)
            }}
          />
          {fieldError?.field === 'confirm' && <FieldError id="reset-confirm-error">{fieldError.message}</FieldError>}
        </div>

        {error && <Alert>{error}</Alert>}

        <button type="submit" className="btn-primary w-full justify-center h-10 pointer-coarse:h-11" disabled={busy}>
          {busy && <CircleNotchIcon size={14} className="animate-spin" aria-hidden />}
          {busy ? 'Saving…' : 'Set new password'}
        </button>
        <AppNote />
      </form>
    </Shell>
  )
}
