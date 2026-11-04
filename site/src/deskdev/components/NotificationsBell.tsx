import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { BellIcon } from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../store/useStore'
import { classNames, fmtRelative } from '../lib/format'
import { notificationHref } from '../lib/notifications'
import { useIsPhone } from '../pwa/useMediaQuery'
import { PopoverPanel, Presence, Skeleton, StatusDot } from './motion'

export default function NotificationsBell() {
  const user = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const notifications = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markRead)
  const markAllRead = useStore((s) => s.markAllRead)
  const crmRows = useStore((s) => s.crmRows)
  const crmColumns = useStore((s) => s.crmColumns)
  const events = useStore((s) => s.events)
  const navigate = useNavigate()
  const isPhone = useIsPhone()

  const [open, setOpen] = useState(false)
  // Fixed-position coordinates for the portaled popover, measured from the bell.
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const mine = useMemo(
    () =>
      notifications
        .filter((n) => n.userId === user?.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifications, user?.id],
  )
  const unread = mine.filter((n) => !n.read).length
  const latest = mine.slice(0, 8)

  // The popover renders in a portal on document.body (see below), so it escapes
  // the header's backdrop-blur-sm stacking context. That means we must anchor it
  // manually from the bell's rect, and recompute while it's open in case the
  // viewport scrolls or resizes.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      // Anchored under the bell, but never past the left edge of the screen.
      const width = Math.min(352, window.innerWidth - 32)
      const right = Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - width - 8))
      setPos({ top: r.bottom + 6, right })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  // The panel is portaled to the end of <body>, far from the bell in tab
  // order: move focus into it on open, or a keyboard user would have to tab
  // through the whole page to reach its rows.
  useEffect(() => {
    if (open) popRef.current?.focus({ preventScroll: true })
  }, [open])

  // Tab stays inside the panel while it is open (Escape hands focus back to
  // the bell); without this it walked off the end of the document.
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const panel = e.currentTarget
    const stops = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
    if (stops.length === 0) {
      e.preventDefault()
      return
    }
    const first = stops[0]
    const last = stops[stops.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Close on outside click. The popover is portaled outside the button's DOM
  // subtree, so check both refs — otherwise clicking inside it counts as
  // "outside" and dismisses it. Escape hands focus back to the bell.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // The panel is mounted only while open: then focus goes back to the bell.
      if (popRef.current) btnRef.current?.focus()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className={classNames(
          'pressable relative p-2 max-md:p-[14px] rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700',
          open && 'bg-ink-700 text-ink-50',
        )}
        title="Notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon size={16} weight={open ? 'fill' : 'regular'} aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand-600 text-white text-[9px] font-semibold tabular-nums flex items-center justify-center ring-2 ring-ink-850">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {typeof document !== 'undefined' && createPortal(
        // Grows from the bell's corner (origin-aware): 180ms in, 120ms out;
        // opened or closed from the keyboard it appears / vanishes instantly.
        <Presence>
          {open && (
            <PopoverPanel
              key="bell"
              ref={popRef}
              placement="bottom-end"
              role="dialog"
              aria-label="Notifications"
              // Takes focus as a container when it opens: no ring on it.
              tabIndex={-1}
              onKeyDown={trapTab}
              className={classNames(
                'fixed card z-80 overflow-hidden flex flex-col outline-hidden',
                isPhone ? 'max-h-[calc(var(--app-h)_-_5rem)]' : 'w-[min(22rem,calc(100vw-2rem))]',
              )}
              // Phones: a full-width panel inside the safe area instead of a 352px card.
              style={
                isPhone
                  ? { top: pos.top, left: 'max(0.5rem, var(--safe-left))', right: 'max(0.5rem, var(--safe-right))', boxShadow: 'var(--shadow-3)' }
                  : { top: pos.top, right: pos.right, boxShadow: 'var(--shadow-3)' }
              }
            >
              <div className="shrink-0 pl-4 pr-2 h-11 flex items-center justify-between border-b border-ink-600">
                <span className="section-title flex items-center gap-2">
                  Notifications
                  {unread > 0 && (
                    <span className="badge badge-brand text-[10px] px-1.5 py-0 leading-tight">{unread}</span>
                  )}
                </span>
                {unread > 0 && (
                  <button
                    type="button"
                    className="pressable px-2 py-1 pointer-coarse:py-2.5 rounded-md text-[11px] pointer-coarse:text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-brand-500/10 font-medium"
                    onClick={() => {
                      markAllRead()
                      // This button leaves with the unread count: keep focus in the panel.
                      popRef.current?.focus({ preventScroll: true })
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className={classNames('overflow-y-auto overscroll-contain', isPhone ? 'min-h-0' : 'max-h-[22rem]')}>
                {!hydrated && latest.length === 0 ? (
                  // Before the first pull an empty list is unknown, not "caught up".
                  <div role="status" aria-busy="true" className="p-1">
                    <span className="sr-only">Loading notifications</span>
                    {[68, 54, 74].map((w) => (
                      <div key={w} className="flex items-start gap-2.5 px-3 py-2.5">
                        <Skeleton w={8} h={8} rounded="full" className="mt-[5px]" />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <Skeleton w={`${w}%`} h={11} />
                          <Skeleton w={40} h={9} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : latest.length === 0 ? (
                  <div className="px-4 py-9 flex flex-col items-center gap-2.5 text-center">
                    <span className="size-10 rounded-xl border border-ink-600 bg-ink-800 dark:bg-ink-700/60 shadow-(--shadow-2) flex items-center justify-center text-ink-300">
                      <BellIcon size={18} aria-hidden />
                    </span>
                    <p className="text-sm text-ink-200">You&apos;re all caught up.</p>
                  </div>
                ) : (
                  <ul className="p-1">
                    {latest.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          className="pressable-card w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-md hover:bg-ink-700/60 focus-visible:ring-inset focus-visible:ring-offset-0"
                          onClick={() => {
                            if (!n.read) markRead(n.id)
                            setOpen(false)
                            navigate(notificationHref(n, { crmRows, crmColumns, events }))
                          }}
                        >
                          {/* Unread vs read: the dot's colour and the title's weight together. */}
                          <span className="mt-[5px] flex size-2 shrink-0 items-center justify-center" aria-hidden>
                            <StatusDot tone={n.read ? 'offline' : 'unread'} size={n.read ? 'xs' : 'sm'} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span
                              className={classNames(
                                'text-xs leading-snug line-clamp-2 [overflow-wrap:anywhere]',
                                n.read ? 'text-ink-200' : 'text-ink-50 font-medium',
                              )}
                            >
                              {n.title}
                            </span>
                            {n.body && (
                              <span className="block mt-0.5 text-[11px] text-ink-300 truncate">{n.body}</span>
                            )}
                            <span className="block text-[11px] tabular-nums text-ink-400 mt-1">
                              {fmtRelative(n.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Link
                to="/notifications"
                className="pressable shrink-0 block px-4 py-2.5 pointer-coarse:py-3.5 text-center text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-ink-700/60 border-t border-ink-600 focus-visible:ring-inset focus-visible:ring-offset-0"
                onClick={() => setOpen(false)}
              >
                View all
              </Link>
            </PopoverPanel>
          )}
        </Presence>,
        document.body,
      )}
    </div>
  )
}
