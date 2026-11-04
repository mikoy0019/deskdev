'use client';

import { useEffect } from 'react';
import { installClientErrorListeners } from '../../lib/clientErrors';

/**
 * Reports what no error page catches on the marketing site: an error thrown in
 * an event handler or a timer, and a promise nobody awaited. Render errors
 * reach app/(site)/error.tsx and app/global-error.tsx, which report their own.
 * Renders nothing. Mount once in the (site) layout; DeskDev has its own
 * document and installs the same listeners from src/deskdev/Root.tsx.
 */
export function ClientErrorListeners() {
  useEffect(() => installClientErrorListeners('site'), []);
  return null;
}

export default ClientErrorListeners;
