import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { CaretRightIcon, type Icon } from '@phosphor-icons/react'
import { classNames } from '../../lib/format'
import { LayoutIndicator } from '../motion'

// ─── Why this lives in components/ui ─────────────────────────────────────────
// This app is Tailwind + TS but NOT shadcn — there is no components.json and no
// CSS-var `bg-card`/`border-border` layer. So the upstream component's shadcn
// classes are re-pointed onto our own semantic ink/brand ramp (FOUNDATION-THEME.md):
//
//   bg-card / bg-background  →  bg-ink-850 / bg-ink-800
//   border-border            →  border-ink-600
//   text-muted-foreground    →  text-ink-300
//   text-foreground          →  text-ink-50
//   bg-primary / text-primary→  bg-brand-600 / text-brand-600 dark:text-brand-400
//
// components/ui/ is the presentational layer: dumb, route-agnostic, no store
// access. Feature components (Sidebar.tsx) own the data and permissions.

export type NavItemData = {
  /** Route path. Omit for a pure group header that only expands children. */
  to?: string
  label: string
  icon: Icon
  /** Exact-match active state — needed for "/" so it isn't always active. */
  end?: boolean
  badge?: number | string
  /** Rendered on hover, e.g. "⌘K". Display-only; bind the key elsewhere. */
  shortcut?: string
  children?: NavItemData[]
  /** Extra classes on the row's wrapper, e.g. 'standalone:hidden'. */
  className?: string
}

export type NavGroupData = {
  heading?: string
  items: NavItemData[]
}

/** Big counts stay a fixed-width pill: a nav badge says "lots", not the figure. */
function badgeText(badge: number | string): string {
  return typeof badge === 'number' && badge > 99 ? '99+' : String(badge)
}

function Row({
  item,
  level,
  onNavigate,
  indicator,
}: {
  item: NavItemData
  level: number
  onNavigate?: () => void
  indicator?: string
}) {
  const [open, setOpen] = useState(false)
  const Icon = item.icon
  const hasChildren = !!item.children?.length

  const rowClass = (isActive: boolean) =>
    classNames(
      // Finger-sized on touch screens (the phone drawer); unchanged for a mouse.
      'pressable group relative flex items-center justify-between gap-3 px-3 py-2 pointer-coarse:min-h-[44px] rounded-md',
      'text-sm font-medium w-full text-left',
      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-850',
      isActive ? 'text-ink-50' : 'text-ink-200 hover:text-ink-50 hover:bg-ink-700/60',
    )

  const inner = (isActive: boolean) => (
    <>
      {/* The open page: a raised row with the nav's one brand accent, a rail on
          its left edge. It glides to the next row on a click (layoutId,
          critically damped, no overshoot); instant from the keyboard and
          under reduced motion. Without an indicator id it simply appears. */}
      {isActive &&
        (indicator ? (
          <>
            <LayoutIndicator
              layoutId={indicator}
              radius={6}
              className="absolute inset-0 bg-ink-800 shadow-[0_0_0_1px_rgb(var(--ink-600)),var(--shadow-1)] dark:bg-ink-700/70 dark:shadow-[0_0_0_1px_rgb(var(--ink-600)/0.7)]"
            />
            <LayoutIndicator
              layoutId={`${indicator}-rail`}
              radius={2}
              className="absolute left-0 top-1/2 -mt-2.5 h-5 w-0.5 bg-brand-600 dark:bg-brand-400"
            />
          </>
        ) : (
          <span aria-hidden className="absolute left-0 top-1/2 -mt-2.5 h-5 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
        ))}
      <span className="relative flex items-center gap-3 min-w-0">
        <Icon
          size={16}
          weight={isActive ? 'fill' : 'regular'}
          className={classNames(
            'shrink-0',
            isActive ? 'text-brand-600 dark:text-brand-400' : 'text-ink-400 group-hover:text-ink-200',
          )} aria-hidden
        />
        <span className="truncate">{item.label}</span>
      </span>

      <span className="relative flex items-center gap-2 shrink-0">
        {item.shortcut && (
          <kbd className="hidden group-hover:inline-flex items-center h-5 px-1.5 rounded-sm border border-ink-600 bg-ink-800 font-mono text-[10px] font-medium text-ink-300">
            {item.shortcut}
          </kbd>
        )}
        {item.badge != null && item.badge !== 0 && (
          <span
            className={classNames(
              'min-w-5 text-center text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded-full border',
              isActive
                ? 'bg-brand-500/15 border-brand-500/30 text-brand-700 dark:text-brand-400'
                : 'bg-ink-700 border-ink-600 text-ink-200 group-hover:border-ink-500',
            )}
          >
            {badgeText(item.badge)}
          </span>
        )}
        {hasChildren && (
          <CaretRightIcon
            size={14}
            aria-hidden
            className={classNames(
              'text-ink-400 transition-transform duration-150 ease-out',
              open && 'rotate-90',
            )}
          />
        )}
      </span>
    </>
  )

  return (
    <div className={classNames('flex flex-col', item.className)}>
      {hasChildren ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={rowClass(false)}
          style={{ paddingLeft: `${level * 12 + 12}px` }}
        >
          {inner(false)}
        </button>
      ) : (
        <NavLink
          to={item.to!}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) => rowClass(isActive)}
          style={{ paddingLeft: `${level * 12 + 12}px` }}
        >
          {({ isActive }) => inner(isActive)}
        </NavLink>
      )}

      {hasChildren && (
        // The rows open at once (no height animation — layout, not transform)
        // and fade in on the dropdown band.
        <div
          className={classNames(
            'grid transition-opacity duration-150 ease-out',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden min-h-0 relative flex flex-col gap-0.5 mt-0.5">
            <span
              aria-hidden
              className="absolute top-0 bottom-0 border-l border-ink-600"
              style={{ left: `${level * 12 + 19}px` }}
            />
            {item.children!.map((child) => (
              <Row key={child.label} item={child} level={level + 1} onNavigate={onNavigate} indicator={indicator} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Presentational sidebar navigation: grouped, optionally nested rows with
 * badges and shortcut hints. Routing comes from react-router NavLink, so active
 * state follows the URL rather than local state.
 */
export function SidebarNav({
  groups,
  onNavigate,
  className,
  indicator,
  label,
}: {
  groups: NavGroupData[]
  /** Accessible name — required once a screen has more than one nav. */
  label?: string
  onNavigate?: () => void
  className?: string
  /**
   * layoutId for the active-row marker. Navs that share one (the Sidebar's
   * groups, its pinned block) pass the marker between them; wrap each copy
   * of a nav on screen in its own IndicatorGroup.
   */
  indicator?: string
}) {
  return (
    <nav aria-label={label} className={classNames('flex flex-col gap-6', className)}>
      {groups.map((group, i) => (
        <div key={group.heading ?? i}>
          {group.heading && (
            <div className="section-title px-3 mb-1.5 text-ink-300">{group.heading}</div>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <Row key={item.label} item={item} level={0} onNavigate={onNavigate} indicator={indicator} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}
