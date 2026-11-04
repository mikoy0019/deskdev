'use client';

import { Shimmer } from '@/components/site/motion/Shimmer';

/*
 * Loading placeholder shaped like what is about to appear (taste: skeletons that match the
 * layout, not a spinner). Purely decorative: FrameLoader hides it from assistive tech and
 * announces the wait in words instead. The sweep is the kit Shimmer (linear, constant motion,
 * paused off-screen, static under reduced motion).
 */

/** The template gallery (public/templates/gallery.html): header + count, the type filter, card grid. */
export function GallerySkeleton() {
  return (
    <div className="h-full overflow-hidden bg-bg">
      <div className="mx-auto w-full max-w-[calc(1320px+2*clamp(20px,4vw,48px))] px-[clamp(20px,4vw,48px)]">
        {/* Header: eyebrow + title on the left, the template count on the right (stacked on phones). */}
        <div className="grid items-end gap-x-12 gap-y-6 pb-[clamp(24px,3.5vw,40px)] pt-[clamp(28px,5vw,64px)] min-[1081px]:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <Shimmer className="h-2.5 w-36 rounded-full" />
            <Shimmer className="mt-6 h-[clamp(2.4rem,5.4vw,5rem)] w-[min(34rem,80%)] rounded-2xl" />
          </div>
          <div className="flex flex-col gap-2.5 border-t border-line pt-4">
            <Shimmer className="h-7 w-16 rounded-lg sm:w-20" />
            <Shimmer className="h-2 w-24 rounded-full" />
          </div>
        </div>
      </div>

      {/* Filters band */}
      <div className="border-y border-line">
        <div className="mx-auto grid w-full max-w-[calc(1320px+2*clamp(20px,4vw,48px))] gap-3 px-[clamp(20px,4vw,48px)] py-4 min-[900px]:grid-cols-[minmax(0,1fr)_300px]">
          {/* One row: the Type filter. */}
          <div className="flex items-center gap-1.5 overflow-hidden">
            <Shimmer className="mr-3 h-2 w-8 shrink-0 rounded-full" />
            {Array.from({ length: 9 }, (_, i) => (
              <Shimmer key={i} className="h-9 w-16 shrink-0 rounded-full sm:w-20" />
            ))}
          </div>
          <Shimmer className="order-first h-11 w-full rounded-full min-[900px]:order-none" />
        </div>
      </div>

      {/* Card grid: repeat(auto-fill, minmax(320px, 1fr)), like the gallery. */}
      <div className="mx-auto w-full max-w-[calc(1320px+2*clamp(20px,4vw,48px))] px-[clamp(20px,4vw,48px)]">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-6 pt-8">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="overflow-hidden rounded-[20px] border border-line bg-surface p-2">
              <Shimmer className="aspect-video w-full rounded-[13px]" />
              <div className="px-3 pb-3 pt-4">
                <Shimmer className="h-4 w-3/5 rounded-md" />
                <Shimmer className="mt-3 h-2.5 w-2/5 rounded-full" />
                <div className="mt-4 flex gap-1.5">
                  <Shimmer className="h-6 w-12 rounded-full" />
                  <Shimmer className="h-6 w-20 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
