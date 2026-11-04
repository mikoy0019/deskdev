import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon, CircleNotchIcon, EnvelopeSimpleOpenIcon, WarningCircleIcon,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { safeNext, siteLoginUrl, usesSiteLogin } from '../lib/siteLogin'
import { withBase } from '../lib/basePath'
import { useIsStandalone } from '../pwa/useMediaQuery'
import { Magnetic } from '../components/motion'
import BrandMark, { BRAND_D_PATH } from '../components/ui/BrandMark'

// DeskDev is invite-only by design: there is NO public signup. Accounts are
// created by an admin (local mode: users managed in Settings; remote mode:
// Supabase invites), so this page only offers sign-in + password recovery.
//
// In a browser tab in remote mode, sign-in lives on the NixGen site's Team
// login (/login) and this page just forwards there; /workspace/login?direct=1
// keeps the in-app form reachable as an escape hatch. The installed app always
// uses the form here: the site's /login is outside its scope, which iOS opens
// in a separate sheet with its own storage and Android under a browser toolbar.

/** Why the user landed here — set by AuthCallback and the session checks. */
const RETURN_ERRORS: Record<string, string> = {
  handoff: 'That sign-in link was incomplete. Please sign in again.',
  session: 'Your session could not be started. Please sign in again.',
  expired: 'Your session has ended. Please sign in again.',
}

// Phones get the form straight on the page, like a native sign-in screen; from
// `sm` it sits in a lifted card over a faint hairline grid (the site's
// nx-grid-bg at workspace volume — decoration only, masked to fade out); from
// `lg` the screen splits: the form on the page at left, the studio's mark in
// a nested panel at right.
const ALERT =
  'flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-sm leading-snug text-rose-700 dark:text-rose-300'
const LABEL = 'block text-sm font-medium text-ink-100'
const FIELD =
  'input w-full h-10 pointer-coarse:h-11 aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20'
const ACTION = 'w-full justify-center h-10 pointer-coarse:h-11'
const GRID_MASK = 'radial-gradient(ellipse 60% 62% at 50% 46%, #000 30%, transparent 78%)'
const GRID_BG = {
  backgroundImage:
    'linear-gradient(to right, rgb(var(--ink-600) / 0.6) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--ink-600) / 0.6) 1px, transparent 1px)',
  backgroundSize: '56px 56px',
  backgroundPosition: 'center center',
  maskImage: GRID_MASK,
  WebkitMaskImage: GRID_MASK,
}

/** A field's own problem, under the field it belongs to (the input points at it). */
function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm leading-snug text-rose-700 dark:text-rose-300 animate-route">
      <WarningCircleIcon size={14} className="mt-[3px] shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

type Field = 'email' | 'password'

/** What is wrong with what was typed, before anything is sent. */
function checkFields(email: string, password: string | null): { field: Field; message: string } | null {
  const address = email.trim()
  if (!address) return { field: 'email', message: 'Enter your email.' }
  if (!/^\S+@\S+\.\S+$/.test(address)) return { field: 'email', message: 'Enter a valid email address.' }
  if (password !== null && !password) return { field: 'password', message: 'Enter your password.' }
  return null
}

// A mouse or trackpad: the caret starts in the email field. Not under a
// finger, where focusing a field would raise the keyboard over the page.
const FINE_POINTER =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches

