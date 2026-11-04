'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/site/ThemeToggle';
import { Button } from '@/components/site/Button';
import { LIGHT_POOL } from '@/components/site/PageHero';
import { workspaceLoginUrl } from '@/lib/workspaceLogin';
import { focusMain } from './focusMain';

const links = [
  { label: 'Work', href: '/portfolio' },
  { label: 'Services', href: '/services' },
  { label: 'Templates', href: '/templates' },
  { label: 'About', href: '/about' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'FAQ', href: '/#faq' },
];

const TEAM_LOGIN = workspaceLoginUrl();

/** Tap/press behaviour shared by the bar's plain links and the menu button. */
const TAP = 'touch-manipulation select-none [-webkit-tap-highlight-color:transparent]';

/**
 * Sheet choreography (Emil): opening is a tap, a few times per visit, so it gets
 * a real but short entrance — the panel fades in over 280ms, each row rises
 * 16px out of the panel 40ms after the one above it (stagger never blocks: the
 * links are clickable at once). Closing is faster than opening (150ms, no
 * delays). Reduced motion keeps the fades and drops every movement.
 */
const ROW_IN = '[transition:opacity_400ms_var(--ease-out),translate_400ms_var(--ease-out)]';
const ROW_OUT = '[transition:opacity_150ms_var(--ease-out),translate_150ms_var(--ease-out)]';

/** Tailwind's xl: the width from which the bar shows its links and the sheet is gone. */
const DESKTOP_QUERY = '(min-width: 80rem)';

/**
 * Skip link. Its target is the empty #main anchor this component renders right
 * after the header, directly before the page's <main>, so the jump works as a
 * plain fragment link before hydration and without JavaScript. Once hydrated
 * the click goes one better: focus lands on the <main> landmark itself and the
 * address keeps no "#main".
 */
