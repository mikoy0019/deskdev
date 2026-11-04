'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowRightIcon, CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Button, buttonClass } from '../Button';
import { Accent, Eyebrow } from '../Typography';
import { pressClass } from '../motion';
import {
  fieldError,
  formFields,
  missingRequired,
  type Answers,
  type FormField,
  type FormTemplate,
} from '../../../deskdev/lib/forms';

// The customer's side of a quick form (/f/<token>). It receives the
// template's customer view and the answers already on file for those fields
// only — the page filtered both on the server — and posts back to
// /api/forms/<token>, which filters and validates again. Same idioms as the
// contact brief: labels above, "Optional" on the optional ones, inline
// errors under the field, chip groups for choices, 16px inputs.

/** nx-input at 16px (iOS zooms into anything smaller), with a red edge while the field carries an error. */
const FIELD =
  'nx-input text-base aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--danger)_16%,transparent)]';

const CHIP = `nx-choice ${pressClass} h-11 px-3 [transition:color_150ms_ease,background-color_150ms_ease,border-color_150ms_ease,scale_var(--dur-press)_var(--ease-out)]`;

/** Fields that take the whole row. */
const WIDE = new Set<FormField['type']>(['textarea', 'select', 'multiselect']);

const pressBtn =
  'touch-manipulation select-none [transition:background-color_200ms_ease,color_200ms_ease,box-shadow_200ms_ease,scale_var(--dur-press)_var(--ease-out)] active:[transform:none] active:scale-[0.97]';

type Phase = 'idle' | 'sending' | 'done' | 'gone';

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

