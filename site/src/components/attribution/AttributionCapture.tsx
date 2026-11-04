'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { recordAttribution } from '../../lib/attribution';

/**
 * Records first and last touch (UTM, gclid, external referrer, landing path)
 * in sessionStorage for the contact form to send with a brief. Renders
 * nothing. Mount once in the (site) layout.
 *
 * Runs on every client-side navigation too, so a link that carries campaign
 * params can move last touch (see nextAttribution). document.referrer keeps
 * naming the page that opened the tab for the whole visit, so it only counts
 * on the first page view; otherwise every internal click would look like a
 * fresh arrival from that referrer.
 */
export function AttributionCapture() {
  const pathname = usePathname();
  const firstView = useRef(true);

  useEffect(() => {
    recordAttribution(window.location.href, firstView.current ? document.referrer : '');
    firstView.current = false;
  }, [pathname]);

  return null;
}

export default AttributionCapture;
