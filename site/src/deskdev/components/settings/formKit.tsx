import {
  Children, createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import { CheckIcon, CopyIcon, WarningCircleIcon, type Icon } from '@phosphor-icons/react'
import { classNames } from '../../lib/format'
import { AnimatePresence, m, POP_SCALE, TWEEN, useInputModality } from '../motion'

/**
 * Shared form + surface primitives for Settings, the Vault and the EOD
 * report: label above the control, hint and inline error below it, the
 * settings panel with its recessed action band, the switch, the icon tile
 * and the copy-confirmation glyph. One vocabulary, so every form in these
 * screens reads and behaves the same.
 */

/** Add to an `.input` so a field flagged aria-invalid turns rose (border + focus halo). */
export const INPUT_INVALID =
  'aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20'

/**
 * After a failed submit, move focus to the first flagged field. On a phone the
 * submit button sits below the fold of a long form, so without this the
 * inline error is rendered off-screen and the tap appears to do nothing.
 */
export function focusFirstInvalid() {
  requestAnimationFrame(() => {
    const scope = document.querySelector<HTMLElement>('[role="dialog"]') ?? document
    scope.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  })
}

/** The label voice used above every control in these screens. */
export const LABEL = 'block text-xs font-medium text-ink-200'

export interface ControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/**
 * Label above, control, hint, error below (gap-2). Pass a render function to
 * wire the control by id (inputs); pass a node for components that take no
 * id (ClientSelect, DateField) and the label wraps it instead.
 */
export function FormField({
  label, hint, error, children, className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ((control: ControlProps) => ReactNode) | ReactNode
  className?: string
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const after = (
    <>
      {hint && <p id={hintId} className="text-[11px] leading-relaxed text-ink-300">{hint}</p>}
      <FieldError id={errorId} error={error} />
    </>
  )
  if (typeof children === 'function') {
    return (
      <div className={classNames('flex min-w-0 flex-col gap-2', className)}>
        <label htmlFor={id} className={LABEL}>{label}</label>
        {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
        {after}
      </div>
    )
  }
  return (
    <div className={classNames('flex min-w-0 flex-col gap-2', className)}>
      <label className="flex flex-col gap-2">
        <span className={LABEL}>{label}</span>
        {children}
      </label>
      {after}
    </div>
  )
}

/** The inline error line under a field (or a form). Arrives with a 150ms fade. */
export function FieldError({ id, error, className }: { id?: string; error?: string | null; className?: string }) {
  if (!error) return null
  return (
    <p
      id={id}
      role="alert"
      className={classNames(
        'flex items-start gap-1.5 text-xs leading-relaxed text-rose-700 dark:text-rose-400 animate-fade [overflow-wrap:anywhere]',
        className,
      )}
    >
      <WarningCircleIcon size={14} className="mt-px shrink-0" aria-hidden />
      <span className="min-w-0">{error}</span>
    </p>
  )
}

const TILE_TONE = {
  brand: 'bg-brand-500/12 border-brand-500/25 text-brand-700 dark:text-brand-400',
  neutral: 'bg-ink-700/70 border-ink-600 text-ink-300',
  success: 'bg-emerald-500/12 border-emerald-500/25 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/12 border-amber-500/25 text-amber-700 dark:text-amber-400',
} as const

/** A 40px icon plate: the panel's mark. `brand` when the thing it names is on. */
export function IconTile({
  icon: Glyph, tone = 'neutral', size = 'md', className,
}: {
  icon: Icon
  tone?: keyof typeof TILE_TONE
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={classNames(
        'flex shrink-0 items-center justify-center rounded-lg border shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]',
        size === 'md' ? 'size-10' : 'size-8',
        TILE_TONE[tone],
        className,
      )}
    >
      <Glyph size={size === 'md' ? 18 : 16} />
    </span>
  )
}

/**
 * Unsaved drafts, reported upward. The screen that hosts the panels (Settings)
 * provides the callback and asks before it swaps a panel with edits away;
 * without a provider the report goes nowhere.
 */
const UnsavedContext = createContext<((key: string, dirty: boolean) => void) | null>(null)
export const UnsavedProvider = UnsavedContext.Provider

/** Tell the host screen this form holds edits that have not been saved. */
export function useUnsaved(dirty: boolean) {
  const report = useContext(UnsavedContext)
  const key = useId()
  useEffect(() => {
    if (!report) return
    report(key, dirty)
    return () => report(key, false)
  }, [report, key, dirty])
}

/**
 * A settings panel: header (optional icon tile, title, description, trailing
 * control), body, and an optional recessed footer band for the panel's
 * action — the save button on the right, its context on the left.
 */
export function Panel({
  title, description, icon, iconTone, aside, footer, children, className, bodyClassName, tone, dirty = false,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: Icon
  iconTone?: keyof typeof TILE_TONE
  aside?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  className?: string
  /** Replaces the body's vertical padding (default `pb-5 pt-4`). */
  bodyClassName?: string
  /** `danger` tints the hairline for destructive panels. */
  tone?: 'danger'
  /** The form holds edits its save button has not stored yet: says so beside the button. */
  dirty?: boolean
}) {
  const titleId = useId()
  useUnsaved(dirty)
  // Children.toArray drops false / null, so `{cond && …}` bodies collapse cleanly.
  const hasBody = Children.toArray(children).length > 0
  return (
    <section
      aria-labelledby={titleId}
      className={classNames('card overflow-hidden', tone === 'danger' && 'border-rose-500/30', className)}
    >
      <header className={classNames('flex items-start gap-4 px-5 pt-5', !hasBody && 'pb-5')}>
        {icon && <IconTile icon={icon} tone={iconTone} />}
        {/* With a 40px tile the text block is at least as tall, so a lone title centres on it. */}
        <div className={classNames('min-w-0 flex-1', icon && 'flex min-h-10 flex-col justify-center')}>
          <h3 id={titleId} className="text-sm font-semibold text-ink-50 text-pretty">{title}</h3>
          {description && <div className="mt-1 max-w-[65ch] text-xs leading-relaxed text-ink-300 text-pretty">{description}</div>}
        </div>
        {aside}
      </header>
      {hasBody && <div className={classNames('px-5', bodyClassName ?? 'pb-5 pt-4')}>{children}</div>}
      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-ink-600 bg-ink-900/50 px-5 py-3 max-sm:[&>.btn-primary]:w-full max-sm:[&>.btn-primary]:min-h-11">
          {dirty && (
            <p className="mr-auto flex items-center gap-2 text-xs text-ink-200">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
              Unsaved changes
            </p>
          )}
          {footer}
        </footer>
      )}
    </section>
  )
}

/**
 * On/off switch. The thumb travels on screen, so it takes the kit's move
 * rung (180ms strong ease-in-out; state indication). Reduced motion: the
 * global rule collapses it to a jump, the colour still crossfades.
 */
export function Switch({
  on, onChange, label, disabled,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={classNames(
        'pressable group/switch relative flex h-6 w-10 shrink-0 items-center justify-center rounded-full disabled:opacity-50',
        // A 24px switch is too small a target for a finger. Under one the
        // button is a real 44x44 box around the same 40x24 track; the negative
        // margins give the extra back, so the row's layout does not move.
        'pointer-coarse:size-11 pointer-coarse:-mx-0.5 pointer-coarse:-my-2.5',
        // The focus ring belongs on the track, not on the larger touch box.
        'focus-visible:ring-0 focus-visible:ring-offset-0',
      )}
    >
      <span
        aria-hidden
        className={classNames(
          'relative block h-6 w-10 shrink-0 rounded-full border transition-[background-color,border-color] duration-(--dur-press) ease-[ease]',
          'group-focus-visible/switch:ring-2 group-focus-visible/switch:ring-brand-500 group-focus-visible/switch:ring-offset-2 group-focus-visible/switch:ring-offset-ink-900',
          on ? 'border-brand-600 bg-brand-600' : 'border-ink-500 bg-ink-500/80',
        )}
      >
        <span
          className={classNames(
            'absolute left-0.5 top-0.5 size-[18px] rounded-full bg-white transition-[translate] duration-(--dur-popover) ease-in-out',
            on && 'translate-x-4',
          )}
          style={{ boxShadow: 'var(--shadow-1)' }}
        />
      </span>
    </button>
  )
}

/**
 * `value` while `live`, else the last value seen while live. A dialog whose
 * content comes from state that clears on close (the row being deleted, the
 * user being edited) keeps showing it through its exit instead of emptying
 * or flipping to another mode mid-fade.
 */
export function useHeldWhile<T>(value: T, live: boolean): T {
  const [held, setHeld] = useState(value)
  if (live && !Object.is(value, held)) setHeld(value)
  return live ? value : held
}

/**
 * `copied` flips true for 1.6s after `flash()`. Drives CopyGlyph so a copy
 * button confirms in place (the toast still says it too).
 */
export function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const flash = useCallback(() => {
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }, [])
  return [copied, flash]
}

