import type { ReactNode } from 'react';

/**
 * Double-bezel surface: a hairline tray with a machined inner plate, the
 * plate's radius concentric with the tray's (2rem tray, 6px gap). The inner
 * top-edge highlight stands in for a drop shadow; the only shadow is the
 * page-tinted --shadow-sm. The plate fills its tray unless `innerClassName`
 * sets a height: two height utilities on one element would be settled by
 * stylesheet order, not by which was passed in.
 */
export function Bezel({
  children,
  className = '',
  innerClassName = 'h-full',
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div
      className={`rounded-[var(--nx-radius-xl)] bg-[color-mix(in_oklab,var(--fg)_3%,transparent)] p-1.5 ring-1 ring-line ${className}`}
    >
      <div
        className={`relative isolate overflow-hidden rounded-[calc(var(--nx-radius-xl)-0.375rem)] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.06),var(--shadow-sm)] light:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),var(--shadow-sm)] ${innerClassName}`}
      >
        {children}
      </div>
    </div>
  );
}
