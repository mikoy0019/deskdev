/**
 * Marketing-site motion kit (Framer Motion). API + examples:
 * scratchpad doc site-motion-kit.md; short version:
 *
 *   <Reveal>…</Reveal>                         scroll entrance (up|fade|left|right|scale|clip)
 *   <Stagger><StaggerItem/>…</Stagger>         group entrance, 30–80ms apart
 *   <SplitWords as="h1" trigger="load">…</SplitWords>   word-by-word headline
 *   <Counter value="$14M+" />                  count-up statistic
 *   <Magnetic><Button/></Magnetic>             pointer pull (mouse only)
 *   <Marquee items={…} />                      endless band (CSS loop)
 *   <Parallax amount={0.1}>…</Parallax>        scroll-linked drift
 *   <HorizontalScroll>…</HorizontalScroll>     sticky sideways pan (≥1024px)
 *   <PressScale>…</PressScale> / pressClass    press feedback
 *   BreathingDot, Typewriter, Shimmer, InfiniteCarousel, AutoSortList, LoopingPop
 *                                              Bento 2.0 perpetual primitives
 *
 * Everything renders `m.*` under the (site) layout's <MotionProvider>.
 */
export { MotionProvider } from './MotionProvider';
export { MotionNoScript } from './MotionNoScript';
export { Reveal, RevealMedia, type RevealProps } from './Reveal';
export { Stagger, StaggerItem, type StaggerProps, type StaggerItemProps } from './Stagger';
export { SplitWords, type SplitWordsProps } from './SplitWords';
export { Counter, type CounterProps } from './Counter';
export { Magnetic, type MagneticProps } from './Magnetic';
export { Marquee, InfiniteCarousel, type MarqueeProps } from './Marquee';
export { Parallax, type ParallaxProps } from './Parallax';
export { HorizontalScroll, HorizontalScrollProgress, type HorizontalScrollProps } from './HorizontalScroll';
export { PressScale, pressClass } from './PressScale';
export { BreathingDot, type BreathingDotProps } from './BreathingDot';
export { Shimmer } from './Shimmer';
export { Typewriter, type TypewriterProps } from './Typewriter';
export { AutoSortList, type AutoSortItem, type AutoSortListProps } from './AutoSortList';
export { LoopingPop, type LoopingPopProps } from './LoopingPop';
export { useLoopGate, useLoopHeld, useMediaQuery, useOffscreenPause, usePrefersReducedMotion } from './hooks';
export { liveMotionMode, type MotionMode } from './mode';
export { DECORATIVE_SPRING_OPTIONS, DURATION, EASE, EASE_CSS, IN_VIEW, QUERY, SPRING, STAGGER } from './presets';
export type { RevealKind } from './variants';
export type { MotionTag } from './tags';
