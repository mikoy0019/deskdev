'use client';

import Link from 'next/link';
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowRightIcon, CheckCircleIcon, CircleNotchIcon, GithubLogoIcon, LinkedinLogoIcon, TwitterLogoIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { ThemeToggle } from '@/components/site/ThemeToggle';
import { ConsentCheck } from '@/components/site/contact/ConsentCheck';
import { Turnstile, TURNSTILE_SITE_KEY } from '@/components/site/contact/Turnstile';
import { Parallax } from '@/components/site/motion/Parallax';
import { CONTACT_EMAIL, SERVICE_LINKS } from '@/lib/seo';

const navGroups = [
  {
    label: 'Services',
    // Shared with the Service list in the page's structured data (src/lib/seo.ts).
    items: SERVICE_LINKS,
  },
  {
    label: 'Resources',
    items: [
      { label: 'Portfolio', href: '/portfolio' },
      { label: 'Process', href: '/process' },
      { label: 'About Studio', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  },
];

// `href: null` until the owner supplies the NixGen profile URL: a button that
// opens the service's own homepage is a dead end, so it is not rendered at all.
const socialProfiles: { label: string; href: string | null; icon: ReactNode }[] = [
  { label: 'Twitter', href: null, icon: <TwitterLogoIcon size={18} aria-hidden /> },
  { label: 'GitHub', href: null, icon: <GithubLogoIcon size={18} aria-hidden /> },
  { label: 'LinkedIn', href: null, icon: <LinkedinLogoIcon size={18} aria-hidden /> },
];
const socials = socialProfiles.filter((s): s is typeof s & { href: string } => Boolean(s.href));

const legal = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Shown when /api/subscribe cannot be reached or answers without its own message. */
const SUBSCRIBE_FAILED = 'Could not subscribe you right now. Please try again later.';
const SUBSCRIBE_WAIT_MS = 10_000;
/** How long a submit waits for the Turnstile challenge before posting without a token. */
const TURNSTILE_WAIT_MS = 8_000;
/** The check never produced a token (script blocked, offline, challenge stuck): retrying cannot help, so point to the mailbox. */
const VERIFY_BLOCKED = `We could not verify your browser. Email ${CONTACT_EMAIL} and we will add you.`;

const focusOnMount = (el: HTMLElement | null) => el?.focus({ preventScroll: true });

/**
 * POSTs the address to /api/subscribe. Resolves to '' on success, else the
 * message to show. The route answers the same for a new and a known address,
 * so nothing here can tell them apart either.
 */
async function subscribe(email: string, turnstileToken: string, honey: string): Promise<string> {
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'footer', consent: true, turnstileToken: turnstileToken || undefined, _honey: honey }),
      signal: AbortSignal.timeout(SUBSCRIBE_WAIT_MS),
    });
    const body = (await res.json().catch(() => null)) as { success?: unknown; error?: unknown } | null;
    if (res.ok && body?.success === true) return '';
    // 403 is the Turnstile refusal: without a token another try fails the same way.
    if (res.status === 403 && !turnstileToken) return VERIFY_BLOCKED;
    return typeof body?.error === 'string' && body.error ? body.error : SUBSCRIBE_FAILED;
  } catch {
    return SUBSCRIBE_FAILED;
  }
}

/** Tap behaviour for the footer's controls: no double-tap delay, no flash, no long-press selection. */
const TAP = 'touch-manipulation select-none [-webkit-tap-highlight-color:transparent]';

