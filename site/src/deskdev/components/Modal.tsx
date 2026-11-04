import {
  useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from '@phosphor-icons/react'
import { classNames } from '../lib/format'
import { useMediaQuery } from '../pwa/useMediaQuery'
import { DialogPanel, OverlayRoot, Presence, Scrim, SheetHandle, SheetPanel } from './motion'

// Disabled controls can't take focus: counting one as the "last" element let
// Tab walk out of the dialog (Create channel, with its primary still disabled).
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), ' +
  'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** What Tab can actually reach inside the panel: enabled, rendered, not opted out. */
function tabbable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex !== -1 && el.getClientRects().length > 0,
  )
}

/** Surfaces that may hold focus above an open dialog and handle Tab themselves. */
const OTHER_LAYER = '[role="dialog"], [role="menu"], [role="listbox"], [data-sonner-toaster]'

/** Enter in a text field submits the dialog; these input types keep their own Enter. */
const NO_ENTER_SUBMIT = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image'])

/** Where a modal turns into a bottom sheet (Tailwind's `sm`). */
const SHEET_QUERY = '(max-width: 639.98px)'

// Open modals, innermost last. A ConfirmDialog over a TaskModal used to close
// both on one Escape, because each listened on document independently.
const stack: symbol[] = []

function lockBody(): void {
  if (stack.length === 1) document.body.style.overflow = 'hidden'
}

function unlockBody(): void {
  if (stack.length === 0) document.body.style.overflow = ''
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Right-aligned action row rendered below the scrollable body */
  footer?: ReactNode
  /** Wider panel for tables / two-column forms */
  wide?: boolean
  side?: boolean
  /**
   * The dialog's save. When set, body and footer sit in a <form>: Enter in a
   * text field calls it, and so does a footer button marked `type="submit"`
   * (give that button no onClick of its own, or it saves twice). Buttons
   * without a type stay plain buttons. Enter does nothing while the submit
   * button is disabled, and a field that handles Enter itself (and calls
   * preventDefault) keeps it.
   */
  onSubmit?: () => void
}

/**
 * Accessible generic modal — backdrop click + Escape close, focus trap
 * (focus moves into the panel, Tab wraps within it, and it returns to the
 * control that opened the dialog on close), scrollable body.
 *
 * Desktop: a centred dialog that scales from 0.96 + fades (240ms in, 150ms
 * out; modals stay centred — they have no trigger to grow from).
 * Below 640px: a bottom sheet that rises from the screen edge and leaves the
 * same way; drag its grabber/title bar down (or flick it) to dismiss. Its box
 * is the visible viewport (--app-h), so it rides above the iOS keyboard.
 * Opened or closed from the keyboard, it appears / vanishes instantly.
 *
 * Portaled to <body>: a transformed ancestor would otherwise become the
 * containing block of the fixed overlay and pin the sheet mid-page.
 */
