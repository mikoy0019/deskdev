'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Marks the block crossing the middle of the viewport with `data-focus`, so
 * CSS can show which row is being read (`group-data-[focus]:…`). The
 * attribute is written straight to the DOM by an IntersectionObserver: no
 * scroll listener and no React re-render as the page scrolls. The styling it
 * drives is colour only, so it stays the same under reduced motion.
 */
export function InFocus({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.setAttribute('data-focus', '');
        else el.removeAttribute('data-focus');
      },
      // A thin line just above the middle of the viewport: one row at a time.
      { rootMargin: '-49% 0px -50% 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.removeAttribute('data-focus');
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
