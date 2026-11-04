'use client';

import { useEffect, useRef, useState } from 'react';
import { Shimmer } from '@/components/site/motion';
import { Monogram } from './Monogram';
import styles from './portfolio.module.css';
import type { ClientSite } from './types';

/**
 * mShots capture of a client site, with a fallback. mShots rate-limits bursts
 * (403 text/html) and answers an uncached capture with a 400x300 "generating"
 * GIF; either way the card shows the full accent monogram instead of a broken
 * image or a stretched placeholder.
 *
 * States: `idle` (server render / no JS: the img shows normally), `loading`
 * (hidden; the faint monogram with a light sweep stands in as the skeleton),
 * `loaded` (fades in over 280ms), `failed` (monogram).
 */
type ShotState = 'idle' | 'loading' | 'loaded' | 'failed';

/** Real captures are 640 or 1280 wide (16:9), stored uploads included; mShots' placeholder is 400x300. */
const isPlaceholder = (img: HTMLImageElement) => img.naturalWidth < 600;

export function ClientShot({ site, src, srcSet, sizes }: { site: ClientSite; src: string; srcSet?: string | null; sizes?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<ShotState>('idle');

  // Catch a load or error that finished before hydration (React does not
  // replay those events). A lazy image that has not been requested yet has an
  // empty currentSrc, so it is not mistaken for a broken one.
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    if (img.complete && img.currentSrc) {
      setState(img.naturalWidth === 0 || isPlaceholder(img) ? 'failed' : 'loaded');
    } else {
      setState('loading');
    }
  }, []);

  if (state === 'failed') return <Monogram site={site} />;

  return (
    <>
      {/* skeleton while the capture loads: faint monogram + a light sweep */}
      <Monogram site={site} quiet />
      {state === 'loading' && <Shimmer className="absolute inset-0 rounded-none bg-transparent" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- remote capture driven by its own ref and onLoad/onError state */}
      <img
        ref={ref}
        src={src}
        srcSet={srcSet ?? undefined}
        sizes={srcSet ? sizes : undefined}
        alt={site.imageAlt ?? `${site.name} website`}
        width={640}
        height={360}
        loading="lazy"
        decoding="async"
        onLoad={(e) => setState(isPlaceholder(e.currentTarget) ? 'failed' : 'loaded')}
        onError={() => setState('failed')}
        className={`relative h-full w-full object-cover object-top ${styles.thumbImg} ${state === 'loading' ? 'opacity-0' : 'opacity-100'}`}
      />
    </>
  );
}
