'use client';

import Link from 'next/link';
import { useEffect, useState, type ChangeEvent, type FocusEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleNotchIcon,
  EyeIcon,
  EyeSlashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { APP_URL, handoffUrl, isAuthConfigured, resetRedirect, supabase } from '@/lib/deskdev';
import { claimLoginHop, workspaceLoginUrl } from '@/lib/workspaceLogin';
import { buttonClass } from '@/components/site/Button';
import { Eyebrow } from '@/components/site/Typography';
import { PressScale } from '@/components/site/motion/PressScale';
import { LOGIN_TAP, RISE, riseStep } from '@/components/site/login/LoginStyles';
import { useSwapIn } from '@/components/site/login/useSwapIn';

// Reasons DeskDev can bounce someone back here with (?error=…).
const RETURN_ERRORS: Record<string, string> = {
  handoff: 'That sign-in link was incomplete. Please log in again.',
  session: 'Your session could not be started. Please log in again.',
};

type Mode = 'signin' | 'forgot' | 'sent';

type FieldName = 'email' | 'password';
const FIELDS: readonly FieldName[] = ['email', 'password'];

/** Plain, specific wording for an invalid field, shown under it (same words as the contact form). */
function errorFor(el: HTMLInputElement): string {
  if (el.validity.valid) return '';
  if (el.name === 'email') return el.validity.valueMissing ? 'Enter your email address.' : 'That email address looks incomplete.';
  return 'Enter your password.';
}

// Fields: 16px text stops iOS Safari zooming in on focus; an invalid field takes the danger border.
const field =
  'nx-input text-base aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--danger)_16%,transparent)]';

/**
 * Inline error under a field (label above, error below). It settles in from 4px above over 160ms
 * via @starting-style, so it reads as a response rather than a layout jump; reduced motion keeps
 * the fade only.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      className="mt-2.5 flex items-start gap-1.5 text-[0.8125rem] leading-snug text-danger transition-[opacity,translate] duration-[160ms] ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
    >
      <WarningCircleIcon size={16} aria-hidden className="mt-px shrink-0" />
      {message}
    </p>
  );
}

// Inline text action (Forgot password?, Back to log in, Start a project with us).
const textAction = `nx-link nx-login-link ${LOGIN_TAP} inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] font-medium text-accent-text hover:text-fg`;

// Island CTA: a full pill whose trailing arrow sits in its own disc, flush with the inner padding
// (pl-12 balances the 8px + 40px disc on the right so the label stays optically centred).
const islandCta = buttonClass(
  'primary',
  'lg',
  // active:transform-none: the PressScale wrapper owns the press (scale 0.97), not .nx-btn's own.
  'nx-login-cta w-full pl-12 pr-2 active:transform-none aria-busy:cursor-progress aria-busy:opacity-100',
);

function CtaDisc({ busy = false }: { busy?: boolean }) {
  return (
    <span aria-hidden className="nx-login-cta-disc grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15">
      {busy ? (
        <CircleNotchIcon size={18} className="animate-spin motion-reduce:animate-none" />
      ) : (
        <ArrowRightIcon size={18} />
      )}
    </span>
  );
}

export default function TeamLogin() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const cardRef = useSwapIn<HTMLDivElement>(mode);
  // The CSS intro plays once, on load; later mode swaps use useSwapIn instead.
  const [swapped, setSwapped] = useState(false);
  if (mode !== 'signin' && !swapped) setSwapped(true);
  const intro = swapped ? '' : RISE;
  const introAt = (step: number) => (swapped ? undefined : riseStep(step));

  const searchParams = useSearchParams();
  const returnCode = searchParams.get('error');
  const stateParam = searchParams.get('state');

  // A login opened here directly carries no DeskDev ?state=, so its handoff
  // would stop at "Continue as …?". Hop once through DeskDev's /login instead
  // (src/lib/workspaceLogin.ts): it opens the workspace for someone already signed in
  // there and sends anyone else back here with state. Until the hop is decided
  // (sessionStorage is client-only) a status replaces the form, so it doesn't flash.
  const [hopping, setHopping] = useState(isAuthConfigured && !stateParam && !returnCode);
  useEffect(() => {
    if (!isAuthConfigured) return;
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // blocked: no hop guard, so no hop
    }
    if (claimLoginHop({ state: stateParam, error: returnCode }, storage)) {
      window.location.replace(workspaceLoginUrl(searchParams.get('next')));
      return;
    }
    // Only knowable after mount; one re-render, to the form.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHopping(false);
    // Decided once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Shown until the first submit; after that only fresh errors matter.
  const returnError = returnCode && !submitted ? (RETURN_ERRORS[returnCode] ?? 'Please log in again.') : '';
  const shownError = error || returnError;

  const setFieldError = (name: FieldName, message: string) =>
    setFieldErrors((prev) => (prev[name] === (message || undefined) ? prev : { ...prev, [name]: message || undefined }));
  // Leaving a field: judge it only once something is typed (tabbing past isn't an error).
  const onFieldBlur = (e: FocusEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (el.value !== '' || fieldErrors[el.name as FieldName]) setFieldError(el.name as FieldName, errorFor(el));
  };
  // Fixing a flagged field: the message clears (or updates) as they type.
  const onFieldChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (fieldErrors[el.name as FieldName]) setFieldError(el.name as FieldName, errorFor(el));
  };
  const describe = (name: FieldName) =>
    [fieldErrors[name] ? `${name}-error` : undefined, shownError ? 'login-error' : undefined].filter(Boolean).join(' ') ||
    undefined;

  /** The browser's own constraints, reported inline instead of in native bubbles. True if any failed. */
  const blockedByFields = (form: HTMLFormElement) => {
    const fields = FIELDS.map((n) => form.elements.namedItem(n)).filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement,
    );
    const invalid = fields.filter((el) => !el.validity.valid);
    if (!invalid.length) return false;
    setFieldErrors(Object.fromEntries(fields.map((el) => [el.name, errorFor(el) || undefined])));
    invalid[0].focus();
    return true;
  };

  const signIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // aria-disabled (not disabled) keeps focus on the button while busy, so guard here.
    if (!supabase || busy || blockedByFields(e.currentTarget)) return;
    setError('');
    setSubmitted(true);
    setBusy(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (err || !data.session) {
      setBusy(false);
      setError(err?.message ?? 'Log in failed. Please try again.');
      return;
    }
    // Stay busy — the page is navigating away to DeskDev.
    const next = searchParams.get('next') ?? '/';
    // DeskDev's one-time ?state= goes back with the tokens (binds the handoff
    // to the tab that asked for it; see src/lib/deskdev.ts).
    const state = searchParams.get('state');
    window.location.replace(handoffUrl(data.session.access_token, data.session.refresh_token, next, state));
  };

  const sendReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // aria-disabled (not disabled) keeps focus on the button while busy, so guard here.
    if (!supabase || busy || blockedByFields(e.currentTarget)) return;
    setError('');
    setSubmitted(true);
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: resetRedirect(),
    });
    setBusy(false);
    if (err) setError(err.message);
    else setMode('sent');
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setFieldErrors({});
    // Leaving sign-in retires the ?error= notice too; it belongs to the original log-in attempt.
    setSubmitted(true);
  };

  const heading = mode === 'signin' ? 'Log in' : mode === 'forgot' ? 'Reset password' : 'Check your inbox';

  return (
    <div ref={cardRef} className="w-full max-w-[26rem]">
      {/* From `sm` up the header / photo-plate lockup already reads "Team workspace". */}
      <div className={`sm:hidden ${intro}`} style={introAt(0)}>
        <Eyebrow className="mb-5">Team workspace</Eyebrow>
      </div>
      <h1
        tabIndex={-1}
        className={`nx-h1 text-[clamp(2.5rem,4.2vw,3.5rem)] focus:outline-none ${intro}`}
        style={introAt(1)}
      >
        {heading}
      </h1>

      {hopping ? (
        <p className={`nx-body mt-6 flex items-center gap-2.5 ${intro}`} style={introAt(2)} role="status">
          <CircleNotchIcon size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
          Opening the workspace…
        </p>
      ) : !isAuthConfigured ? (
        <div className={`mt-6 flex flex-col gap-8 ${intro}`} style={introAt(2)}>
          <p className="nx-body">Team sign-in isn&apos;t configured on this deployment yet.</p>
          <PressScale className="w-full">
            <a href={`${APP_URL}/login?direct=1`} className={islandCta}>
              <span className="flex-1 text-center">Open the workspace</span>
              <CtaDisc />
            </a>
          </PressScale>
        </div>
      ) : mode === 'sent' ? (
        <div className="mt-6 flex flex-col gap-8" role="status">
          <p className="nx-body max-w-[40ch]">
            If an account exists for <strong className="break-all font-semibold text-fg">{email}</strong>, a reset link
            is on its way. It opens the workspace, where you can set a new password.
          </p>
          <button type="button" onClick={() => switchMode('signin')} className={`${textAction} self-start`}>
            <ArrowLeftIcon size={16} aria-hidden /> Back to log in
          </button>
        </div>
      ) : (
        <>
          <div className={`mt-5 ${intro}`} style={introAt(2)}>
            <p className="nx-body max-w-[40ch]">
              {mode === 'signin'
                ? 'Use the email and password for your NixGen workspace account.'
                : 'Enter your account email and we’ll send you a link to set a new password.'}
            </p>
            {mode === 'signin' && <p className="nx-small mt-2">Accounts are created by a studio admin.</p>}
          </div>

          {/* Fields never animate: people type (or autofill) the moment the page appears. */}
          <form noValidate onSubmit={mode === 'signin' ? signIn : sendReset} className="mt-8 flex flex-col sm:mt-10 lg:mt-8">
            <label htmlFor="email" className="nx-label">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint={mode === 'signin' ? 'next' : 'send'}
              inputMode="email"
              className={field}
              placeholder="you@nixgensolutions.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                onFieldChange(e);
              }}
              onBlur={onFieldBlur}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={describe('email')}
              required
            />
            <FieldError id="email-error" message={fieldErrors.email} />

            {mode === 'signin' && (
              <>
                <label htmlFor="password" className="nx-label mt-6">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    enterKeyHint="go"
                    className={`${field} pr-14`}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      onFieldChange(e);
                    }}
                    onBlur={onFieldBlur}
                    aria-invalid={fieldErrors.password ? true : undefined}
                    aria-describedby={describe('password')}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className={`${LOGIN_TAP} absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-[0.6rem] text-fg-3 hover:bg-surface-2 hover:text-fg`}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeSlashIcon size={18} aria-hidden /> : <EyeIcon size={18} aria-hidden />}
                  </button>
                </div>
                <FieldError id="password-error" message={fieldErrors.password} />
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className={`${textAction} mt-1 self-end`}
                >
                  Forgot password?
                </button>
              </>
            )}

            {/* Inline, under the fields it is about, and announced (role="alert"). */}
            {shownError && (
              <div id="login-error" role="alert" className="nx-alert nx-login-alert mt-5 flex items-start gap-2.5 leading-normal">
                <WarningCircleIcon size={18} className="mt-[0.0625rem] shrink-0" aria-hidden />
                <span>{shownError}</span>
              </div>
            )}

            {/* aria-disabled (not disabled) keeps focus on the button while busy. */}
            <PressScale className={`w-full ${mode === 'signin' ? 'mt-5' : 'mt-8'}`}>
              <button type="submit" aria-disabled={busy || undefined} aria-busy={busy || undefined} className={islandCta}>
                <span className="flex-1 text-center">
                  {mode === 'signin' ? (busy ? 'Logging in…' : 'Log in') : busy ? 'Sending…' : 'Send reset link'}
                </span>
                <CtaDisc busy={busy} />
              </button>
            </PressScale>

            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className={`${textAction} mt-4 self-center`}
              >
                <ArrowLeftIcon size={16} aria-hidden /> Back to log in
              </button>
            )}
          </form>

          <div className="mt-8 border-t border-line pt-6 text-center sm:mt-10 lg:mt-8">
            <p className="text-[0.875rem] text-fg-3">
              Not on the team?{' '}
              <Link href="/contact" className={textAction}>
                Start a project with us
              </Link>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