function skipToContent(e: React.MouseEvent<HTMLAnchorElement>) {
  if (focusMain()) e.preventDefault();
}

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Opened or closed from the keyboard (Enter/Space on the toggle, Esc): the
  // sheet and the icon morph switch at once. Animation on a keyboard action
  // only reads as lag (Emil's frequency gate); taps keep the choreography.
  const [instant, setInstant] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Glass once the page moves; tuck away while reading down, return on any scroll
  // up. One passive listener read once per frame, not framer's scroll value: the
  // bar is on every page and needs no animation library to hydrate. React only
  // re-renders when one of the two booleans actually flips.
  const last = useRef(0);
  const sync = useCallback((y: number) => {
    setScrolled(y > 12);
    if (Math.abs(y - last.current) > 6) {
      setHidden(y > last.current && y > 160);
      last.current = y;
    }
  }, []);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync(window.scrollY);
      });
    };
    // A page restored mid-scroll starts with the right state (first frame, not on render).
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [sync]);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Mobile sheet: lock scroll, Esc to close, focus the first link. The page
  // behind it goes inert while it is open, so Tab and screen readers stay in
  // the bar (which holds the close button) and the sheet instead of wandering
  // into content nobody can see.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setInstant(true);
      close();
    };
    window.addEventListener('keydown', onKey);
    const header = headerRef.current;
    const behind = header?.parentElement
      ? [...header.parentElement.children].filter((el): el is HTMLElement => el !== header && el instanceof HTMLElement && !el.inert)
      : [];
    for (const el of behind) el.inert = true;
    // Query the DOM: the Link shim doesn't guarantee ref forwarding.
    const t = window.setTimeout(() => document.getElementById(menuId)?.querySelector<HTMLAnchorElement>('nav a')?.focus(), 80);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      for (const el of behind) el.inert = false;
    };
  }, [open, close, menuId]);

  // The sheet only exists below xl. Rotating a tablet or widening the window
  // past that point hides it and its button, so an open sheet has to close
  // there too: left open, the page stays scroll-locked and inert with nothing
  // on screen to close.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);

  // Close the sheet on navigation (adjusting state during render, not in an effect).
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setOpen(false);
  }

  const isActive = (href: string) => !href.includes('#') && (pathname === href || pathname.startsWith(`${href}/`));
  const tucked = hidden && !open;
  const glass = scrolled || open;
  // `transition-property: none` wins over the arbitrary transition lists below.
  const snap = instant ? '!transition-none' : '';
  // A link or button in the sheet: a tap closes with the sheet's exit, Enter closes at once.
  const tapClose = (e: React.MouseEvent) => {
    setInstant(e.detail === 0);
    setOpen(false);
  };

  return (
    <>
      {/* No transform on <header> itself: a transformed ancestor would trap the
          fixed mobile sheet inside the bar. Empty header area lets clicks through. */}
      <header ref={headerRef} className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top,0px)]">
        {/* First stop for keyboard users: hidden until focused, then a pill over the bar.
            Not rendered while the sheet is open (the page behind it is inert then). */}
        {!open && (
          <a
            href="#main"
            onClick={skipToContent}
            className="nx-btn nx-btn-primary pointer-events-auto absolute left-[var(--nx-gutter)] top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-10 [&:not(:focus-visible)]:sr-only"
          >
            Skip to content
          </a>
        )}
        <div
          // Leaving is quicker than returning (200ms vs 280ms), both on the strong ease-out.
          // Keyboard focus inside the bar (Tab past "Skip to content") always brings it back;
          // a mouse click that leaves focus on a button does not pin it open. Reduced
          // motion: the bar never slides away; it just stays, as plain glass.
          className={`nx-wrap pt-3 has-[:focus-visible]:translate-y-0 motion-reduce:translate-y-0 ${
            tucked
              ? '-translate-y-[120%] [transition:translate_var(--dur-dropdown)_var(--ease-out)]'
              : 'translate-y-0 [transition:translate_var(--dur-modal)_var(--ease-out)]'
          }`}
        >
          {/* The island: an outlined pill at the top of the page (so the logo's inset reads
              as the pill's own padding), floating glass once the page moves, with a hairline
              of light along its top edge (inner highlight) so the glass has an edge. */}
          <div
            className={`nx-nav-pill pointer-events-auto relative flex h-[3.75rem] items-center justify-between gap-4 rounded-full border pl-5 pr-2 [transition:background-color_250ms_ease,border-color_250ms_ease,box-shadow_250ms_ease] ${
              glass
                ? 'nx-glass shadow-[inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-md)] light:shadow-[inset_0_1px_0_rgb(255_255_255/0.9),var(--shadow-md)]'
                : 'border-line'
            }`}
          >
            {/* Brand */}
            <Link prefetch={false} href="/" className={`relative z-10 flex min-h-11 items-center gap-2 ${TAP}`} aria-label="NixGen — home">
              <span className="font-heading text-[1.05rem] font-semibold tracking-[0.14em] text-fg">
                NIXGEN<span className="text-accent-text">.</span>
              </span>
            </Link>

            {/* Center links — from xl only: below 1280px the six links and the right-hand
                actions don't fit side by side (they collided at 1024), so the sheet takes over. */}
            <nav aria-label="Primary" className="absolute left-1/2 hidden -translate-x-1/2 xl:block">
              <ul className="flex items-center gap-1">
                {links.map((link) => {
                  const active = isActive(link.href);
                  return (
                    <li key={link.href}>
                      <Link prefetch={false}
                        href={link.href}
                        aria-current={active ? 'page' : undefined}
                        className={`relative inline-flex min-h-11 items-center rounded-full px-3.5 text-[0.9rem] [transition:color_200ms_ease] ${TAP} ${
                          active ? 'text-fg' : 'text-fg-2 hover:text-fg'
                        }`}
                      >
                        {link.label}
                        {active && <span className="absolute inset-x-3.5 bottom-2 h-px bg-accent-text" aria-hidden />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Right actions */}
            <div className="relative z-10 flex items-center gap-1.5">
              <ThemeToggle />
              {/* Through DeskDev, not straight to /login: see workspaceLoginUrl(). A plain <a>, since
                  DeskDev is another root layout (its own subdomain in production). */}
              <a
                href={TEAM_LOGIN}
                className={`hidden min-h-11 items-center rounded-full px-3.5 text-[0.9rem] text-fg-2 [transition:color_200ms_ease] hover:text-fg md:inline-flex ${TAP}`}
              >
                Team login
              </a>
              <Button href="/contact" size="sm" arrow magnetic className="hidden sm:inline-flex">
                Get started
              </Button>

              {/* Menu button: two lines fold into an X (an on-screen morph: ease-in-out, 280ms). */}
              <button
                ref={toggleRef}
                type="button"
                // detail 0: activated with Enter/Space, not a pointer.
                onClick={(e) => {
                  setInstant(e.detail === 0);
                  setOpen((v) => !v);
                }}
                aria-expanded={open}
                aria-controls={menuId}
                aria-label={open ? 'Close menu' : 'Open menu'}
                className={`relative grid size-11 place-items-center rounded-full text-fg [transition:background-color_200ms_ease,scale_var(--dur-press)_var(--ease-out)] hover:bg-surface-2 active:scale-[0.97] motion-reduce:active:scale-100 xl:hidden nx-js-only ${TAP}`}
              >
                <span
                  aria-hidden
                  className={`absolute h-[1.5px] w-5 rounded bg-current [transition:translate_var(--dur-modal)_var(--ease-in-out),rotate_var(--dur-modal)_var(--ease-in-out)] motion-reduce:transition-none ${snap} ${open ? 'rotate-45' : '-translate-y-[4px]'}`}
                />
                <span
                  aria-hidden
                  className={`absolute h-[1.5px] w-5 rounded bg-current [transition:translate_var(--dur-modal)_var(--ease-in-out),rotate_var(--dur-modal)_var(--ease-in-out)] motion-reduce:transition-none ${snap} ${open ? '-rotate-45' : 'translate-y-[4px]'}`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Without JavaScript the menu button cannot open anything (the layout's noscript
            style hides it): below xl the links sit in one scrolling row under the bar. */}
        <noscript>
          <nav aria-label="Primary" className="nx-wrap pointer-events-auto pt-2 xl:hidden">
            <ul className="nx-glass flex overflow-x-auto rounded-full px-2">
              {links.map((link) => (
                <li key={link.href} className="shrink-0">
                  <a href={link.href} className="inline-flex min-h-11 items-center px-3 text-[0.9rem] text-fg-2">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </noscript>

        {/* Mobile sheet: a screen-filling opaque panel, so nothing of the page shows through
            the links. A disclosure, not a dialog: its close control is the menu button in the
            bar (aria-expanded / aria-controls), which stays reachable while the page behind
            is inert. Only the part below the bar scrolls, so on a short screen the links
            fade out at the bar's edge instead of sliding underneath the floating pill. */}
        <div
          id={menuId}
          inert={!open}
          // Visibility flips instantly on open (so focus can land) and only after the fade on close.
          className={`fixed inset-0 -z-10 flex flex-col bg-bg xl:hidden ${snap} ${
            open
              ? 'pointer-events-auto visible opacity-100 [transition:opacity_var(--dur-modal)_var(--ease-out),visibility_0s_linear_0s]'
              : 'invisible opacity-0 [transition:opacity_var(--dur-dropdown)_var(--ease-out),visibility_0s_linear_var(--dur-dropdown)]'
          }`}
        >
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-96 ${LIGHT_POOL}`} aria-hidden />
          <div className="relative mt-[calc(var(--nx-nav-h)+env(safe-area-inset-top,0px))] min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,#000_1.25rem)]">
            <div className="nx-wrap flex min-h-full flex-col pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-6">
              <nav aria-label="Mobile" className="flex-1">
                <ul className="flex flex-col">
                  {links.map((link, i) => {
                    const active = isActive(link.href);
                    return (
                      <li
                        key={link.href}
                        className={`border-b border-line motion-reduce:translate-y-0 ${snap} ${
                          open ? `translate-y-0 opacity-100 ${ROW_IN}` : `translate-y-4 opacity-0 ${ROW_OUT}`
                        }`}
                        style={{ transitionDelay: open ? `${60 + i * 40}ms` : '0ms' }}
                      >
                        <Link prefetch={false}
                          href={link.href}
                          onClick={tapClose}
                          aria-current={active ? 'page' : undefined}
                          // Sized so the six links, the CTA and the Team login fit a phone's visible
                          // height (390×664, 360×640) without scrolling.
                          className={`flex min-h-14 items-center justify-between py-3 font-heading text-[clamp(1.6rem,6.5vw,2.25rem)] font-medium tracking-[-0.03em] text-fg ${TAP}`}
                        >
                          <span className="flex items-center gap-3">
                            {link.label}
                            {active && <span className="size-1.5 rounded-full bg-accent-text" aria-hidden />}
                          </span>
                          <span className="nx-mono text-xs text-fg-3">0{i + 1}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
  
              <div
                className={`flex flex-col gap-3 pt-6 motion-reduce:translate-y-0 ${snap} ${
                  open ? `translate-y-0 opacity-100 ${ROW_IN}` : `translate-y-4 opacity-0 ${ROW_OUT}`
                }`}
                style={{ transitionDelay: open ? `${60 + links.length * 40}ms` : '0ms' }}
              >
                <Button href="/contact" size="lg" arrow className="w-full justify-between" onClick={tapClose}>
                  Get started
                </Button>
                {/* No second theme switch here: the one in the bar stays on screen above the sheet. */}
                <a
                  href={TEAM_LOGIN}
                  onClick={tapClose}
                  className={`nx-link w-fit py-2.5 leading-6 [background-clip:content-box] [background-origin:content-box] text-[0.95rem] text-fg-2 ${TAP}`}
                >
                  Team login →
                </a>
              </div>
            </div>
          </div>
        </div>
      </header>
      {/* Skip link target (see skipToContent). Zero-size and never a Tab stop. */}
      <div id="main" tabIndex={-1} className="outline-none" />
    </>
  );
}