export default function Modal({ open, onClose, title, children, footer, wide, side, onSubmit }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const sheet = useMediaQuery(SHEET_QUERY)

  // Callers pass a new onClose every render. Kept in a ref so the open effect
  // depends on `open` alone: re-running it on each host re-render (a typed
  // character, a clock tick, a realtime update) pulled focus out of the field
  // being typed in.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Where focus came from, taken while the dialog is still closed: by the time
  // an effect runs, a child's autoFocus has already moved focus inside, and
  // "returning" it there on close dropped it on <body>.
  const [wasOpen, setWasOpen] = useState(false)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open && typeof document !== 'undefined') setOpener(document.activeElement as HTMLElement | null)
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef(opener)
  useEffect(() => {
    openerRef.current = opener
  }, [opener])

  // True between this effect's setup and cleanup. A cleanup that is followed
  // at once by a new setup (StrictMode's double run in dev) is not a close.
  const liveRef = useRef(false)

  useEffect(() => {
    if (!open) return
    const me = Symbol('modal')
    stack.push(me)
    // A dialog opened over another dims lightly: two full scrims stacked
    // turned the page, and the dialog underneath, almost black. (The scrim
    // utility reads --overlay-alpha.)
    if (stack.length > 1) rootRef.current?.style.setProperty('--overlay-alpha', '0.3')
    lockBody()
    liveRef.current = true
    // An autofocused field already holds focus: leave it there.
    const opened = panelRef.current
    if (opened && !opened.contains(document.activeElement)) opened.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = tabbable(panel)
      const active = document.activeElement
      if (focusables.length === 0) {
        e.preventDefault()
        panel.focus({ preventScroll: true })
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!panel.contains(active)) {
        // Focus got out (a control that was removed, a click on the page).
        // A layer opened above this dialog (a menu, the palette, a toast)
        // runs its own keys.
        if (active instanceof Element && active.closest(OTHER_LAYER)) return
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(me)
      if (i !== -1) stack.splice(i, 1)
      unlockBody()
      liveRef.current = false
      // The panel as it is now (still mounted while it plays its exit), not
      // as it was at open: the sheet and the dialog swap nodes on a resize.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const closing = panelRef.current
      queueMicrotask(() => {
        if (liveRef.current) return
        const from = openerRef.current
        if (!from || !document.contains(from)) return
        // Hand focus back only if nothing else took it meanwhile (the next
        // dialog's field, say): it is still in the closing panel or on <body>.
        const active = document.activeElement
        if (active && active !== document.body && !closing?.contains(active)) return
        from.focus({ preventScroll: true })
      })
    }
  }, [open])

  if (typeof document === 'undefined') return null

  const header = (
    <div className="flex items-center justify-between gap-3 px-5 py-4 max-sm:pt-2.5">
      <h2 className="min-w-0 text-display text-lg font-semibold text-ink-50 [overflow-wrap:anywhere]">{title}</h2>
      <button
        type="button"
        className="pressable shrink-0 p-1.5 pointer-coarse:p-[14px] pointer-coarse:-m-[10px] rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700"
        onClick={onClose}
        aria-label="Close"
      >
        <XIcon size={16} aria-hidden />
      </button>
    </div>
  )

  const submitForm = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Only an explicit type="submit" button saves: a button without a type
    // inside a form would otherwise submit it on every click.
    const submitter = (e.nativeEvent as SubmitEvent).submitter
    if (submitter && submitter.getAttribute('type') !== 'submit') return
    onSubmit?.()
  }

  const submitOnEnter = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing) return
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    const field = e.target
    if (!(field instanceof HTMLInputElement) || NO_ENTER_SUBMIT.has(field.type)) return
    // Handled here, so the browser never "clicks" the form's first button.
    e.preventDefault()
    const primary = e.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (primary?.disabled) return
    onSubmit?.()
  }

  const bodyAndFooter = (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      {footer && (
        // Phones: actions wrap and share the width as full-size targets.
        // A recessed band (page tone under the card surface) seats the
        // actions apart from the form without another heavy rule. Not on the
        // sheet: its --safe-bottom padding sits below this row and would show
        // as a strip of card surface under the band.
        <div className="shrink-0 px-5 py-4 border-t border-ink-600 bg-ink-900/50 rounded-b-(--radius-lg) max-sm:rounded-b-none max-sm:bg-transparent flex flex-wrap items-center justify-end gap-2 max-sm:[&>*]:flex-1 max-sm:[&>button]:min-h-[44px]">
          {footer}
        </div>
      )}
    </>
  )

  const content = onSubmit ? (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={submitForm} onKeyDown={submitOnEnter}>
      {bodyAndFooter}
    </form>
  ) : (
    bodyAndFooter
  )

  const panelClass = classNames(
    // The panel takes focus as a container, not a control: no ring on it. The
    // offset goes too: the base :focus-visible rule's ring-offset-2 alone drew
    // a 2px page-coloured halo around a dialog that opened without a field.
    'relative card w-full flex flex-col outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0 shadow-(--shadow-3)',
    wide ? 'max-w-2xl' : 'max-w-md',
  )

  return createPortal(
    <Presence>
      {open && (
        <OverlayRoot
          key="modal"
          ref={rootRef}
          className={classNames(
            'fixed inset-0 z-50 flex',
            sheet ? 'items-end bottom-auto h-(--app-h)' : side ? 'items-stretch justify-end' : 'items-center justify-center p-4',
          )}
        >
          <Scrim onClick={onClose} />
          {sheet ? (
            <SheetPanel
              ref={panelRef}
              onDismiss={onClose}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={classNames(
                panelClass,
                // A sheet reads as a different object from a card: softer 16px
                // top corners, square where it meets the screen edge.
                'max-w-none max-h-[calc(var(--app-h)_-_var(--safe-top)_-_0.5rem)] rounded-t-2xl rounded-b-none border-x-0 border-b-0 pb-(--safe-bottom)',
              )}
            >
              <SheetHandle className="shrink-0 border-b border-ink-600 select-none">
                <span aria-hidden className="mx-auto mt-2 block h-1 w-9 rounded-full bg-ink-500" />
                {header}
              </SheetHandle>
              {content}
            </SheetPanel>
          ) : (
            <DialogPanel
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={classNames(panelClass, side ? 'h-full max-h-full rounded-none border-y-0 border-r-0' : 'max-h-[85dvh]')}
            >
              <div className="shrink-0 border-b border-ink-600">{header}</div>
              {content}
            </DialogPanel>
          )}
        </OverlayRoot>
      )}
    </Presence>,
    document.body,
  )
}