/**
 * Copy ↔ check, cross-faded in place (state indication: the click landed).
 * 160ms, scale from POP_SCALE with a 2px blur bridging the two glyphs;
 * instant from the keyboard; MotionConfig drops the scale under reduced motion.
 */
export function CopyGlyph({ copied, size = 14 }: { copied: boolean; size?: number }) {
  const keyboard = useInputModality() === 'keyboard'
  const t = keyboard ? TWEEN.instant : TWEEN.press
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={copied ? 'done' : 'copy'}
          className="absolute inset-0 inline-flex"
          initial={{ opacity: 0, scale: POP_SCALE, filter: 'blur(2px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: POP_SCALE, filter: 'blur(2px)' }}
          transition={t}
        >
          {copied ? <CheckIcon size={size} /> : <CopyIcon size={size} />}
        </m.span>
      </AnimatePresence>
    </span>
  )
}

/** A full-width notice row inside or above a panel: warn / danger / success / info. */
export function Notice({
  tone, icon: Glyph, children, action, className, live,
}: {
  tone: 'warn' | 'danger' | 'success' | 'info'
  icon: Icon
  children: ReactNode
  action?: ReactNode
  className?: string
  /** Announce it (errors that arrive after an action). */
  live?: boolean
}) {
  const tones = {
    warn: 'border-amber-500/30 bg-amber-500/8 [&>svg]:text-amber-700 dark:[&>svg]:text-amber-400',
    danger: 'border-rose-500/30 bg-rose-500/8 [&>svg]:text-rose-700 dark:[&>svg]:text-rose-400',
    success: 'border-emerald-500/30 bg-emerald-500/8 [&>svg]:text-emerald-700 dark:[&>svg]:text-emerald-400',
    info: 'border-ink-600 bg-ink-700/40 [&>svg]:text-ink-300',
  }
  return (
    <div
      role={live ? 'alert' : undefined}
      className={classNames('flex items-start gap-3 rounded-lg border p-3', tones[tone], className)}
    >
      <Glyph size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-xs leading-relaxed text-ink-100 [overflow-wrap:anywhere]">{children}</div>
      {action}
    </div>
  )
}

/**
 * Arrow-key behaviour for a role="radiogroup" of buttons: arrows move to the
 * next / previous radio and select it (click), Home/End jump to the ends.
 * Spread on the group: <div role="radiogroup" onKeyDown={radioKeys}>.
 */
export function radioKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'))
  const i = radios.indexOf(document.activeElement as HTMLElement)
  if (i === -1 || radios.length === 0) return
  e.preventDefault()
  const n = radios.length
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1
    : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n
  radios[next].focus()
  radios[next].click()
}
