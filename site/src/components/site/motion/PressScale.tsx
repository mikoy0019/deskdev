import type { ReactNode } from 'react';

/**
 * Press feedback (Emil): scale 0.97 on :active, 140ms, --ease-out, applied on
 * pointer-down so it answers before the click. CSS only — no JS, works in
 * server components. Uses the independent `scale` property, so it composes
 * with any `transform` (a Magnetic pull, a hover nudge) instead of fighting it.
 * Also: touch-action: manipulation (no double-tap-zoom delay), no tap flash,
 * no long-press text selection on the control.
 *
 * - `pressClass`: put it on an element that has no `transition` of its own.
 * - <PressScale>: wraps any child (a Button whose transition is already set)
 *   in an inline-flex span that owns the press.
 */
export const pressClass = 'nx-press';

export function PressScale({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`nx-press inline-flex ${className}`.trim()}>{children}</span>;
}
