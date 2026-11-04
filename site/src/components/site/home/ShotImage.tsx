'use client';

import { useEffect, useRef, useState } from 'react';
import { Shimmer } from '@/components/site/motion';

/**
 * A lazy Field Work capture with a loading state that matches its plate: a
 * kit shimmer covers the frame until the image has loaded (or failed), then
 * is removed. The captures come from a third-party service and can arrive
 * late on a cold load.
 */
export function ShotImage({ src, alt }: { src: string; alt: string }) {
  const img = useRef<HTMLImageElement>(null);
  const [settled, setSettled] = useState(false);

  // The image may finish before hydration attaches onLoad.
  useEffect(() => {
    if (img.current?.complete) setSettled(true);
  }, []);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size lazy <img>, kept plain on purpose (next/image would change the markup) */}
      <img
        ref={img}
        src={src}
        alt={alt}
        width={600}
        height={420}
        loading="lazy"
        decoding="async"
        onLoad={() => setSettled(true)}
        onError={() => setSettled(true)}
        className="h-full w-full object-cover"
      />
      {!settled && <Shimmer className="pointer-events-none absolute inset-0 block h-full w-full rounded-none" />}
    </>
  );
}
