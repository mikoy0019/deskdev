import { CheckIcon } from '@phosphor-icons/react'
import { Field, FieldError } from '../tasks/formBits'
import { classNames } from '../../lib/format'
import { fieldError, isAnswered, type Answers, type FormField, type FormTemplate } from '../../lib/forms'

// Renders any form template (lib/forms.ts): sections, then fields by type.
// Short fields pair up in two columns from `sm`; long text and multi-choice
// take the full row. The values are the caller's — nothing is saved here.

const WIDE = new Set<FormField['type']>(['textarea', 'multiselect'])

function Hint({ text }: { text?: string }) {
  return text ? <p className="text-[11px] leading-snug text-ink-400">{text}</p> : null
}

function Input({
  field, value, onChange, disabled, invalid,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
  invalid: boolean
}) {
  const common = {
    disabled,
    'aria-invalid': invalid || undefined,
    placeholder: field.placeholder,
  }
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          {...common}
          className="input w-full min-h-[84px] resize-y"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          min={0}
          className="input w-full tabular-nums"
          value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    case 'select':
      return (
        <select
          {...common}
          className="input w-full"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">—</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    default:
      return (
        <input
          {...common}
          type={field.type}
          inputMode={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : undefined}
          autoCapitalize={field.type === 'email' ? 'none' : undefined}
          spellCheck={field.type === 'email' ? false : undefined}
          className="input w-full"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/** Multi-choice as toggle chips in a fieldset (a <label> can't wrap several buttons). */
function Choices({
  field, value, onChange, disabled, error,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
  error: string | null
}) {
  const picked = Array.isArray(value) ? (value as string[]) : []
  const toggle = (v: string) => onChange(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v])
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-xs font-medium text-ink-200">
        {field.label}{field.required && ' *'}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {field.options?.map((o) => {
          const on = picked.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(o.value)}
              className={classNames(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium pointer-coarse:py-2',
                on ? 'border-brand-500 bg-brand-500/10 text-ink-50' : 'border-ink-600 text-ink-200 hover:text-ink-50',
              )}
            >
              {on && <CheckIcon size={11} weight="bold" aria-hidden />}
              {o.label}
            </button>
          )
        })}
      </div>
      <Hint text={field.hint} />
      {error && <FieldError>{error}</FieldError>}
    </fieldset>
  )
}

export default function FormFields({
  template, values, onChange, disabled, showMissing,
}: {
  template: FormTemplate
  values: Answers
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
  /** After a refused submit: flag required fields that are still empty. */
  showMissing?: boolean
}) {
  return (
    <div className="space-y-7">
      {template.sections.map((section) => (
        <section key={section.key} aria-labelledby={`form-${template.key}-${section.key}`} className="space-y-3">
          <div>
            <h3 id={`form-${template.key}-${section.key}`} className="section-title">{section.title}</h3>
            <Hint text={section.hint} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.fields.map((field) => {
              const value = values[field.key]
              const error =
                fieldError(field, value) ??
                (showMissing && field.required && !isAnswered(value) ? 'Required' : null)
              const set = (v: unknown) => onChange(field.key, v)
              return (
                <div key={field.key} className={WIDE.has(field.type) ? 'sm:col-span-2' : undefined}>
                  {field.type === 'multiselect' ? (
                    <Choices field={field} value={value} onChange={set} disabled={disabled} error={error} />
                  ) : (
                    <Field
                      label={
                        <>
                          {field.label}{field.required ? ' *' : ''}
                          {field.internal && <span className="ml-1.5 font-normal text-ink-400">· team only</span>}
                        </>
                      }
                      hint={<Hint text={field.hint} />}
                      error={error}
                    >
                      <Input field={field} value={value} onChange={set} disabled={disabled} invalid={Boolean(error)} />
                    </Field>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
