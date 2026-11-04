'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Arrow, Button } from '@/components/site/Button';
import { Accent, Eyebrow } from '@/components/site/Typography';
import {
  DURATION,
  EASE,
  Magnetic,
  pressClass,
  Stagger,
  StaggerItem,
  usePrefersReducedMotion,
} from '@/components/site/motion';
import { readAttribution } from '@/lib/attribution';
import { ConsentCheck } from './ConsentCheck';
import { Turnstile, TURNSTILE_SITE_KEY } from './Turnstile';

/** Mono field index + label. Rendered as <label> for inputs, <p> for chip groups. */
function FieldLabel({
  index,
  htmlFor,
  id,
  hint,
  children,
}: {
  index: string;
  htmlFor?: string;
  id?: string;
  /** Quiet trailing note, e.g. "Optional". */
  hint?: string;
  children: ReactNode;
}) {
  const inner = (
    <>
      <span aria-hidden className="nx-mono w-5 text-[0.6875rem] font-normal tabular-nums text-fg-3">
        {index}
      </span>
      {children}
      {hint && <span className="nx-mono ml-auto text-[0.6875rem] font-normal tracking-[0.08em] text-fg-3 uppercase">{hint}</span>}
    </>
  );
  const cls = 'nx-label mb-3! flex items-baseline gap-2';
  return htmlFor ? (
    <label htmlFor={htmlFor} className={cls}>
      {inner}
    </label>
  ) : (
    <p id={id} className={cls}>
      {inner}
    </p>
  );
}

/**
 * nx-input at 16px (iOS zooms the page into anything smaller), with a red edge
 * and a soft danger ring while the field carries an inline error.
 */
const field =
  'nx-input text-base aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--danger)_16%,transparent)]';

/**
 * Inline error under a field. Enters with @starting-style (no JS): a 160ms
 * fade and a 4px settle on --ease-out; reduced motion keeps only the fade.
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

type FieldName = 'name' | 'email' | 'message' | 'consent';
const VALIDATED: readonly FieldName[] = ['name', 'email', 'message', 'consent'];

/** `required` is satisfied by spaces alone; a text field has to hold something. */
const isBlank = (el: HTMLInputElement | HTMLTextAreaElement) => el.required && el.type !== 'checkbox' && el.value.trim() === '';
const isValid = (el: HTMLInputElement | HTMLTextAreaElement) => el.validity.valid && !isBlank(el);

/** Plain, specific wording for each invalid field (shown under it). */
function errorFor(el: HTMLInputElement | HTMLTextAreaElement): string {
  if (isValid(el)) return '';
  if (el.name === 'email') return el.validity.valueMissing || isBlank(el) ? 'Enter your email address.' : 'That email address looks incomplete.';
  if (el.name === 'name') return 'Enter your name.';
  if (el.name === 'consent') return 'Tick the box to send your brief.';
  return 'Add a few lines about the project.';
}

/**
 * The submit island's glyph: the shared arrow (with its mouse-only hover
 * nudge) and a spinner share one cell and cross-fade in 150ms, a 2px blur
 * bridging the swap. The spinner turns every 700ms (a quick spin reads as a
 * quick send); reduced motion drops the scale, keeps it still and lets the
 * label carry the state.
 */
function SendGlyph({ loading }: { loading: boolean }) {
  const layer =
    'col-start-1 row-start-1 grid place-items-center [transition:opacity_150ms_ease,filter_150ms_ease,scale_150ms_var(--ease-out)] motion-reduce:scale-100';
  return (
    <span className="grid place-items-center">
      <span className={`${layer} ${loading ? 'scale-90 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-[0px]'}`}>
        <Arrow size={18} />
      </span>
      <span className={`${layer} ${loading ? 'scale-100 opacity-100 blur-[0px]' : 'scale-90 opacity-0 blur-[2px]'}`}>
        <CircleNotchIcon size={18} aria-hidden style={{ animationDuration: '700ms' }} className={loading ? 'motion-safe:animate-spin' : ''} />
      </span>
    </span>
  );
}

/**
 * Single-select pill group (System / Budget / Timeline) as a WAI-ARIA radio
 * group: one tab stop, arrow keys / Home / End move and select, Space selects.
 * All three are optional, so pressing the chosen chip again clears it.
 * nx-choice styles [aria-checked="true"].
 *
 * The check never reflows the row: every chip reserves its slot, the label
 * sits centred in it while unchecked and slides 9px right (200ms --ease-out)
 * as the check fades in from 0.9. Colours change with `ease` in 150ms; press
 * is the kit's 0.97. Reduced motion: the label snaps, the check only fades.
 * Arrow-key / Space selection lands instantly (Emil: keyboard-initiated
 * changes never animate): the group records how the last change arrived in
 * data-input, written straight to the DOM so it costs no render.
 */
