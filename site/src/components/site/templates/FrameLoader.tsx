'use client';

import { useLayoutEffect, useRef, type IframeHTMLAttributes, type ReactNode } from 'react';

type FrameLoaderProps = Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'className' | 'onLoad' | 'src' | 'title'> & {
  src: string;
  title: string;
  /** Skeleton shown while the framed document loads. It should match that document's layout. */
  skeleton: ReactNode;
  className?: string;
  frameClassName?: string;
};

/**
 * An iframe with a layout-matched skeleton while its document loads.
 *
 * State lives in a `data-frame` attribute on the wrapper, not in React state, so nothing
 * re-renders. Before JavaScript runs there is no attribute: the skeleton stays hidden and the
 * frame shows as normal, so the page still works without JavaScript. On mount the attribute is
 * set to `loading`, unless a same-origin document already finished loading before hydration
 * (the gallery is often cached). `load` then sets it to `ready`.
 *
 * Motion (Emil's gate): an occasional page load. The purpose is to stop a blank frame swapping
 * abruptly to a full page.
 * - The frame fades in over 300ms on the strong ease-out. Opacity only, so reduced motion keeps
 *   it too.
 * - The skeleton fades out over 150ms, faster than the frame enters.
 * - The skeleton's sweep is the kit Shimmer, which stops under reduced motion.
 */
export function FrameLoader({ src, title, skeleton, className = '', frameClassName = '', ...frame }: FrameLoaderProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    const f = iframe.current;
    if (!el || !f) return;
    let loaded = false;
    try {
      // Same-origin only; a cross-origin frame throws or returns null here and falls through.
      const doc = f.contentDocument;
      loaded = !!doc && doc.readyState === 'complete' && doc.location.href !== 'about:blank';
    } catch {
      loaded = false;
    }
    el.dataset.frame = loaded ? 'ready' : 'loading';
  }, [src]);

  const onLoad = () => {
    const f = iframe.current;
    // The initial about:blank document of a fresh frame also fires `load` in some browsers.
    try {
      if (f?.contentDocument?.location.href === 'about:blank') return;
    } catch {
      // Cross-origin: this load is the real page.
    }
    if (wrap.current) wrap.current.dataset.frame = 'ready';
  };

  return (
    <div ref={wrap} className={`group/frame relative isolate ${className}`.trim()}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 ease-out group-data-[frame=loading]/frame:opacity-100"
      >
        {skeleton}
      </div>
      <iframe
        ref={iframe}
        src={src}
        title={title}
        onLoad={onLoad}
        className={`relative block h-full w-full border-0 transition-opacity duration-300 ease-out group-data-[frame=loading]/frame:opacity-0 ${frameClassName}`.trim()}
        {...frame}
      />
      {/* Announces the wait to screen readers; empty (silent) once the frame is ready. */}
      <span role="status" className="sr-only">
        <span className="hidden group-data-[frame=loading]/frame:inline">Loading {title}</span>
      </span>
    </div>
  );
}