function Label({ field, htmlFor, id }: { field: FormField; htmlFor?: string; id?: string }) {
  const inner = (
    <>
      <span>{field.label}</span>
      {!field.required && (
        <span className="nx-mono ml-auto text-[0.6875rem] font-normal tracking-[0.08em] text-fg-3 uppercase">Optional</span>
      )}
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

function ChipCheck({ on }: { on: boolean }) {
  return (
    <CheckCircleIcon
      size={14}
      weight="fill"
      aria-hidden
      className={`absolute top-1/2 left-0 -translate-y-1/2 transition-[opacity,scale] duration-[160ms] ease-out ${on ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}
    />
  );
}

function ChipLabel({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-flex items-center pl-[1.125rem]">
      <ChipCheck on={on} />
      <span
        className={`whitespace-nowrap transition-[translate] duration-200 ease-out motion-reduce:transition-none ${on ? 'translate-x-0' : '-translate-x-[0.5625rem]'}`}
      >
        {children}
      </span>
    </span>
  );
}

/** One choice: a WAI-ARIA radio group (one tab stop, arrows move and select). */
function RadioChips({
  field, value, onChange, labelId, describedBy,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: string) => void;
  labelId: string;
  describedBy?: string;
}) {
  const options = field.options ?? [];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
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
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy} className="flex flex-wrap gap-2">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={CHIP}
          >
            <ChipLabel on={on}>{o.label}</ChipLabel>
          </button>
        );
      })}
    </div>
  );
}

/** Several choices: checkbox chips in a labelled group (nx-choice styles aria-checked). */
function ToggleChips({
  field, value, onChange, labelId, describedBy,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: string[]) => void;
  labelId: string;
  describedBy?: string;
}) {
  const picked = Array.isArray(value) ? (value as string[]) : [];
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="flex flex-wrap gap-2">
      {(field.options ?? []).map((o) => {
        const on = picked.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onChange(on ? picked.filter((x) => x !== o.value) : [...picked, o.value])}
            className={CHIP}
          >
            <ChipLabel on={on}>{o.label}</ChipLabel>
          </button>
        );
      })}
    </div>
  );
}

/** Number fields are typed as text in the inputs; validation and the server want numbers. */
function prepared(template: FormTemplate, values: Answers): Answers {
  const out: Answers = { ...values };
  for (const f of formFields(template)) {
    if (f.type !== 'number') continue;
    const v = out[f.key];
    if (typeof v === 'string') out[f.key] = v.trim() === '' ? undefined : Number(v);
  }
  return out;
}

function errorsFor(template: FormTemplate, values: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of missingRequired(template, values)) errors[f.key] = 'This one is needed.';
  for (const f of formFields(template)) {
    const e = fieldError(f, values[f.key]);
    if (e) errors[f.key] = e;
  }
  return errors;
}

export function QuickForm({
  token,
  template,
  initialAnswers,
  firstName,
}: {
  token: string;
  /** The customer view (internal fields already removed on the server). */
  template: FormTemplate;
  initialAnswers: Answers;
  firstName: string | null;
}) {
  const [values, setValues] = useState<Answers>(() => {
    const start: Answers = { ...initialAnswers };
    for (const f of formFields(template)) {
      if (f.type === 'number' && typeof start[f.key] === 'number') start[f.key] = String(start[f.key]);
    }
    return start;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [alert, setAlert] = useState('');
  const [doneText, setDoneText] = useState('');
  const honey = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const focusOnMount = (el: HTMLHeadingElement | null) => el?.focus({ preventScroll: false });

  const set = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const focusFirst = (keys: string[]) => {
    const first = formFields(template).find((f) => keys.includes(f.key));
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${first.key}"]`);
    el?.focus();
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (phase === 'sending') return; // aria-disabled keeps the button focusable while sending
    setAlert('');
    const answers = prepared(template, values);
    const found = errorsFor(template, answers);
    if (Object.keys(found).length) {
      setErrors(found);
      setAlert('A few answers need a second look.');
      focusFirst(Object.keys(found));
      return;
    }

    setPhase('sending');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, _honey: honey.current?.value ?? '' }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        missing?: string[];
        invalid?: string[];
      } | null;
      if (res.ok) {
        setPhase('done');
        return;
      }
      if (res.status === 409) {
        setDoneText('We already have your answers.');
        setPhase('done');
        return;
      }
      if (res.status === 404 || res.status === 410) {
        setAlert(body?.error ?? 'This form link is no longer valid.');
        setPhase('gone');
        return;
      }
      if (res.status === 400 && (body?.missing?.length || body?.invalid?.length)) {
        const keys = [...(body.missing ?? []), ...(body.invalid ?? [])];
        setErrors(Object.fromEntries(keys.map((k) => [k, body.missing?.includes(k) ? 'This one is needed.' : 'Check this answer.'])));
        focusFirst(keys);
      }
      setAlert(body?.error ?? 'Something went wrong. Please try again.');
      setPhase('idle');
    } catch {
      setAlert('We could not reach the server. Check your connection and try again.');
      setPhase('idle');
    } finally {
      clearTimeout(timer);
    }
  };

  if (phase === 'done') {
    return (
      <div className="flex flex-col items-start gap-6 py-4" role="status">
        <span className="grid size-16 place-items-center rounded-full bg-accent-soft text-accent-text" aria-hidden>
          <CheckCircleIcon size={34} weight="fill" />
        </span>
        <h2 ref={focusOnMount} tabIndex={-1} className="nx-h2 max-w-[18ch] text-[clamp(2rem,3.4vw,3rem)] text-balance outline-none">
          Thank you{firstName ? `, ${firstName}` : ''}! <Accent>We have your answers.</Accent>
        </h2>
        <p className="nx-body max-w-md text-[1.0625rem]">
          {doneText || 'We will go through them before our next conversation and come back to you within one business day.'}
        </p>
        <Button href="/" variant="secondary" size="lg" className={pressBtn}>
          Back to nixgensolutions.com
        </Button>
      </div>
    );
  }

  if (phase === 'gone') {
    return (
      <div className="flex flex-col items-start gap-5 py-2" role="alert">
        <p className="nx-body max-w-md text-[1.0625rem]">{alert}</p>
        <p className="nx-body max-w-md">
          Email{' '}
          <a href="mailto:nixgensolutions@gmail.com" className="nx-link text-fg">
            nixgensolutions@gmail.com
          </a>{' '}
          and we will send a fresh link.
        </p>
      </div>
    );
  }

  const sending = phase === 'sending';
  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-12" aria-label={template.title}>
      {/* Bot trap: hidden from people and screen readers; /api/forms drops any submission that fills it. */}
      <input ref={honey} type="text" name="_honey" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ display: 'none' }} />

      {template.sections.map((section, si) => (
        <fieldset key={section.key} className="flex min-w-0 flex-col gap-8">
          <legend className="mb-8 w-full border-b border-line pb-5">
            <Eyebrow as="span" index={String(si + 1).padStart(2, '0')} className="text-fg-2">
              {section.title}
            </Eyebrow>
          </legend>
          {section.hint && <p className="nx-small -mt-4">{section.hint}</p>}
          <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2">
            {section.fields.map((field) => {
              const id = `qf-${field.key}`;
              const labelId = `${id}-label`;
              const errorId = `${id}-error`;
              const hintId = field.hint ? `${id}-hint` : undefined;
              const error = errors[field.key];
              const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;
              const value = values[field.key];
              const common = {
                id,
                'data-field': field.key,
                'aria-invalid': error ? true : undefined,
                'aria-describedby': describedBy,
                'aria-required': field.required || undefined,
              };
              let control: ReactNode;
              if (field.type === 'select') {
                control = (
                  <RadioChips field={field} value={value} onChange={(v) => set(field.key, v)} labelId={labelId} describedBy={describedBy} />
                );
              } else if (field.type === 'multiselect') {
                control = (
                  <ToggleChips field={field} value={value} onChange={(v) => set(field.key, v)} labelId={labelId} describedBy={describedBy} />
                );
              } else if (field.type === 'textarea') {
                control = (
                  <textarea
                    {...common}
                    rows={4}
                    className={`${FIELD} max-h-[26rem] resize-none [field-sizing:content]`}
                    placeholder={field.placeholder}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => set(field.key, e.target.value)}
                  />
                );
              } else {
                control = (
                  <input
                    {...common}
                    type={field.type === 'number' ? 'text' : field.type}
                    inputMode={field.type === 'number' ? 'decimal' : field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : undefined}
                    autoComplete={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'off'}
                    autoCapitalize={field.type === 'email' ? 'none' : undefined}
                    spellCheck={field.type === 'email' ? false : undefined}
                    className={FIELD}
                    placeholder={field.placeholder}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => set(field.key, e.target.value)}
                  />
                );
              }
              const chips = field.type === 'select' || field.type === 'multiselect';
              return (
                <div key={field.key} className={WIDE.has(field.type) ? 'sm:col-span-2' : undefined}>
                  {chips ? <Label field={field} id={labelId} /> : <Label field={field} htmlFor={id} />}
                  {control}
                  {field.hint && (
                    <p id={hintId} className="nx-mono mt-3 text-[0.75rem] text-fg-3">
                      {field.hint}
                    </p>
                  )}
                  <FieldError id={errorId} message={error} />
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

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
          <span>{sending ? 'Sending…' : 'Send my answers'}</span>
          <span aria-hidden className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white/15">
            {sending ? (
              <CircleNotchIcon size={18} style={{ animationDuration: '700ms' }} className="motion-safe:animate-spin" />
            ) : (
              <ArrowRightIcon size={18} />
            )}
          </span>
        </button>
        <p className="sr-only" aria-live="polite">
          {sending ? 'Sending…' : ''}
        </p>
        <p className="nx-small mt-5 max-w-md">
          Only the NixGen team sees your answers. You can send this form once; to change something later, just email us.
        </p>
      </div>
    </form>
  );
}