export function Footer() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  // Two kinds of failure, kept apart: `error` is the address itself (the field
  // turns red and is marked invalid); `sendError` is the server or the network
  // refusing a valid address, which is not the field's fault.
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [isSending, setIsSending] = useState(false);
  // The footer is on every page: the Turnstile script is only requested once
  // someone starts on this form.
  const [engaged, setEngaged] = useState(false);
  const [turnstileRound, setTurnstileRound] = useState(0);
  // Refs, not state: a submit that is already waiting has to see the token the moment it lands.
  const token = useRef('');
  const widgetBlocked = useRef(false);
  const tokenWaiter = useRef<((token: string) => void) | null>(null);
  const handleToken = useCallback((value: string) => {
    token.current = value;
    if (value) {
      widgetBlocked.current = false;
      tokenWaiter.current?.(value);
    }
  }, []);
  const handleBlocked = useCallback(() => {
    widgetBlocked.current = true;
    tokenWaiter.current?.('');
  }, []);
  const errorId = useId();
  const sendErrorId = useId();
  const consentErrorId = useId();

  const handleSubscribe = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSending) return;
    const value = email.trim();
    const emailError = EMAIL.test(value)
      ? ''
      : value
        ? 'Enter a full email address, like name@company.com.'
        : 'Enter your email address to subscribe.';
    // Consent is the tick, never the button press alone.
    const missingConsent = consent ? '' : 'Tick the box to subscribe.';
    setError(emailError);
    setSendError('');
    setConsentError(missingConsent);
    if (emailError || missingConsent) {
      // Focus goes to the first thing to fix, as on the contact form (the button keeps it otherwise).
      document.getElementById(emailError ? 'footer-email' : 'footer-consent')?.focus();
      return;
    }

    const honey = String(new FormData(e.currentTarget).get('_honey') ?? '').trim();
    // A filled honeypot is a bot: look like success, send nothing.
    if (honey) {
      setSubscribed(true);
      return;
    }

    setIsSending(true);
    // /api/subscribe refuses a sign-up without a token, and the widget loads
    // on first focus: hold the sending state until the challenge answers
    // (Enter can beat it). Capped, then the route decides.
    if (TURNSTILE_SITE_KEY && !token.current) {
      setEngaged(true);
      // The script failed earlier: draw the widget again rather than wait on nothing.
      if (widgetBlocked.current) {
        widgetBlocked.current = false;
        setTurnstileRound((n) => n + 1);
      }
      await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve(''), TURNSTILE_WAIT_MS);
        tokenWaiter.current = (t) => {
          clearTimeout(timer);
          resolve(t);
        };
      });
      tokenWaiter.current = null;
    }
    const sentToken = token.current;
    const failure = await subscribe(value, sentToken, honey);
    setIsSending(false);
    if (failure) {
      setSendError(failure);
      // A Turnstile token verifies once: the retry gets a fresh widget. With
      // no token there is nothing spent, and the widget in place may still answer.
      if (sentToken) {
        token.current = '';
        setTurnstileRound((n) => n + 1);
      }
      return;
    }
    setSubscribed(true);
    setEmail('');
  };

  return (
    <footer className="relative overflow-hidden border-t border-line bg-bg-2">
      <div className="nx-wrap pt-[clamp(4.5rem,9vw,7.5rem)]">
        {/* Two columns below lg (the link groups sit side by side), twelve from lg. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-14 lg:grid-cols-12 lg:gap-10">
          {/* Brand + dispatch */}
          <div className="col-span-2 flex flex-col gap-8 lg:col-span-5">
            <Link prefetch={false} href="/" className={`inline-flex min-h-11 w-fit items-center ${TAP}`} aria-label="NixGen — home">
              <span className="font-heading text-xl font-semibold tracking-[0.14em] text-fg">
                NIXGEN<span className="text-accent-text">.</span>
              </span>
            </Link>
            <p className="nx-body max-w-sm">
              Premium websites, branding, automation, and SEO for service businesses&nbsp;— designed and built by a senior
              team that gives a damn.
            </p>

            <div className="max-w-md">
              <p className="nx-eyebrow mb-3">Dispatch</p>
              <p className="nx-small mb-5">Receive periodic updates on AI-powered growth systems and digital strategy.</p>
              {subscribed ? (
                // The form (and the focused field or button) is gone: focus moves here, not back to the top of the page.
                <p
                  ref={focusOnMount}
                  tabIndex={-1}
                  className="flex items-center gap-2 text-sm text-accent-text outline-none [transition:opacity_300ms_var(--ease-out)] starting:opacity-0"
                  role="status"
                >
                  <CheckCircleIcon size={18} aria-hidden className="shrink-0" />
                  Subscribed. Welcome aboard.
                </p>
              ) : (
                // method="post": a submit that beats hydration must not put the address in the URL.
                // Without JavaScript the form is hidden (nx-js-only) and the line below it stands in.
                <form onSubmit={handleSubscribe} onFocus={() => setEngaged(true)} method="post" noValidate className="nx-js-only flex flex-col gap-2">
                  {/* Bot trap: hidden from people and screen readers; /api/subscribe drops any sign-up that fills it. */}
                  <input type="text" name="_honey" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ display: 'none' }} />
                  {/* Label above the field, error below it. */}
                  <label htmlFor="footer-email" className="text-[0.8125rem] font-medium text-fg">
                    Email address
                  </label>
                  {/* Double bezel: a hairline tray around the field, the submit nested flush at its right end. */}
                  <div className="relative">
                    <input
                      id="footer-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      enterKeyHint="send"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError('');
                        if (sendError) setSendError('');
                      }}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      // 16px text so iOS doesn't zoom the page on focus.
                      className={`block h-14 w-full rounded-full border bg-surface pl-5 pr-16 text-base text-fg shadow-[inset_0_1px_2px_rgb(2_4_10/0.06)] outline-none [transition:border-color_200ms_ease,box-shadow_200ms_ease] placeholder:text-fg-3 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_38%,transparent)] ${
                        error ? 'border-danger' : 'border-line-2'
                      }`}
                    />
                    <button
                      type="submit"
                      // Stays focusable while sending (aria-disabled, not disabled), so focus is not dropped.
                      aria-disabled={isSending || undefined}
                      aria-busy={isSending}
                      className={`nx-btn nx-btn-primary absolute right-1.5 top-1.5 !h-11 !w-11 !px-0 shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] [transition:background-color_200ms_ease,scale_var(--dur-press)_var(--ease-out)] active:[transform:none] active:scale-[0.97] motion-reduce:active:scale-100 ${TAP}`}
                      aria-label="Subscribe"
                    >
                      {isSending ? (
                        <CircleNotchIcon size={16} aria-hidden style={{ animationDuration: '700ms' }} className="motion-safe:animate-spin" />
                      ) : (
                        <ArrowRightIcon size={16} aria-hidden />
                      )}
                    </button>
                  </div>
                  {error && (
                    <p
                      id={errorId}
                      role="alert"
                      className="flex items-center gap-1.5 pl-1 text-[0.8125rem] text-danger [transition:opacity_200ms_var(--ease-out)] starting:opacity-0"
                    >
                      <WarningCircleIcon size={16} aria-hidden className="shrink-0" />
                      {error}
                    </p>
                  )}
                  <ConsentCheck
                    id="footer-consent"
                    name="consent"
                    required
                    checked={consent}
                    invalid={Boolean(consentError)}
                    describedBy={consentError ? consentErrorId : undefined}
                    onChange={(e) => {
                      setConsent(e.currentTarget.checked);
                      if (consentError) setConsentError('');
                    }}
                    className="pl-1"
                  >
                    Email me these updates. See the{' '}
                    <Link prefetch={false}
                      href="/privacy"
                      className="text-fg underline decoration-line-2 underline-offset-4 [transition:text-decoration-color_150ms_ease] hover:decoration-fg"
                    >
                      Privacy Policy
                    </Link>
                    .
                  </ConsentCheck>
                  {consentError && (
                    <p
                      id={consentErrorId}
                      role="alert"
                      className="flex items-center gap-1.5 pl-1 text-[0.8125rem] text-danger [transition:opacity_200ms_var(--ease-out)] starting:opacity-0"
                    >
                      <WarningCircleIcon size={16} aria-hidden className="shrink-0" />
                      {consentError}
                    </p>
                  )}
                  {sendError && (
                    <p
                      id={sendErrorId}
                      role="alert"
                      className="flex items-start gap-1.5 pl-1 text-[0.8125rem] text-danger [transition:opacity_200ms_var(--ease-out)] starting:opacity-0"
                    >
                      <WarningCircleIcon size={16} aria-hidden className="mt-0.5 shrink-0" />
                      {sendError}
                    </p>
                  )}
                  {TURNSTILE_SITE_KEY && engaged && (
                    <Turnstile action="subscribe" resetKey={turnstileRound} onToken={handleToken} onBlocked={handleBlocked} className="mt-1" />
                  )}
                  <p className="sr-only" aria-live="polite">
                    {isSending ? 'Subscribing' : ''}
                  </p>
                </form>
              )}
              <noscript>
                <p className="nx-small">
                  Signing up here needs JavaScript. Email{' '}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="text-fg underline decoration-line-2 underline-offset-4">
                    {CONTACT_EMAIL}
                  </a>{' '}
                  and we will add you.
                </p>
              </noscript>
            </div>
          </div>

          {/* Link columns */}
          {navGroups.map((group) => (
            <nav key={group.label} aria-label={group.label} className="min-w-0 lg:col-span-2">
              {/* flex, not the eyebrow's inline-flex: all three column headings share one baseline. */}
              <p className="nx-eyebrow mb-4 flex">{group.label}</p>
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <li key={item.label}>
                    {/* min-h-11 keeps every link a 44px target while the list still reads tight. */}
                    <Link prefetch={false} href={item.href} className={`nx-link py-2.5 leading-6 [background-clip:content-box] [background-origin:content-box] text-[0.95rem] text-fg-2 ${TAP}`}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {/* Contact + social */}
          <div className="col-span-2 flex flex-col gap-4 lg:col-span-3">
            <p className="nx-eyebrow flex">Contact</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="nx-link py-2.5 leading-6 [background-clip:content-box] [background-origin:content-box] w-fit text-[0.95rem] text-fg">
              {CONTACT_EMAIL}
            </a>
            {socials.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {socials.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={s.label}
                    className={`grid size-11 place-items-center rounded-full border border-line text-fg-2 [transition:border-color_200ms_ease,color_200ms_ease,scale_var(--dur-press)_var(--ease-out)] hover:border-line-2 hover:text-fg active:scale-[0.97] motion-reduce:active:scale-100 ${TAP}`}
                  >
                    {s.icon}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-20 flex flex-col gap-4 border-t border-line py-7 text-xs text-fg-3 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} NixGen Solutions. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <nav aria-label="Legal">
              <ul className="flex items-center gap-5">
                {legal.map((item) => (
                  <li key={item.href}>
                    <Link prefetch={false} href={item.href} className={`nx-link py-3.5 leading-4 [background-clip:content-box] [background-origin:content-box] text-fg-2 ${TAP}`}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Oversized wordmark: a hairline outline that drifts slower than the page (scroll-linked,
          compositor-only, still under reduced motion). Decorative. */}
      <div className="pointer-events-none select-none overflow-hidden" aria-hidden>
        <Parallax amount={-0.12} className="nx-wrap">
          <p className="translate-y-[18%] text-center font-heading font-semibold leading-[0.8] tracking-[-0.06em] text-transparent [-webkit-text-stroke:1px_var(--line-2)] text-[clamp(5rem,21.5vw,20rem)]">
            NIXGEN
          </p>
        </Parallax>
      </div>
    </footer>
  );
}
