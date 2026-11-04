import type { ReactNode } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { classNames } from '../../lib/format'

/**
 * The rose border of a field that failed validation (the Login contract), for
 * an input that sets aria-invalid outside a <Field>: quick add, custom minutes.
 */
export const INVALID_INPUT =
  'aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20'

/**
 * One form field for the task / project / time-log forms: label above, the
 * control, then a hint and the inline error below it. The <label> wraps the
 * control, so the shared pickers (which take no id) are still named by it.
 * A hint or error sits outside the label so it never becomes part of the
 * control's accessible name. While it has an error the control's border turns
 * rose (the Login contract), including inside pickers that take no props for it.
 */
export function Field({
  label, hint, error, className, children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <div className={classNames('flex flex-col gap-2', className)}>
      <label
        className={classNames(
          'flex flex-col gap-2',
          error &&
            '[&_.input]:border-rose-500 [&_.input:focus]:border-rose-500 [&_.input:focus]:ring-rose-500/20',
        )}
      >
        <span className="text-xs font-medium text-ink-200">{label}</span>
        {children}
      </label>
      {hint}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

/**
 * The inline error under a field (or a one-line form such as quick add).
 * role="alert" so a screen reader hears it the moment validation refuses.
 * Icon + colour, so it reads as an error without relying on colour alone.
 */
export function FieldError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={classNames(
        'flex items-start gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-400',
        className,
      )}
    >
      <WarningCircleIcon size={14} className="mt-px shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  )
}
