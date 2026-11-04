'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, LazyMotion, m } from 'framer-motion';
import {
  AddressBookIcon,
  CalendarCheckIcon,
  ChatCircleTextIcon,
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
} from '@phosphor-icons/react';
import { DURATION, EASE, SPRING, useLoopGate } from '@/components/site/motion';

// Layout animations need the larger feature bundle; it loads only when the feed mounts.
const loadMax = () => import('@/components/site/motion/features-max').then((mod) => mod.default);

/* Sample activity for the "Works While You Sleep" mockup (labelled as sample
   data where it renders). One lead's path through the automations. */
const EVENTS: { icon: ReactNode; title: string; meta: string }[] = [
  { icon: <EnvelopeSimpleIcon size={16} weight="regular" />, title: 'Quote request captured', meta: 'Website form' },
  { icon: <AddressBookIcon size={16} weight="regular" />, title: 'Lead added to the CRM', meta: 'New inquiries' },
  { icon: <PaperPlaneTiltIcon size={16} weight="regular" />, title: 'Follow-up email sent', meta: 'Automation' },
  { icon: <ChatCircleTextIcon size={16} weight="regular" />, title: 'Missed call texted back', meta: 'SMS' },
  { icon: <CalendarCheckIcon size={16} weight="regular" />, title: 'Discovery call booked', meta: 'Calendar' },
];

type Row = { key: number; event: number };

/* Newest first: the lead's latest step sits on top (also the server and
   reduced-motion order). */
const START: Row[] = EVENTS.map((_, i) => ({ key: i, event: i })).reverse();

const INTERVAL = 2800;

/**
 * A feed of automations firing after hours. Each tick a new event really
 * arrives: it fades and settles in at the top from just above, the rows below
 * shift down one place (layout="position", Emil's UI spring) and the oldest
 * row fades out at the bottom. Nothing travels through the list. Runs only on
 * screen with the tab visible; reduced motion keeps the starting list still.
 * Decorative: the plate's title and body carry the claim.
 */
export function AfterHoursFeed({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const running = useLoopGate(ref);
  const [rows, setRows] = useState(START);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRows((current) => [
        { key: current[0].key + 1, event: (current[0].event + 1) % EVENTS.length },
        ...current.slice(0, -1),
      ]);
    }, INTERVAL);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div ref={ref} className={className}>
      <LazyMotion features={loadMax}>
        <ul aria-hidden inert className="relative grid gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((row) => {
              const e = EVENTS[row.event];
              return (
                <m.li
                  key={row.key}
                  layout="position"
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: DURATION.exit, ease: EASE.out } }}
                  transition={SPRING.ui}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 [transition:border-color_200ms_ease] first:border-[color-mix(in_oklab,var(--accent)_40%,var(--line))]"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-bg-2 text-fg-2">{e.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-fg">{e.title}</span>
                  <span className="nx-mono hidden shrink-0 text-[0.6875rem] uppercase tracking-[0.12em] text-fg-3 sm:block">{e.meta}</span>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </LazyMotion>
    </div>
  );
}
