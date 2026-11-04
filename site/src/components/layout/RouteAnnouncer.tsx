'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { focusMain } from './focusMain';

/** How long to wait for the new page's <title> before naming the page by its heading instead. */
const TITLE_WAIT_MS = 1000;

/**
 * Tells assistive technology that a client-side navigation happened. A full
 * page load announces itself; a route change swaps the content silently and
 * leaves focus on <body> (the link that was clicked is gone with the old
 * page). After each change of path this component:
 * - writes the new page's title into a visually hidden live region, and
 * - moves focus to <main>, so reading and the next Tab start at the content.
 *
 * Not on first render (the browser has announced that page already), and not
 * for a link to a section ("/#pricing"): there the jump itself is the context,
 * and focus stays out of the way of the scroll.
 */
export function RouteAnnouncer() {
  const pathname = usePathname();
  const [message, setMessage] = useState('');
  const seen = useRef({ path: pathname, title: '' });

  useEffect(() => {
    const last = seen.current;
    if (last.path === pathname) {
      last.title = document.title;
      return;
    }
    last.path = pathname;

    const announce = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      const title = document.title || document.querySelector('h1')?.textContent || '';
      last.title = document.title;
      setMessage(title.trim());
      if (!window.location.hash) focusMain({ preventScroll: true, keepInner: true });
    };
    // The title can land a moment after the path does: wait for it, but not for long.
    const observer = new MutationObserver(() => {
      if (document.title !== last.title) announce();
    });
    const timer = window.setTimeout(announce, TITLE_WAIT_MS);
    if (document.title !== last.title) announce();
    else observer.observe(document.head, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [pathname]);

  return (
    <p className="sr-only" aria-live="assertive" aria-atomic="true">
      {message}
    </p>
  );
}
