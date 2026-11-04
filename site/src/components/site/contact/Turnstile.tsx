'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile, rendered explicitly so the script is only requested by
 * a form that shows the widget. The site key is public; without it (the owner
 * has not set NEXT_PUBLIC_TURNSTILE_SITE_KEY yet) nothing renders and the forms
 * send without a token.
 *
 * On /contact the widget never blocks a send: /api/contact quarantines a brief
 * that fails the check instead of refusing it. /api/subscribe does refuse a
 * missing token, so the footer waits for one and uses `onBlocked` to tell the
 * visitor when the widget cannot load at all (ad blocker, offline).
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || '';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    script.onerror = () => {
      // Blocked or offline: let a later mount try again.
      loader = null;
      script.remove();
      reject(new Error('turnstile'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export function Turnstile({
  onToken,
  onBlocked,
  action,
  resetKey = 0,
  className = '',
}: {
  /** The script could not load (blocked or offline): no token will arrive from this widget. */
  onBlocked?: () => void;
  /** The widget's token; '' when it expired or errored. */
  onToken: (token: string) => void;
  /** Shown in the Turnstile analytics, e.g. 'contact'. */
  action?: string;
  /** Change it to draw a fresh widget: a token only verifies once. */
  resetKey?: number;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const report = useRef(onToken);
  const reportBlocked = useRef(onBlocked);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    report.current = onToken;
    reportBlocked.current = onBlocked;
  }, [onToken, onBlocked]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    let api: TurnstileApi | null = null;
    let widgetId: string | null = null;

    loadTurnstile()
      .then((loaded) => {
        if (cancelled || !host.current) return;
        api = loaded;
        setBlocked(false);
        widgetId = loaded.render(host.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          // The site's own theme, not the system's: the toggle in the footer can differ from it.
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          size: 'flexible',
          callback: (token: string) => report.current(token),
          'expired-callback': () => report.current(''),
          'error-callback': () => {
            report.current('');
            return true; // handled: the form still sends
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setBlocked(true);
        reportBlocked.current?.();
      });

    return () => {
      cancelled = true;
      report.current('');
      if (api && widgetId) {
        try {
          api.remove(widgetId);
        } catch {
          // already gone
        }
      }
    };
  }, [action, resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;
  // 65px is the widget's own height: reserved so the form does not jump when it arrives.
  // A blocked widget keeps its (collapsed) host, so a later resetKey can still draw into it.
  return <div ref={host} hidden={blocked} className={blocked ? undefined : `min-h-[65px] ${className}`} />;
}
