'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  VideoCameraIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Button, buttonClass } from '../Button';
import { Accent, Eyebrow } from '../Typography';
import { pressClass } from '../motion';
import {
  groupByLocalDay,
  longDateLabel,
  slotEnd,
  timeLabel,
  timeRangeLabel,
  visitorTimeZone,
  zoneLabel,
  type ApiDay,
} from './slotTimes';

// The visitor's side of /book. Open times come from /api/booking/slots (the
// google-calendar function: business hours minus Google and DeskDev busy
// time) and are shown in the visitor's own zone; "Confirm booking" posts to
// /api/booking, which re-checks the time and records the meeting on the lead
// in DeskDev with a Google invite and Meet link. Same idioms as the contact
// brief and the quick form: chips as WAI-ARIA radio groups, labels above,
// inline errors, 16px inputs, a success state that replaces the form.

export interface SlotsPayload {
  tz: string;
  minutes: number;
  title: string;
  days: ApiDay[];
  daysAhead: number | null;
  google: 'checked' | 'team_only' | 'not_connected';
}

interface Prefill {
  name?: string;
  email?: string;
}

interface BookedResult {
  start: string;
  end: string;
  title: string;
  meetUrl: string | null;
  invited: boolean;
  email: string;
}

type Load = 'loading' | 'ready' | 'disabled' | 'error';
type Field = 'name' | 'email' | 'company' | 'phone' | 'notes';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** nx-input at 16px (iOS zooms into anything smaller), with a red edge while the field carries an error. */
const FIELD =
  'nx-input text-base aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--danger)_16%,transparent)]';

const CHIP = `nx-choice ${pressClass} [transition:color_150ms_ease,background-color_150ms_ease,border-color_150ms_ease,scale_var(--dur-press)_var(--ease-out)]`;

const pressBtn =
  'touch-manipulation select-none [transition:background-color_200ms_ease,color_200ms_ease,box-shadow_200ms_ease,scale_var(--dur-press)_var(--ease-out)] active:[transform:none] active:scale-[0.97]';

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

function Label({ htmlFor, optional, children }: { htmlFor: string; optional?: boolean; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="nx-label mb-3! flex items-baseline gap-2">
      <span>{children}</span>
      {optional && <span className="nx-mono ml-auto text-[0.6875rem] font-normal tracking-[0.08em] text-fg-3 uppercase">Optional</span>}
    </label>
  );
}

/**
 * A WAI-ARIA radio group of chips: one tab stop, arrows / Home / End move and
 * select (the same pattern as the contact brief's pickers).
 */
function ChipRadios<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
  className = 'flex flex-wrap gap-2',
  chipClass = '',
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  render: (v: T, on: boolean) => ReactNode;
  className?: string;
  /** Extra classes per chip (size, alignment). */
  chipClass?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = value === null ? -1 : options.indexOf(value);
  const tabStop = current === -1 ? 0 : current;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next === -1) return;
    e.preventDefault();
    onChange(options[next]);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((o, i) => {
        const on = o === value;
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
            onClick={() => onChange(o)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`${CHIP} ${chipClass}`}
          >
            {render(o, on)}
          </button>
        );
      })}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading open times" className="flex flex-col gap-6">
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="h-16 w-20 shrink-0 rounded-2xl bg-surface-2 motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="h-10 rounded-full bg-surface-2 motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}

/** Disabled, empty or failed: say so, and offer the brief instead. */
function Fallback({ title, children, onRetry }: { title: ReactNode; children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-5 py-2" role="status">
      <h2 className="nx-h3 max-w-[24ch] text-balance">{title}</h2>
      <p className="nx-body max-w-md">{children}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {onRetry && (
          <Button size="lg" variant="secondary" onClick={onRetry} icon={<ArrowClockwiseIcon size={18} aria-hidden />}>
            Try again
          </Button>
        )}
        <Button href="/contact" size="lg" arrow>
          Send a project brief
        </Button>
      </div>
    </div>
  );
}

type Loaded = { load: 'ready'; data: SlotsPayload } | { load: 'disabled' | 'error' };

