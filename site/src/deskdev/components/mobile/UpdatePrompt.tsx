import { useRef, useState, type FocusEvent } from 'react'
import { ArrowsClockwiseIcon, XIcon } from '@phosphor-icons/react'
import { useServiceWorkerUpdate } from '../../pwa/serviceWorker'
import { NoticePanel, Presence } from '../motion'

/**
 * "A new version is ready" — shown once a deployed build has installed behind
 * the running app. Reload hands over to the waiting worker and reloads when it
 * takes control; dismissing keeps this version until the next launch.
 *
 * A fixed bar at z-45 (above popovers, below sheets and the palette) that
 * never takes focus, so a half-typed message stays put. On phones it floats
 * above the tab bar and clear of the home indicator; from md up it sits
 * bottom-centre, away from the toasts in the bottom-right corner. It rises
 * from the bottom edge and leaves the way it came (NoticePanel: 240ms in,
 * 150ms out; a fade under reduced motion; instant when dismissed by keyboard).
 */
export default function UpdatePrompt() {
  const { updateReady, applyUpdate } = useServiceWorkerUpdate()
  const [dismissed, setDismissed] = useState(false)
  const [reloading, setReloading] = useState(false)
  const open = updateReady && !dismissed
  const noticeRef = useRef<HTMLDivElement>(null)
  // Where focus was before someone tabbed into the notice, so dismissing it
  // (which unmounts the focused button) can hand focus back instead of
  // dropping it on <body>.
  const returnTo = useRef<HTMLElement | null>(null)

  const onFocusIn = (e: FocusEvent<HTMLDivElement>) => {
    const from = e.relatedTarget
    if (from instanceof HTMLElement && !e.currentTarget.contains(from)) returnTo.current = from
  }

  const dismiss = () => {
    const hadFocus = Boolean(noticeRef.current?.contains(document.activeElement))
    setDismissed(true)
    if (!hadFocus) return
    const back = returnTo.current
    if (back && back.isConnected) {
      back.focus({ preventScroll: true })
      return
    }
    const main = document.getElementById('dd-main')
    if (!main) return
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
    main.focus({ preventScroll: true })
  }

  return (
    // The live region stays mounted: one inserted together with its text is
    // often not announced at all.
    <div
      role="status"
      aria-live="polite"
      className={
        'pointer-events-none fixed inset-x-0 z-45 flex justify-center ' +
        'pl-[max(0.75rem,var(--safe-left,0px))] pr-[max(0.75rem,var(--safe-right,0px))] ' +
        'bottom-[calc(var(--tabbar-h,56px)_+_var(--safe-bottom,0px)_+_0.75rem)] md:bottom-6'
      }
    >
      <Presence>
        {open && (
          <NoticePanel
            key="update"
            ref={noticeRef}
            onFocus={onFocusIn}
            edge="bottom"
            distance="calc(100% + 1.5rem)"
            className="pointer-events-auto card shadow-(--shadow-3) flex w-full sm:w-auto sm:max-w-md items-center gap-3 py-2 pl-4 pr-2"
          >
            <ArrowsClockwiseIcon size={16} aria-hidden className="shrink-0 text-brand-600 dark:text-brand-400" />
            <p className="flex-1 min-w-0 text-sm font-medium text-ink-50">A new version of DeskDev is ready</p>
            <button
              type="button"
              className="btn-primary shrink-0 h-9 pointer-coarse:h-11"
              disabled={reloading}
              onClick={() => {
                setReloading(true)
                applyUpdate()
              }}
            >
              {reloading ? 'Reloading…' : 'Reload'}
            </button>
            <button
              type="button"
              className={
                'pressable shrink-0 inline-flex items-center justify-center h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 ' +
                'rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700'
              }
              aria-label="Dismiss update notice"
              onClick={dismiss}
            >
              <XIcon size={16} aria-hidden />
            </button>
          </NoticePanel>
        )}
      </Presence>
    </div>
  )
}
