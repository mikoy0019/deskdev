import type { CSSProperties } from 'react';
import { LoopRegion, PausableLoop } from './LoopRegion';
import styles from './home.module.css';

/* Tile shapes cycle per column so the three columns never line up. Landscape
   to square: the tiles are website captures, cropped from their top-left. */
const RATIOS = ['4 / 3', '1 / 1', '3 / 2', '5 / 4', '6 / 5'];

/* The wall (lg+) and the strip (below lg) are both in the HTML and one of them
   is display:none, where a plain eager <img> would still be fetched. So each
   tile's picture comes from a <source> that only matches on its own side of
   the breakpoint, and the <img> itself holds a 1x1 transparent GIF. Eager on
   purpose: a lazy tile inside a drifting, clipped track is only requested once
   it has already slid into view, and arrives as a blank box. Low priority, so
   the tiles queue behind the text and fonts. */
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/* The same test as Tailwind's `lg:` (64rem, so it follows the reader's default
   font size as the layout does) and its exact complement: at any width one of
   the two matches, and it is the one whose container is shown. */
const WALL_MEDIA = '(min-width: 64rem)';
const STRIP_MEDIA = 'not all and (min-width: 64rem)';

function TileImage({ src, media }: { src: string; media: string }) {
  return (
    <picture className="contents">
      <source media={media} srcSet={src} />
      <img src={BLANK_PIXEL} alt="" width={640} height={400} decoding="async" fetchPriority="low" />
    </picture>
  );
}

const COLUMN_MOTION = [
  { dur: 64, delay: -6, down: false },
  { dur: 78, delay: -30, down: true },
  { dur: 58, delay: -18, down: false },
];

/**
 * Hero image wall (lg+): three columns of the studio's own captures drifting in opposite
 * directions. A constant linear CSS loop on transforms (compositor only),
 * paused while off-screen, while a mouse rests on it, from its pause button
 * (keyboard and touch: PausableLoop), and removed under reduced motion. Each
 * column renders its tiles twice and slides by exactly half its height, so the
 * loop is seamless. Decorative: the tiles are aria-hidden.
 */
export function HeroWall({ columns, className = '' }: { columns: string[][]; className?: string }) {
  return (
    <PausableLoop
      className={`${styles.pausable} ${className}`}
      loopClassName={`${styles.wall} grid h-full grid-cols-3 gap-3 overflow-hidden xl:gap-4`}
      toggleClassName={styles.wallToggle}
    >
      {columns.map((images, ci) => {
        const m = COLUMN_MOTION[ci % COLUMN_MOTION.length];
        const style = { '--dur': `${m.dur}s`, '--delay': `${m.delay}s` } as CSSProperties;
        return (
          <div key={ci} className={`nx-kit-loop ${styles.track} ${m.down ? styles.trackDown : ''}`} style={style}>
            {[0, 1].map((loop) =>
              images.map((src, ii) => (
                <div
                  key={`${loop}-${ii}`}
                  className={`nx-media ${styles.tile} mb-3 border border-line xl:mb-4`}
                  style={{ aspectRatio: RATIOS[(ii + ci * 2) % RATIOS.length] }}
                >
                  <TileImage src={src} media={WALL_MEDIA} />
                </div>
              )),
            )}
          </div>
        );
      })}
    </PausableLoop>
  );
}

/** Below lg: the same captures as one horizontal strip drifting left, with the same pause button at its right end. */
export function HeroStrip({ images, className = '' }: { images: string[]; className?: string }) {
  return (
    <PausableLoop className={`${styles.pausable} relative ${className}`} loopClassName={`${styles.strip} overflow-hidden`}>
      <div className={`nx-kit-loop ${styles.stripTrack} items-center`}>
        {[0, 1].map((loop) =>
          images.map((src, i) => (
            <div key={`${loop}-${i}`} className={`nx-media ${styles.tile} mr-3 w-40 shrink-0 border border-line sm:w-48`} style={{ aspectRatio: i % 2 ? '1 / 1' : '4 / 3' }}>
              <TileImage src={src} media={STRIP_MEDIA} />
            </div>
          )),
        )}
      </div>
    </PausableLoop>
  );
}

/** "Scroll" label with a light sweeping along a short hairline. `className`
 *  sets its display (default `flex`), e.g. `hidden lg:flex`. */
export function ScrollCue({ className = 'flex' }: { className?: string }) {
  return (
    <LoopRegion className={`items-center gap-4 ${className}`} aria-hidden>
      <span className="nx-eyebrow">Scroll</span>
      <span className={`${styles.cue} block h-px w-16 bg-line-2`} />
    </LoopRegion>
  );
}
