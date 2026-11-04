'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { Bezel } from './Bezel';
import styles from './home.module.css';

export interface UseCase {
  label: string;
  title: string;
  description: string;
  metrics: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Industries switcher: an accessible tab set (WAI-ARIA tabs pattern): a
 * vertical tab list with roving tabindex (Arrow keys, Home, End; activation
 * follows focus) beside the active panel. Inactive panels carry the `hidden`
 * class, not the attribute: Tailwind's reset hides `[hidden]` with an important
 * rule inside a layer, which the layout's no-JavaScript rule (all four panels
 * laid out, since the tabs cannot switch them) could not override.
 *
 * Motion (Emil's gate): a click glides one shared indicator to the new tab
 * (260ms ease-in-out, a CSS transition, so rapid clicks retarget instead of
 * restarting) and lifts the new panel in (240ms). A keyboard switch lands
 * instantly: never animate what the keyboard drives.
 */
export function UseCaseTabs({ cases, labelledBy }: { cases: UseCase[]; labelledBy?: string }) {
  const [active, setActive] = useState(0);
  const [instant, setInstant] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const base = useId();
  const tabId = (i: number) => `${base}-tab-${i}`;
  const panelId = (i: number) => `${base}-panel-${i}`;

  // Place the indicator on the active tab: transform only (no layout animation).
  const place = useCallback(() => {
    const tab = tabs.current[active];
    const bar = indicator.current;
    if (!tab || !bar) return;
    bar.style.height = `${tab.offsetHeight}px`;
    bar.style.transform = `translate3d(0, ${tab.offsetTop}px, 0)`;
    bar.setAttribute('data-ready', '');
  }, [active]);

  useIsoLayoutEffect(place, [place]);

  // Re-measure when the rows change size (font load, breakpoint, zoom) without animating.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const bar = indicator.current;
      if (!bar) return;
      bar.setAttribute('data-instant', '');
      place();
      requestAnimationFrame(() => {
        if (!instant) bar.removeAttribute('data-instant');
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [place, instant]);

  const select = (i: number, viaKeyboard: boolean) => {
    setInstant(viaKeyboard);
    setActive(i);
  };

  const focusTab = (i: number) => {
    const n = (i + cases.length) % cases.length;
    select(n, true);
    tabs.current[n]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        focusTab(i + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        focusTab(i - 1);
        break;
      case 'Home':
        focusTab(0);
        break;
      case 'End':
        focusTab(cases.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
      <div
        ref={list}
        role="tablist"
        aria-orientation="vertical"
        aria-labelledby={labelledBy}
        className={`${styles.tabs} relative isolate border-t border-line lg:col-span-4 lg:flex lg:flex-col`}
        data-instant={instant || undefined}
      >
        {/* The one indicator: a surface wash with an accent edge, gliding between rows. */}
        <span
          ref={indicator}
          aria-hidden
          className={`${styles.tabIndicator} -z-10 border-l-2 border-accent bg-[color-mix(in_oklab,var(--fg)_4%,transparent)]`}
          data-instant={instant || undefined}
        />
        {cases.map((c, i) => {
          const selected = i === active;
          return (
            <button
              key={c.label}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(i)}
              aria-selected={selected}
              aria-controls={panelId(i)}
              tabIndex={selected ? 0 : -1}
              onClick={(e) => select(i, e.detail === 0)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`nx-press relative flex min-h-[4.25rem] w-full items-center gap-5 border-b border-line py-4 pl-5 pr-4 text-left [transition:color_200ms_ease,scale_var(--dur-press)_var(--ease-out)] lg:flex-1 ${
                selected ? 'text-fg' : 'text-fg-3 hover:text-fg-2'
              }`}
            >
              <span className={`nx-mono w-6 text-xs tabular-nums ${selected ? 'text-accent-text' : 'text-fg-3'}`}>{pad(i + 1)}</span>
              <span className="flex-1 font-heading text-[clamp(1.125rem,1.5vw,1.375rem)] font-medium tracking-[-0.018em]">{c.label}</span>
              <ArrowRightIcon
                size={18}
                weight="regular"
                aria-hidden
                className={`${styles.tabArrow} shrink-0 ${selected ? 'translate-x-0 text-accent-text opacity-100' : '-translate-x-1.5 opacity-0'}`}
              />
            </button>
          );
        })}
      </div>

      <div className={`${styles.panels} lg:col-span-8`} data-instant={instant || undefined}>
        {cases.map((c, i) => (
          <div
            key={c.label}
            role="tabpanel"
            id={panelId(i)}
            aria-labelledby={tabId(i)}
            tabIndex={0}
            className={`h-full rounded-[2rem] ${styles.panelIn}${i !== active ? ' hidden' : ''}`}
          >
            <Bezel className="h-full" coreClassName="flex flex-col p-7 sm:p-10 lg:p-12">
              <span
                aria-hidden
                data-n={pad(i + 1)}
                className={`nx-numeral pointer-events-none absolute right-6 top-5 select-none text-[clamp(7rem,13vw,11rem)] before:content-[attr(data-n)] max-sm:hidden [--outline-fill:var(--surface)] ${styles.outline}`}
              />
              <p className="nx-mono relative text-xs uppercase tracking-[0.14em] text-fg-3">
                <span className="text-accent-text">{pad(i + 1)}</span> / {pad(cases.length)}
              </p>
              <h3 className="nx-h2 relative mt-10 max-w-[15ch] text-[clamp(2rem,3.4vw,3.25rem)] sm:mt-14">{c.title}</h3>
              <p className="nx-lede relative mt-6 max-w-2xl">{c.description}</p>
              {/* Outcomes as hairline cells, not boxes inside the box; pinned to the plate's foot. */}
              <div aria-hidden className="min-h-10 flex-1" />
              <ul className="relative grid border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
                {c.metrics.map((m) => (
                  <li key={m} className="flex items-center gap-3 border-b border-line py-4 last:border-b-0 sm:flex-col sm:items-start sm:gap-6 sm:border-b-0 sm:px-5 sm:py-6 sm:first:pl-0 sm:last:pr-0">
                    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
                      <ArrowUpRightIcon size={14} weight="regular" />
                    </span>
                    <span className="font-heading text-[clamp(1.1rem,1.45vw,1.3rem)] font-medium leading-[1.15] tracking-[-0.025em] text-fg">{m}</span>
                  </li>
                ))}
              </ul>
            </Bezel>
          </div>
        ))}
      </div>
    </div>
  );
}