/** Ask /api/booking/slots. Pure fetch + parse: the caller decides what to do with the answer. */
async function requestSlots(): Promise<Loaded> {
  try {
    const res = await fetch('/api/booking/slots', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as ({ ok?: boolean; reason?: string } & Partial<SlotsPayload>) | null;
    if (res.ok && body?.ok === true && body.tz && body.minutes && Array.isArray(body.days)) {
      return {
        load: 'ready',
        data: {
          tz: body.tz,
          minutes: body.minutes,
          title: body.title ?? 'Discovery call',
          days: body.days,
          daysAhead: body.daysAhead ?? null,
          google: body.google ?? 'not_connected',
        },
      };
    }
    return { load: body?.reason === 'disabled' ? 'disabled' : 'error' };
  } catch {
    return { load: 'error' };
  }
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function BookingWidget({ prefill = {}, initial }: { prefill?: Prefill; initial?: SlotsPayload }) {
  const [load, setLoad] = useState<Load>(initial ? 'ready' : 'loading');
  const [data, setData] = useState<SlotsPayload | null>(initial ?? null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [values, setValues] = useState<Record<Field, string>>({
    name: prefill.name ?? '',
    email: prefill.email ?? '',
    company: '',
    phone: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field | 'slot', string>>>({});
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState('');
  const [booked, setBooked] = useState<BookedResult | null>(null);
  const honey = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const focusOnMount = useCallback((el: HTMLHeadingElement | null) => el?.focus({ preventScroll: false }), []);

  const tz = useMemo(() => visitorTimeZone(), []);

  const apply = useCallback((result: Loaded) => {
    if (result.load === 'ready') setData(result.data);
    setLoad(result.load);
  }, []);

  /** Reload open times (retry, or after a time was taken). */
  const fetchSlots = useCallback(async () => apply(await requestSlots()), [apply]);

  // First load. The state only changes in the answer's callback, and never
  // after the component is gone.
  useEffect(() => {
    if (initial) return;
    let live = true;
    requestSlots().then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [initial, apply]);

  const days = useMemo(() => (data ? groupByLocalDay(data.days, tz) : []), [data, tz]);
  const activeDay = days.find((d) => d.key === day) ?? days[0] ?? null;
  const studioZone = data ? zoneLabel(data.tz) : '';
  const visitorZone = zoneLabel(tz);

  const set = (key: Field, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const pickDay = (key: string) => {
    setDay(key);
    const next = days.find((d) => d.key === key);
    if (slot && !next?.slots.includes(slot)) setSlot(null);
  };

  const pickSlot = (iso: string) => {
    setSlot(iso);
    if (errors.slot) setErrors((prev) => ({ ...prev, slot: undefined }));
  };

  const validate = (): Partial<Record<Field | 'slot', string>> => {
    const found: Partial<Record<Field | 'slot', string>> = {};
    if (!slot) found.slot = 'Pick a time first.';
    if (!values.name.trim()) found.name = 'Enter your name.';
    if (!values.email.trim()) found.email = 'Enter your email address.';
    else if (!EMAIL.test(values.email.trim())) found.email = 'That email address looks incomplete.';
    return found;
  };

  const focusFirst = (keys: string[]) => {
    const order = ['slot', 'name', 'email'];
    const first = order.find((k) => keys.includes(k));
    if (!first) return;
    const el =
      first === 'slot'
        ? formRef.current?.ownerDocument.querySelector<HTMLElement>('[data-times] [tabindex="0"]')
        : formRef.current?.querySelector<HTMLElement>(`#book-${first}`);
    el?.focus();
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sending || !data) return; // aria-disabled keeps the button focusable while sending
    setAlert('');
    const found = validate();
    if (Object.keys(found).length) {
      setErrors(found);
      focusFirst(Object.keys(found));
      return;
    }

    setSending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: slot,
          name: values.name.trim(),
          email: values.email.trim(),
          company: values.company.trim() || undefined,
          phone: values.phone.trim() || undefined,
          notes: values.notes.trim() || undefined,
          customerTz: tz,
          _honey: honey.current?.value ?? '',
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        reason?: string;
        fields?: string[];
        start?: string;
        end?: string;
        title?: string;
        meetUrl?: string | null;
        invited?: boolean;
      } | null;

      if (res.ok && body?.ok) {
        const start = body.start ?? slot!;
        setBooked({
          start,
          end: body.end ?? slotEnd(start, data.minutes),
          title: body.title ?? data.title,
          meetUrl: body.meetUrl ?? null,
          invited: body.invited === true,
          email: values.email.trim(),
        });
        return;
      }
      if (res.status === 409) {
        // Someone took it between loading and confirming: fresh times, no
        // selection, and the visitor is taken back up to the times (on a
        // phone they are a screen above the button).
        setSlot(null);
        setAlert(body?.error ?? 'That time was just taken. Please pick another.');
        await fetchSlots();
        setErrors({ slot: 'That time was just taken. Pick another one.' });
        requestAnimationFrame(() => focusFirst(['slot']));
        return;
      }
      if (res.status === 403 && body?.reason === 'disabled') {
        setLoad('disabled');
        return;
      }
      if (res.status === 400 && body?.fields?.length) {
        const map: Partial<Record<Field | 'slot', string>> = {};
        for (const f of body.fields) {
          if (f === 'start') map.slot = 'Pick a time again.';
          else if (f === 'name') map.name = 'Enter your name.';
          else if (f === 'email') map.email = 'That email address looks incomplete.';
        }
        setErrors(map);
        focusFirst(Object.keys(map));
      }
      setAlert(body?.error ?? 'Something went wrong. Please try again.');
    } catch {
      setAlert('We could not reach the server. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  };

  // ── States ────────────────────────────────────────────────────────────────

  if (booked) {
    const first = firstNameOf(values.name);
    const minutes = Math.round((Date.parse(booked.end) - Date.parse(booked.start)) / 60_000);
    return (
      <div className="flex flex-col items-start gap-6 py-4" role="status">
        <span className="grid size-16 place-items-center rounded-full bg-accent-soft text-accent-text" aria-hidden>
          <CalendarCheckIcon size={32} weight="fill" />
        </span>
        <h2 ref={focusOnMount} tabIndex={-1} className="nx-h2 max-w-[18ch] text-[clamp(2rem,3.4vw,3rem)] text-balance outline-none">
          You&apos;re booked{first ? `, ${first}` : ''}. <Accent>Talk soon.</Accent>
        </h2>
        <dl className="w-full max-w-md border-t border-line">
          <div className="flex items-baseline justify-between gap-6 border-b border-line py-4">
            <dt className="nx-eyebrow">When</dt>
            <dd className="text-right font-heading text-[1.125rem] font-medium leading-snug text-fg">
              {longDateLabel(booked.start, tz)}
              <br />
              {timeRangeLabel(booked.start, booked.end, tz)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-6 border-b border-line py-4">
            <dt className="nx-eyebrow">What</dt>
            <dd className="text-right text-fg">
              {booked.title}
              {minutes > 0 ? ` · ${minutes} min` : ''}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-6 border-b border-line py-4">
            <dt className="nx-eyebrow">Your time zone</dt>
            <dd className="text-right text-fg-2">{visitorZone}</dd>
          </div>
        </dl>
        <p className="nx-body max-w-md text-[1.0625rem]">
          {booked.invited ? (
            <>
              A Google Calendar invite with the video call link is on its way to{' '}
              <strong className="font-semibold text-fg">{booked.email}</strong>.
            </>
          ) : (
            <>
              We&apos;ll email the call details to <strong className="font-semibold text-fg">{booked.email}</strong> shortly.
            </>
          )}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {booked.meetUrl && (
            <Button
              href={booked.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
              icon={<VideoCameraIcon size={18} aria-hidden />}
            >
              Google Meet link
            </Button>
          )}
          <Button href="/" variant="secondary" size="lg">
            Back to nixgensolutions.com
          </Button>
        </div>
      </div>
    );
  }

  if (load === 'loading') return <Skeleton />;
  if (load === 'disabled') {
    return (
      <Fallback title={<>Online booking isn&apos;t open <Accent>right now.</Accent></>}>
        Send us a short brief instead and we&apos;ll reply within 12 hours with a time that works.
      </Fallback>
    );
  }
  if (load === 'error' || !data) {
    return (
      <Fallback
        title={<>We can&apos;t load open times <Accent>right now.</Accent></>}
        onRetry={() => {
          setLoad('loading');
          void fetchSlots();
        }}
      >
        Please try again in a moment, or send a brief and we&apos;ll find a time with you.
      </Fallback>
    );
  }
  if (days.length === 0) {
    const span = data.daysAhead ? `in the next ${data.daysAhead} days` : 'coming up';
    return (
      <Fallback title={<>No open times <Accent>{span}.</Accent></>}>
        Our calendar is full for now. Send us a brief instead and we&apos;ll find a time that works for you.
      </Fallback>
    );
  }

  const selectedEnd = slot ? slotEnd(slot, data.minutes) : null;
  const zoneNote = visitorZone === studioZone ? `Times in ${visitorZone}` : `Times in ${visitorZone} · we're in ${studioZone}`;

  return (
    <div className="flex flex-col gap-12">
      {/* ── 01 Pick a time ─────────────────────────────────────────────── */}
      <section aria-labelledby="book-time-title" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-5">
          <Eyebrow as="h2" index="01" className="text-fg-2">
            <span id="book-time-title">Pick a time</span>
          </Eyebrow>
          <p className="nx-mono text-[0.75rem] text-fg-3">{zoneNote}</p>
        </div>

        <ChipRadios
          label="Day"
          options={days.map((d) => d.key)}
          value={activeDay?.key ?? null}
          onChange={pickDay}
          className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
          chipClass="h-auto! min-h-16 shrink-0 snap-start rounded-2xl! px-4! py-2"
          render={(key) => {
            const d = days.find((x) => x.key === key)!;
            return (
              <span className="flex flex-col items-center leading-tight">
                <span className="nx-mono text-[0.6875rem] uppercase tracking-[0.08em] opacity-80">{d.weekday}</span>
                <span className="font-medium">{d.date}</span>
              </span>
            );
          }}
        />

        {activeDay && (
          <div data-times>
            <ChipRadios
              label={`Times on ${activeDay.weekday} ${activeDay.date}`}
              options={activeDay.slots}
              value={slot && activeDay.slots.includes(slot) ? slot : null}
              onChange={pickSlot}
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
              chipClass="h-11! justify-center px-2!"
              render={(iso) => <span className="w-full text-center tabular-nums">{timeLabel(iso, tz)}</span>}
            />
            <FieldError id="book-slot-error" message={errors.slot} />
          </div>
        )}
      </section>

      {/* ── 02 Your details ─────────────────────────────────────────────── */}
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-9" aria-labelledby="book-details-title">
        {/* Bot trap: hidden from people and screen readers; /api/booking drops any booking that fills it. */}
        <input ref={honey} type="text" name="_honey" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ display: 'none' }} />

        <div className="border-b border-line pb-5">
          <Eyebrow as="h2" index="02" className="text-fg-2">
            <span id="book-details-title">Your details</span>
          </Eyebrow>
        </div>

        {/* The choice so far, in their own words and zone. */}
        <p className="nx-body flex items-start gap-2.5 text-fg" aria-live="polite">
          <CalendarCheckIcon size={20} aria-hidden className="mt-0.5 shrink-0 text-accent-text" />
          {slot && selectedEnd ? (
            <span>
              <strong className="font-semibold">{data.title}</strong> · {longDateLabel(slot, tz)}, {timeRangeLabel(slot, selectedEnd, tz)}{' '}
              <span className="text-fg-3">({data.minutes} min, your time)</span>
            </span>
          ) : (
            <span className="text-fg-2">Pick a day and a time above.</span>
          )}
        </p>

        <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2">
          {(
            [
              { key: 'name', label: 'Your name', type: 'text', auto: 'name' },
              { key: 'email', label: 'Email', type: 'email', auto: 'email' },
              { key: 'company', label: 'Company', type: 'text', auto: 'organization', optional: true },
              { key: 'phone', label: 'Phone', type: 'tel', auto: 'tel', optional: true },
            ] as const
          ).map((f) => {
            const id = `book-${f.key}`;
            const errorId = `${id}-error`;
            const error = errors[f.key];
            return (
              <div key={f.key}>
                <Label htmlFor={id} optional={'optional' in f}>
                  {f.label}
                </Label>
                <input
                  id={id}
                  name={f.key}
                  type={f.type}
                  autoComplete={f.auto}
                  inputMode={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : undefined}
                  autoCapitalize={f.type === 'email' ? 'none' : undefined}
                  spellCheck={f.type === 'email' ? false : undefined}
                  className={FIELD}
                  value={values[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  aria-required={'optional' in f ? undefined : true}
                />
                <FieldError id={errorId} message={error} />
              </div>
            );
          })}
          <div className="sm:col-span-2">
            <Label htmlFor="book-notes" optional>
              What would you like to cover?
            </Label>
            <textarea
              id="book-notes"
              name="notes"
              rows={3}
              maxLength={2000}
              className={`${FIELD} max-h-[20rem] resize-none [field-sizing:content]`}
              placeholder="Your business, the project, anything we should read first."
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </div>

        {alert && (
          <div
            className="nx-alert flex items-start gap-2.5 transition-[opacity,translate] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
            role="alert"
          >
            <WarningCircleIcon size={18} aria-hidden className="mt-px shrink-0" />
            <span>{alert}</span>
          </div>
        )}

        <div className="border-t border-line pt-8">
          <button
            type="submit"
            aria-disabled={sending || undefined}
            aria-busy={sending}
            className={buttonClass('primary', 'lg', `w-full justify-between gap-5 pr-2 pl-7 sm:w-auto ${pressBtn}`)}
          >
            <span>{sending ? 'Booking…' : 'Confirm booking'}</span>
            <span aria-hidden className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white/15">
              {sending ? (
                <CircleNotchIcon size={18} style={{ animationDuration: '700ms' }} className="motion-safe:animate-spin" />
              ) : (
                <ArrowRightIcon size={18} />
              )}
            </span>
          </button>
          <p className="sr-only" aria-live="polite">
            {sending ? 'Booking…' : ''}
          </p>
          <p className="nx-small mt-5 flex max-w-md items-start gap-2">
            <CheckCircleIcon size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {data.google === 'not_connected'
                ? 'We confirm by email right after you book.'
                : 'You get a Google Calendar invite with the video call link right after you book.'}
            </span>
          </p>
        </div>
      </form>
    </div>
  );
}
