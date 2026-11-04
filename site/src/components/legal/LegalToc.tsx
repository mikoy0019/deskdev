'use client';

import { useEffect, useState } from 'react';

export interface TocItem {
  id: string;
  index: string;
  title: string;
}

/**
 * Desktop "On this page" rail with scroll-spy. Server HTML is a plain list of
 * anchors (works without JavaScript); the observer only adds aria-current to
 * the section being read.
 *
 * No motion beyond a 200ms colour/opacity change on the marker: this page is
 * read, not watched, and the rail changes often while scrolling (Emil: high
 * frequency, so keep it quiet).
 */
export function LegalToc({ items, label = 'On this page' }: { items: TocItem[]; label?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const ids = items.map((item) => item.id).join(' ');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const order = ids.split(' ');
    const sections = order.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const visible = new Set<string>();
    // Nothing in the band: between two sections the one just read keeps the
    // marker; above the first one (the hero, or a jump back to the top with
    // Home) there is no marker, the same as when the page loads.
    const settle = () => {
      const line = window.innerHeight * 0.2;
      const read = sections.filter((section) => section.getBoundingClientRect().top <= line);
      setActive(read.length ? read[read.length - 1].id : null);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // The first section (in reading order) inside the band wins.
        const current = order.find((id) => visible.has(id));
        if (current) setActive(current);
        else settle();
      },
      // A band from 20% to 35% of the viewport: the section whose top part is
      // where the eye reads, not merely the one touching the bottom edge.
      { rootMargin: '-20% 0px -65% 0px' },
    );
    sections.forEach((section) => observer.observe(section));

    // An instant jump (a "back to top" control, scroll restoration) can land
    // where no section is in the band without any section changing state on
    // the way, so the observer never runs. One check per frame of scrolling
    // covers it; while a section is in the band the observer has the answer.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (visible.size === 0) settle();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  return (
    <nav aria-label={label}>
      <p className="nx-eyebrow mb-5">{label}</p>
      <ol className="flex flex-col border-l border-line">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? 'location' : undefined}
                className="group relative -ml-px flex min-h-11 items-baseline gap-3 border-l border-transparent py-2 pl-5 pr-2 text-[0.9rem] leading-snug text-fg-3 [transition:color_200ms_ease,border-color_200ms_ease] aria-[current=location]:border-accent aria-[current=location]:text-fg [@media(hover:hover)_and_(pointer:fine)]:hover:text-fg"
              >
                <span className="font-mono text-[0.75rem] tabular-nums text-fg-3 [transition:color_200ms_ease] group-aria-[current=location]:text-accent-text" aria-hidden>
                  {item.index}
                </span>
                <span>{item.title}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
