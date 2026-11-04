import type { ReactNode } from 'react'
import { IndicatorGroup, LayoutIndicator } from '../motion'
import { radioKeys } from '../settings/formKit'
import { classNames } from '../../lib/format'

/**
 * A segmented choice on a recessed track: the raised plate glides to the
 * picked option (state indication; instant from the keyboard, still under
 * reduced motion — the kit's LayoutIndicator decides).
 *
 * `kind="radio"` is one value out of a few (a range, a filter): a radiogroup
 * with arrow keys. `kind="tab"` switches the view below it: a group of
 * pressed-state buttons (not ARIA tabs, which would promise arrow keys and a
 * tabpanel this control does not have).
 */
export default function Segmented<T extends string>({
  id, label, value, onChange, options, kind = 'radio', className,
}: {
  /** Unique per control on a page: it names the shared-layout group. */
  id: string
  /** Accessible name of the group. */
  label: string
  value: T
  onChange: (value: T) => void
  options: { key: T; label: string; count?: number; icon?: ReactNode }[]
  kind?: 'radio' | 'tab'
  className?: string
}) {
  const radio = kind === 'radio'
  return (
    <div
      role={radio ? 'radiogroup' : 'group'}
      aria-label={label}
      onKeyDown={radio ? radioKeys : undefined}
      className={classNames(
        'inline-flex max-w-full gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg [scrollbar-width:none] border border-ink-600 bg-ink-700/60 p-0.5 dark:bg-ink-850',
        className,
      )}
    >
      <IndicatorGroup id={id}>
        {options.map((o) => {
          const on = o.key === value
          return (
            <button
              key={o.key}
              type="button"
              role={radio ? 'radio' : undefined}
              aria-checked={radio ? on : undefined}
              aria-pressed={radio ? undefined : on}
              tabIndex={radio && !on ? -1 : 0}
              onClick={() => onChange(o.key)}
              className={classNames(
                'pressable relative inline-flex min-h-7 shrink-0 items-center justify-center max-sm:flex-auto gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium pointer-coarse:min-h-11',
                on ? 'text-ink-50' : 'text-ink-300 hover:text-ink-50',
              )}
            >
              {on && (
                <LayoutIndicator
                  layoutId={id}
                  radius={6}
                  className="absolute inset-0 bg-ink-800 shadow-[0_0_0_1px_rgb(var(--ink-600)),var(--shadow-1)] dark:bg-ink-700 dark:shadow-[0_0_0_1px_rgb(var(--ink-500)/0.6)]"
                />
              )}
              {o.icon && <span className="relative inline-flex shrink-0 max-sm:hidden" aria-hidden>{o.icon}</span>}
              <span className="relative">{o.label}</span>
              {o.count !== undefined && (
                <span className={classNames('relative text-[10px] tabular-nums', on ? 'text-ink-200' : 'text-ink-400')}>
                  {o.count.toLocaleString('en-US')}
                </span>
              )}
            </button>
          )
        })}
      </IndicatorGroup>
    </div>
  )
}
