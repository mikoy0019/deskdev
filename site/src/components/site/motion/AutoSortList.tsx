'use client';

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { LazyMotion, m } from 'framer-motion';
import { useLoopGate } from './hooks';
import { promoteStep } from './loops';
import { SPRING } from './presets';

const loadMax = () => import('./features-max').then((mod) => mod.default);

export type AutoSortItem = { id: string; content: ReactNode };

export type AutoSortListProps = {
  /** Items in their starting order (also the server / reduced-motion order). */
  items: readonly AutoSortItem[];
  /** ms between reorders. Default 2600. */
  interval?: number;
  /** Next order from the current one; default promotes one item to the top per tick. */
  reorder?: (ids: string[], tick: number) => string[];
  /** Accessible name for the list. */
  label?: string;
  /** Classes for the visible <ul> (lay it out as a stack/grid here). */
  className?: string;
  itemClassName?: string;
};

/**
 * Taste's "intelligent list": a stack that keeps re-prioritising itself, items
 * gliding to their new places (framer `layout`, which animates transforms;
 * the layout feature bundle loads only when this component mounts). For
 * marketing mockups — label the content as sample data. Runs only while on
 * screen with the tab visible; reduced motion keeps the starting order still.
 * Screen readers get the list once in its starting order (the reordering is
 * decorative, so the live list is aria-hidden).
 */
export const AutoSortList = memo(function AutoSortList({
  items,
  interval = 2600,
  reorder = promoteStep,
  label,
  className = '',
  itemClassName = '',
}: AutoSortListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const running = useLoopGate(ref);
  const [order, setOrder] = useState(() => items.map((i) => i.id));
  const tick = useRef(0);
  const ids = items.map((i) => i.id).join('|');

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setOrder((current) => reorder(current, tick.current++));
    }, interval);
    return () => window.clearInterval(timer);
  }, [running, interval, reorder]);

  const byId = new Map(items.map((i) => [i.id, i]));
  // Items changed under us: fall back to the given order.
  const shown = order.length === items.length && order.every((id) => byId.has(id)) ? order : ids.split('|');

  return (
    <div ref={ref}>
      {label ? (
        <ul className="sr-only" aria-label={label}>
          {items.map((i) => (
            <li key={i.id}>{i.content}</li>
          ))}
        </ul>
      ) : null}
      <LazyMotion features={loadMax}>
        <ul aria-hidden inert className={className}>
          {shown.map((id) => (
            <m.li key={id} layout="position" transition={SPRING.ui} className={itemClassName}>
              {byId.get(id)?.content}
            </m.li>
          ))}
        </ul>
      </LazyMotion>
    </div>
  );
});