function Alert({ id, children }: { id?: string; children: string }) {
  return (
    // animate-route: a 120ms fade so the message doesn't pop — none when the
    // form was sent with Enter (keyboard-initiated).
    <div id={id} className={`${ALERT} animate-route`} role="alert" aria-live="assertive">
      <WarningCircleIcon size={15} className="mt-px shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export default function Login() {
  const login = useStore((s) => s.login)
  const currentUserId = useStore((s) => s.currentUserId)
  const navigate = useNavigate()
  const location = useLocation()
  const standalone = useIsStandalone()
  const params = new URLSearchParams(location.search)
  // AuthGate passes the page you were bounced from, so sign-in returns there;
  // the site's Team login links (workspaceLoginUrl) pass it as ?next=.
  const next = safeNext((location.state as { from?: string } | null)?.from ?? params.get('next'))
  const returnCode = params.get('error')
  const toSite = usesSiteLogin && !standalone && !currentUserId && !params.has('direct')

  useEffect(() => {
    if (toSite) window.location.replace(siteLoginUrl({ next, error: returnCode ?? undefined }))
  }, [toSite, next, returnCode])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: Field; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // The ?error= reason stays up until the next attempt.
  const [attempted, setAttempted] = useState(false)

  // Forgot-password view. Remote mode only — local mode has no email delivery
  // (passwords live in the local users slice), so the affordance is hidden and
  // the demo-accounts panel below covers credentials instead.
  const [forgot, setForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  if (currentUserId) return <Navigate to={next} replace />

  if (toSite) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-ink-900 p-4">
        <p className="flex items-center gap-2.5 text-sm text-ink-200" role="status">
          <CircleNotchIcon size={15} className="animate-spin text-brand-600 dark:text-brand-400" aria-hidden />
          Redirecting to sign in…
        </p>
      </div>
    )
  }

  const returnError = returnCode && !attempted ? (RETURN_ERRORS[returnCode] ?? 'Please sign in again.') : null
  const shownError = error ?? returnError

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setAttempted(true)
    const problem = checkFields(email, password)
    setFieldError(problem)
    if (problem) {
      document.getElementById(`login-${problem.field}`)?.focus()
      return
    }
    setBusy(true)
    const result = await login(email, password)
    setBusy(false)
    // replace: Android's back button must not land on the sign-in form.
    if (result.ok) navigate(next, { replace: true })
    else setError(result.error ?? 'Sign-in failed')
  }

  const onSendReset = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setAttempted(true)
    const problem = checkFields(email, null)
    setFieldError(problem)
    if (problem) {
      document.getElementById('reset-email')?.focus()
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}${withBase('/reset-password')}`,
    })
    setBusy(false)
    if (err) setError(err.message)
    else setResetSent(true)
  }

  const backToSignIn = () => {
    setForgot(false)
    setResetSent(false)
    setError(null)
    setFieldError(null)
  }

  // The three views (sign in, reset form, link sent) swap with a short fade.
  const view = forgot ? (resetSent ? 'sent' : 'forgot') : 'signin'

  return (
    <div className="relative isolate min-h-dvh grid bg-ink-900 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="relative flex flex-col items-center justify-center overflow-hidden px-5 sm:px-6 lg:px-12 pt-[calc(var(--safe-top)+1.5rem)] pb-[calc(var(--safe-bottom)+1.5rem)]">
      <div className="pointer-events-none absolute inset-0 -z-10 hidden sm:block lg:hidden" style={GRID_BG} aria-hidden />
      <div className="w-full max-w-[400px] animate-fade-rise sm:overflow-hidden sm:rounded-[var(--radius-lg)] sm:border sm:border-ink-600 sm:bg-ink-800 sm:shadow-[var(--shadow-3)] lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none">
        <div className="sm:p-8 lg:p-0">
          <BrandMark size={40} className="lg:hidden" />
          <div key={view} className="animate-route">
          <h1 className="text-display text-[1.75rem] leading-[1.15] font-medium mt-6 text-ink-50 lg:mt-0 lg:text-[2rem]">
            {forgot ? 'Reset your password' : 'Sign in to DeskDev'}
          </h1>
          <p className="mt-2 text-sm text-ink-300">
            {forgot ? 'We’ll email you a link to choose a new one.' : 'Your DeskDev Studio workspace'}
          </p>

          {forgot ? (
            resetSent ? (
              <div className="mt-8">
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 shrink-0 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                      <EnvelopeSimpleOpenIcon size={16} className="text-emerald-700 dark:text-emerald-400" aria-hidden />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-medium text-ink-50">Check your inbox</p>
                      <p className="mt-1 text-sm leading-snug text-ink-200">
                        If an account exists for that email, a reset link is on its way.
                      </p>
                    </div>
                  </div>
                  {standalone && (
                    <p className="mt-3 border-t border-emerald-500/20 pt-3 text-sm text-ink-200 leading-relaxed">
                      The link opens in your browser. Set your new password there, then come back to this app and sign in.
                    </p>
                  )}
                </div>
                <button type="button" className={`btn-secondary mt-6 ${ACTION}`} onClick={backToSignIn}>
                  <ArrowLeftIcon size={14} aria-hidden />
                  Back to sign in
                </button>
              </div>
            ) : (
              // noValidate: the checks speak under the field, not in a browser bubble.
              <form className="mt-8 space-y-4" onSubmit={onSendReset} noValidate>
                <div>
                  <label htmlFor="reset-email" className={`${LABEL} mb-1.5`}>
                    Email
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="send"
                    required
                    autoFocus={FINE_POINTER}
                    className={FIELD}
                    placeholder="you@company.com"
                    value={email}
                    aria-invalid={error || fieldError ? true : undefined}
                    aria-describedby={fieldError ? 'reset-email-error' : error ? 'reset-error' : undefined}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (fieldError) setFieldError(null)
                    }}
                  />
                  {fieldError && <FieldError id="reset-email-error">{fieldError.message}</FieldError>}
                </div>

                {error && <Alert id="reset-error">{error}</Alert>}

                <div className="space-y-2 pt-2">
                  <button type="submit" className={`btn-primary ${ACTION}`} disabled={busy}>
                    {busy && <CircleNotchIcon size={14} className="animate-spin" aria-hidden />}
                    {busy ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button type="button" className={`btn-ghost ${ACTION}`} onClick={backToSignIn}>
                    <ArrowLeftIcon size={14} aria-hidden />
                    Back to sign in
                  </button>
                </div>
              </form>
            )
          ) : (
            <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="login-email" className={`${LABEL} mb-1.5`}>
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  required
                  autoFocus={FINE_POINTER}
                  className={FIELD}
                  placeholder="you@company.com"
                  value={email}
                  aria-invalid={error || fieldError?.field === 'email' ? true : undefined}
                  aria-describedby={
                    fieldError?.field === 'email' ? 'login-email-error' : shownError ? 'login-error' : undefined
                  }
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (fieldError) setFieldError(null)
                  }}
                />
                {fieldError?.field === 'email' && <FieldError id="login-email-error">{fieldError.message}</FieldError>}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className={LABEL}>
                    Password
                  </label>
                  {isSupabaseConfigured && (
                    <button
                      type="button"
                      className="rounded-sm text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors duration-150 ease-[ease] pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
                      onClick={() => {
                        setForgot(true)
                        setError(null)
                        setFieldError(null)
                      }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  required
                  // No placeholder: a row of bullets read as a saved password.
                  className={FIELD}
                  value={password}
                  aria-invalid={error || fieldError?.field === 'password' ? true : undefined}
                  aria-describedby={
                    fieldError?.field === 'password' ? 'login-password-error' : shownError ? 'login-error' : undefined
                  }
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (fieldError) setFieldError(null)
                  }}
                />
                {fieldError?.field === 'password' && <FieldError id="login-password-error">{fieldError.message}</FieldError>}
              </div>

              {shownError && <Alert id="login-error">{shownError}</Alert>}

              <div className="pt-2">
                {/* A rare, once-a-session surface: the CTA leans toward a mouse
                    (decorative spring, fine pointers only, off under reduced motion). */}
                <Magnetic className="w-full">
                  <button type="submit" className={`btn-primary ${ACTION}`} disabled={busy}>
                    {busy && <CircleNotchIcon size={14} className="animate-spin" aria-hidden />}
                    {busy ? 'Signing in…' : 'Sign in'}
                  </button>
                </Magnetic>
              </div>
            </form>
          )}
          </div>
        </div>

        {!forgot && (
          <div className="mt-8 border-t border-ink-600 pt-5 sm:mt-0 sm:bg-ink-850/70 sm:px-8 sm:pb-5 lg:mt-10 lg:bg-transparent lg:px-0 lg:pb-0">
            {isSupabaseConfigured ? (
              <p className="text-xs leading-relaxed text-ink-300">
                Accounts are created by a studio admin. Ask yours for an invite.
              </p>
            ) : (
              // Local mode only: these accounts exist in the seeded local store,
              // never on a real Supabase project.
              <>
                <div className="section-title mb-2.5">Demo accounts</div>
                <dl className="space-y-1.5 font-mono text-xs text-ink-200">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-100 truncate">admin@deskdev.local</dt>
                    <dd className="text-ink-300">admin</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-100 truncate">member@deskdev.local</dt>
                    <dd className="text-ink-300">member</dd>
                  </div>
                </dl>
              </>
            )}
          </div>
        )}
      </div>
      </main>

      {/* lg+: the studio's mark in a nested panel — an outer tray with a
          hairline and a recessed core with its own top highlight (double
          bezel). The app icon's "D" is drawn again at architectural scale as a
          hairline outline, cropped by the panel, over the fading grid; the
          areas of the workspace sit above the name. Decoration only. */}
      <aside className="hidden lg:block p-3 pl-0" aria-hidden>
        <div className="h-full rounded-[1.5rem] bg-ink-850 p-2 ring-1 ring-ink-600">
          <div className="relative isolate flex h-full flex-col justify-between overflow-hidden rounded-[calc(1.5rem-0.5rem)] bg-ink-800 p-10 ring-1 ring-ink-600 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)] dark:bg-ink-900">
            <div className="pointer-events-none absolute inset-0 -z-10" style={GRID_BG} />
            <svg
              viewBox="9.5 7.5 15 17"
              className="pointer-events-none absolute -z-10 -right-[12%] top-1/2 h-[82%] -translate-y-1/2 text-ink-500 dark:text-ink-600"
              fill="none"
            >
              <path d={BRAND_D_PATH} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="flex items-center gap-2.5">
              <BrandMark size={32} />
              <span className="section-title">Client operations</span>
            </div>
            <div>
              <p className="font-mono text-xs tracking-wide text-ink-300">
                Projects / Tasks / Clients / CRM / Calendar / Channels
              </p>
              <p className="mt-5 text-display text-5xl xl:text-6xl font-medium leading-[0.95] tracking-[-0.04em] text-ink-50">
                DeskDev
                <br />
                Studio
              </p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