const markInput = (e: { currentTarget: HTMLElement }, how: 'key' | 'pointer') => {
  const group = e.currentTarget.closest<HTMLElement>('[role="radiogroup"]');
  if (group) group.dataset.input = how;
};
const instantOnKey = 'in-data-[input=key]:transition-none';

function ChoiceGroup({
  label,
  labelId,
  index,
  options,
  value,
  onChange,
}: {
  label: string;
  labelId: string;
  index: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.indexOf(value);
  // Roving tabindex: the checked chip, or the first one while nothing is chosen.
  const tabStop = current === -1 ? 0 : current;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === ' ' || e.key === 'Enter') markInput(e, 'key');
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next === -1) return;
    e.preventDefault();
    markInput(e, 'key');
    onChange(options[next]);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <FieldLabel index={index} id={labelId}>
        {label}
      </FieldLabel>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const on = value === o;
          return (
            <button
              key={o}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(on ? '' : o)}
              onPointerDown={(e) => markInput(e, 'pointer')}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`nx-choice ${pressClass} h-11 px-3 [transition:color_150ms_ease,background-color_150ms_ease,border-color_150ms_ease,scale_var(--dur-press)_var(--ease-out)] ${instantOnKey}`}
            >
              <span className="relative inline-flex items-center pl-[1.125rem]">
                <CheckCircleIcon
                  size={14}
                  weight="fill"
                  aria-hidden
                  className={`absolute top-1/2 left-0 -translate-y-1/2 transition-[opacity,scale] duration-[160ms] ease-out motion-reduce:scale-100 ${instantOnKey} ${on ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}
                />
                <span
                  className={`whitespace-nowrap transition-[translate] duration-200 ease-out motion-reduce:transition-none ${instantOnKey} ${on ? 'translate-x-0' : '-translate-x-[0.5625rem]'}`}
                >
                  {o}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The confirmation's mark: a ring and a tick that draw themselves once, then a
 * single hairline echo leaves the badge. Rare (once per brief), so it spends
 * the delight budget; everything is transform/opacity except the two tiny SVG
 * strokes. Reduced motion: drawn already, no echo (the panel still fades in).
 */
function SuccessMark() {
  const reduced = usePrefersReducedMotion();
  const draw = (delay: number, duration: number) => (reduced ? { duration: 0 } : { delay, duration, ease: EASE.out });
  return (
    <span className="relative grid size-20 place-items-center rounded-full bg-accent-soft text-accent-text" aria-hidden>
      {!reduced && (
        <m.span
          className="absolute inset-0 rounded-full border border-accent"
          initial={{ opacity: 0.55, transform: 'scale(1)' }}
          animate={{ opacity: 0, transform: 'scale(1.45)' }}
          transition={{ delay: 0.75, duration: DURATION.revealLong, ease: EASE.out }}
        />
      )}
      <svg width="48" height="48" viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <g transform="rotate(-90 28 28)">
          <m.circle cx="28" cy="28" r="24" strokeWidth="1.5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw(0.2, 0.6)} />
        </g>
        <m.path d="M18 29.5 25 36.5 38.5 21" strokeWidth="2.5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw(0.55, 0.35)} />
      </svg>
    </span>
  );
}

/** How long the brief waits on the lead hand-off before emailing anyway. */
const LEAD_WAIT_MS = 10_000;

/** What /api/contact answers (see the response contract in its route file). */
type LeadStatus = 'recorded' | 'throttled' | 'invalid' | 'failed' | 'unconfirmed';
const LEAD_STATUSES: readonly LeadStatus[] = ['recorded', 'throttled', 'invalid', 'failed', 'unconfirmed'];

interface LeadReply {
  lead: LeadStatus;
  /** Email the brief through formsubmit.co so it is not lost. */
  fallback: boolean;
  /** Shown to the visitor when there is no fallback. */
  error?: string;
}

/** Line added to the fallback email, so a lead missing from DeskDev is never silent. */
const LEAD_NOTE: Record<LeadStatus, string> = {
  recorded: 'Recorded in DeskDev (Growth Hub)',
  throttled: 'NOT recorded in DeskDev (rate limit) - add this lead to the Growth Hub by hand',
  invalid: 'NOT recorded in DeskDev - add this lead to the Growth Hub by hand',
  failed: 'NOT recorded in DeskDev - add this lead to the Growth Hub by hand',
  unconfirmed: 'Not confirmed by DeskDev yet - check the Growth Hub before adding it by hand',
};

const SEND_FAILED = 'Something went wrong. Please try again or email nixgensolutions@gmail.com directly.';

/** POSTs the lead to /api/contact, capped at LEAD_WAIT_MS. Never throws. */
async function forwardLead(payload: string): Promise<LeadReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEAD_WAIT_MS);
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as { lead?: unknown; fallback?: unknown; error?: unknown } | null;
    const lead = LEAD_STATUSES.find((s) => s === body?.lead);
    // Not the route's own answer (a proxy error page, an older deploy): email the brief.
    if (!lead) return { lead: 'failed', fallback: true };
    return { lead, fallback: body?.fallback === true, error: typeof body?.error === 'string' ? body.error : undefined };
  } catch {
    // Timed out (the database may still record it) or offline.
    return { lead: controller.signal.aborted ? 'unconfirmed' : 'failed', fallback: true };
  } finally {
    clearTimeout(timer);
  }
}

/** The route's own caps (LIMITS in app/api/contact/route.ts): a field stops there instead of the brief being cut or refused after sending. */
const MAX = { name: 120, email: 254, company: 160, phone: 40, message: 5000 } as const;

/** A form token lives 4 hours (formToken.ts); a tab open longer than this fetches a new one. */
const TOKEN_REFRESH_MS = 3 * 60 * 60 * 1000;

/** The submit label. The arrow is drawn in the button's icon island, so only the words are typeset. */
const SEND_LABEL = 'Send Project Brief →';
const SEND_WORDS = SEND_LABEL.replace(/\s*→$/, '');

/**
 * The project-brief form. Records the enquiry as a DeskDev lead through the
 * same-origin /api/contact route. When that route says the lead may not have
 * landed (`fallback`), the brief is emailed through formsubmit.co instead,
 * with a line saying what happened, so it is never lost.
 *
 * Spam signals travel with the brief and never block it: a signed render
 * timestamp (fetched on mount), the Turnstile token when the widget is
 * configured, and the honeypot. The route quarantines on them; the visitor
 * sees the same confirmation either way.
 *
 * Validation is the browser's own (required / type=email), reported inline
 * under each field instead of in native bubbles: a field is checked when the
 * visitor leaves it with something typed, re-checked as they fix it, and all
 * of them on send (focus goes to the first one that needs attention).
 */
export function ContactForm({ systems, budgets, timelines,
}: {
  systems: string[];
  budgets: string[];
  /** `key` goes to /api/contact (the lead's stored timeline), `label` is what the visitor reads. */
  timelines: { key: string; label: string }[];
}) {
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // The in-flight guard. A ref, not the state above: two submit events in the
  // same tick both read the state before React has re-rendered.
  const sending = useRef(false);
  const [error, setError] = useState('');
  const [selectedSystem, setSelectedSystem] = useState('');
  const [selectedBudget, setSelectedBudget] = useState('');
  const [selectedTimeline, setSelectedTimeline] = useState('');
  const [consent, setConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  // Bumped after every send that reached the route: a Turnstile token verifies once.
  const [turnstileRound, setTurnstileRound] = useState(0);
  // The signed render timestamp from GET /api/contact (null until FORM_TOKEN_SECRET is set).
  const formToken = useRef<string | null>(null);
  const formTokenAt = useRef(0);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  // The answer already given for this exact brief: a retry after the fallback
  // email failed must not post the lead twice.
  const forwardedLead = useRef<{ brief: string; reply: LeadReply } | null>(null);

  const refreshFormToken = useCallback(async () => {
    try {
      const res = await fetch('/api/contact', { cache: 'no-store' });
      const body = (await res.json()) as { token?: unknown } | null;
      formToken.current = typeof body?.token === 'string' ? body.token : null;
      formTokenAt.current = Date.now();
    } catch {
      // Offline or blocked: the brief still sends, and the route treats it with more suspicion.
    }
  }, []);

  // Fetched on mount, not at send time: the route reads a token younger than
  // 3 s as a bot. Renewed while the tab stays open, before the 4 hour expiry.
  useEffect(() => {
    void refreshFormToken();
    const renewIfOld = () => {
      if (document.visibilityState === 'visible' && Date.now() - formTokenAt.current > TOKEN_REFRESH_MS) void refreshFormToken();
    };
    const timer = setInterval(renewIfOld, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', renewIfOld);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', renewIfOld);
    };
  }, [refreshFormToken]);
  // Keys the send-error alert: a repeat failure remounts it, so it is announced
  // again and replays its entrance instead of sitting there unchanged.
  const [failures, setFailures] = useState(0);
  // The form unmounts on success — hand focus (and the viewport) to the confirmation heading once it mounts.
  const focusOnMount = useCallback((el: HTMLHeadingElement | null) => el?.focus({ preventScroll: false }), []);

  const setFieldError = (name: FieldName, message: string) =>
    setFieldErrors((prev) => (prev[name] === (message || undefined) ? prev : { ...prev, [name]: message || undefined }));

  // Leaving a field: judge it only once the visitor has typed something (tabbing past isn't an error).
  const onFieldBlur = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const name = el.name as FieldName;
    if (el.value.trim() !== '' || fieldErrors[name]) setFieldError(name, errorFor(el));
  };
  // Fixing a flagged field: the message clears (or updates) as they type.
  const onFieldChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const name = el.name as FieldName;
    if (fieldErrors[name]) setFieldError(name, errorFor(el));
  };
  const describe = (name: FieldName, extra?: string) => [extra, fieldErrors[name] ? `${name}-error` : undefined].filter(Boolean).join(' ') || undefined;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sending.current) return; // the button stays focusable (aria-disabled) while sending

    // The browser's constraints, reported inline instead of in native bubbles.
    const fields = VALIDATED.map((n) => e.currentTarget.elements.namedItem(n)).filter(
      (el): el is HTMLInputElement | HTMLTextAreaElement => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement,
    );
    const invalid = fields.filter((el) => !isValid(el));
    if (invalid.length) {
      setFieldErrors(Object.fromEntries(fields.map((el) => [el.name, errorFor(el) || undefined])) as Partial<Record<FieldName, string>>);
      invalid[0].focus();
      return;
    }

    // A previous send error stays put (dimmed) while this attempt runs: clearing
    // it here would pull the button up under the pointer the moment it is pressed.
    sending.current = true;
    setIsLoading(true);
    const done = () => {
      sending.current = false;
      setIsLoading(false);
    };

    const form = e.currentTarget;
    const formData = new FormData(form);

    // The pickers are buttons, not inputs: add them for the fallback email.
    const system = selectedSystem || 'Not selected';
    const budget = selectedBudget || 'Not selected';
    const timeline = selectedTimeline || 'Not selected';
    formData.set('system', system);
    formData.set('budget', budget);
    formData.set('timeline', timeline);
    formData.set('consent', 'Agreed to the Privacy Policy');
    // Turnstile's own hidden input: no use to the mailbox.
    formData.delete('cf-turnstile-response');

    // A filled honeypot is a bot: look like success, send nothing.
    const honey = String(formData.get('_honey') ?? '').trim();
    if (honey) {
      setSubmitted(true);
      done();
      return;
    }

    const fail = (message: string) => {
      setFailures((n) => n + 1);
      setError(message);
      done();
    };

    // Record the enquiry as a lead in DeskDev's Growth Hub (same-origin route).
    const brief = {
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      company: formData.get('company'),
      services: selectedSystem ? [selectedSystem] : [],
      budget_band: budget,
      timeline: timelines.find((t) => t.label === selectedTimeline)?.key ?? '',
      message: formData.get('message'),
      consent,
    };
    const briefKey = JSON.stringify(brief);
    let reply: LeadReply;
    if (forwardedLead.current?.brief === briefKey) {
      reply = forwardedLead.current.reply;
    } else {
      reply = await forwardLead(
        JSON.stringify({
          ...brief,
          attribution: readAttribution(),
          formToken: formToken.current,
          turnstileToken: turnstileToken || undefined,
          _honey: honey,
        }),
      );
      // 'unconfirmed' may still land, so a retry of the same brief must not post it again.
      forwardedLead.current = reply.lead === 'recorded' || reply.lead === 'unconfirmed' ? { brief: briefKey, reply } : null;
      // Both proofs are spent: a retry needs a new widget token and a token that is not stale.
      setTurnstileToken('');
      setTurnstileRound((n) => n + 1);
      if (reply.lead !== 'recorded') void refreshFormToken();
    }

    if (reply.lead === 'recorded') {
      setSubmitted(true);
      done();
      return;
    }
    // Refused for a reason the visitor can act on (too many briefs from here, a bad address).
    if (!reply.fallback) {
      fail(reply.error || SEND_FAILED);
      return;
    }

    // The lead may not have landed: email the brief instead.
    // No leading underscore: formsubmit reserves those names.
    formData.set('lead_capture', LEAD_NOTE[reply.lead]);
    try {
      const res = await fetch('https://formsubmit.co/ajax/nixgensolutions@gmail.com', {
        method: 'POST',
        body: formData,
        // Same cap as the lead POST: a hung request must end in the inline
        // error, not a button stuck on its sending state.
        signal: AbortSignal.timeout(LEAD_WAIT_MS),
      });
      if (!res.ok) throw new Error('Failed to send');
      setSubmitted(true);
      done();
    } catch {
      fail(SEND_FAILED);
    }
  };

  return (
    // The form leaves with a 150ms fade (faster than anything enters); the
    // confirmation then builds itself in. Height is not animated: focus moves
    // to the confirmation heading, which brings it into view.
    <AnimatePresence mode="wait" initial={false}>
      {submitted ? (
        <m.div key="done" className="py-6 sm:py-10">
          <Stagger trigger="load" each={0.08} className="flex flex-col items-start gap-8">
            <StaggerItem variant="scale">
              <SuccessMark />
            </StaggerItem>

            <StaggerItem className="flex flex-col items-start gap-5">
              <p className="nx-beacon">
                <span className="size-2 shrink-0 rounded-full bg-[var(--nx-kit-live)]" aria-hidden />
                <span>Message sent successfully</span>
              </p>
              <h2
                ref={focusOnMount}
                tabIndex={-1}
                className="nx-h2 max-w-[16ch] text-[clamp(2.1rem,3.6vw,3.25rem)] text-balance outline-none"
              >
                Thank you! <Accent>We&apos;ll be in touch.</Accent>
              </h2>
              <p className="nx-body max-w-md text-[1.0625rem]">
                Your project brief has been sent to nixgensolutions@gmail.com. We&apos;ll respond within 12 hours with next
                steps and a proposed discovery call window.
              </p>
            </StaggerItem>

            <StaggerItem className="w-full border-t border-line pt-8">
              <Button href="/" variant="secondary" size="lg" className="w-full sm:w-auto">
                Back to Home
              </Button>
            </StaggerItem>
          </Stagger>
        </m.div>
      ) : (
        <m.form
          key="form"
          noValidate
          onSubmit={handleSubmit}
          className="flex flex-col gap-9"
          aria-labelledby="brief-title"
          exit={{ opacity: 0, transition: { duration: DURATION.exit, ease: EASE.out } }}
        >
          <input type="hidden" name="_subject" value="New Project Brief from NixGen Site" />
          <input type="hidden" name="_captcha" value="false" />
          <input type="hidden" name="_template" value="box" />
          {/* Bot trap: hidden from people and screen readers; formsubmit and /api/contact drop any brief that fills it. */}
          <input type="text" name="_honey" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ display: 'none' }} />

          <div className="border-b border-line pb-6">
            <Eyebrow as="h2" index="02" className="text-fg-2 max-lg:[&_.nx-eyebrow-index]:hidden max-lg:[&_.nx-eyebrow-line]:hidden">
              <span id="brief-title">Project Brief</span>
            </Eyebrow>
          </div>

          <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2">
            <div>
              <FieldLabel index="01" htmlFor="name">
                Name
              </FieldLabel>
              <input
                id="name"
                name="name"
                type="text"
                className={field}
                placeholder="Your name"
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                maxLength={MAX.name}
                required
                aria-invalid={fieldErrors.name ? true : undefined}
                aria-describedby={describe('name')}
                onBlur={onFieldBlur}
                onChange={onFieldChange}
              />
              <FieldError id="name-error" message={fieldErrors.name} />
            </div>
            <div>
              <FieldLabel index="02" htmlFor="email">
                Email
              </FieldLabel>
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                className={field}
                placeholder="you@company.com"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                maxLength={MAX.email}
                required
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={describe('email')}
                onBlur={onFieldBlur}
                onChange={onFieldChange}
              />
              <FieldError id="email-error" message={fieldErrors.email} />
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2">
            <div>
              <FieldLabel index="03" htmlFor="company" hint="Optional">
                Company
              </FieldLabel>
              <input
                id="company"
                name="company"
                type="text"
                className={field}
                placeholder="Company name"
                autoComplete="organization"
                enterKeyHint="next"
                maxLength={MAX.company}
              />
            </div>
            <div>
              <FieldLabel index="04" htmlFor="phone" hint="Optional">
                Phone
              </FieldLabel>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                className={field}
                placeholder="Phone number"
                autoComplete="tel"
                enterKeyHint="next"
                maxLength={MAX.phone}
              />
            </div>
          </div>

          <ChoiceGroup label="System" labelId="system-label" index="05" options={systems} value={selectedSystem} onChange={setSelectedSystem} />
          <ChoiceGroup label="Budget" labelId="budget-label" index="06" options={budgets} value={selectedBudget} onChange={setSelectedBudget} />
          <ChoiceGroup label="Timeline" labelId="timeline-label" index="07" options={timelines.map((t) => t.label)} value={selectedTimeline} onChange={setSelectedTimeline} />

          <div>
            <FieldLabel index="08" htmlFor="message">
              Project details
            </FieldLabel>
            <textarea
              id="message"
              name="message"
              rows={5}
              className={`${field} max-h-[26rem] resize-none [field-sizing:content]`}
              placeholder="What are you trying to build, launch, or fix? What does success look like?"
              maxLength={MAX.message}
              required
              aria-invalid={fieldErrors.message ? true : undefined}
              aria-describedby={describe('message', 'message-hint')}
              onBlur={onFieldBlur}
              onChange={onFieldChange}
            />
            <FieldError id="message-error" message={fieldErrors.message} />
            <p id="message-hint" className="nx-mono mt-3 text-[0.75rem] text-fg-3">
              → The more specific, the sharper the proposal
            </p>
          </div>

          <div>
            <ConsentCheck
              id="consent"
              name="consent"
              required
              checked={consent}
              invalid={Boolean(fieldErrors.consent)}
              describedBy={fieldErrors.consent ? 'consent-error' : undefined}
              onChange={(e) => {
                setConsent(e.currentTarget.checked);
                if (fieldErrors.consent) setFieldError('consent', errorFor(e.currentTarget));
              }}
            >
              I agree to the{' '}
              <Link
                href="/privacy"
                className="text-fg underline decoration-line-2 underline-offset-4 [transition:text-decoration-color_150ms_ease] hover:decoration-fg"
              >
                Privacy Policy
              </Link>
              .
            </ConsentCheck>
            <FieldError id="consent-error" message={fieldErrors.consent} />
          </div>

          {TURNSTILE_SITE_KEY && <Turnstile action="contact" resetKey={turnstileRound} onToken={setTurnstileToken} />}

          {error && (
            <div
              key={failures}
              className={`nx-alert flex items-start gap-2.5 transition-[opacity,translate] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0 ${isLoading ? 'opacity-55' : ''}`}
              role="alert"
            >
              <WarningCircleIcon size={18} aria-hidden className="mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="border-t border-line pt-8">
            {/* Primary CTA: magnetic for a mouse (kit: decorative spring, ±10px, never touch or reduced motion),
                closing in the shared icon island. Full width on phones, label left and island right. */}
            <Magnetic className="nx-js-only w-full sm:w-auto">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                icon={<SendGlyph loading={isLoading} />}
                aria-disabled={isLoading || undefined}
                aria-busy={isLoading}
                className="w-full justify-between sm:w-auto"
              >
                {isLoading ? 'Transmitting...' : SEND_WORDS}
              </Button>
            </Magnetic>
            {/* The label swap isn't announced on its own; mirror it for screen readers. */}
            <p className="sr-only" aria-live="polite">
              {isLoading ? 'Transmitting...' : ''}
            </p>
            {/* Without JavaScript the brief cannot be sent (a plain submit would only put the
                fields in the address bar), so the button is hidden (nx-js-only) and this line
                stands in, as in the footer sign-up. */}
            <noscript>
              <p className="nx-body">
                This form needs JavaScript. Email{' '}
                <a href="mailto:nixgensolutions@gmail.com" className="text-fg underline decoration-line-2 underline-offset-4">
                  nixgensolutions@gmail.com
                </a>{' '}
                and we will reply the same way.
              </p>
            </noscript>
          </div>
        </m.form>
      )}
    </AnimatePresence>
  );
}
