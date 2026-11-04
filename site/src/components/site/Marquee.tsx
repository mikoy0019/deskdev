/**
 * Endless horizontal band. Kept at this path so pages import it as before;
 * the implementation is the motion kit's (components/site/motion/Marquee):
 * a linear CSS loop on a transform that pauses off-screen, on mouse hover,
 * while focus is inside and from its keyboard pause button, speeds up briefly
 * with scroll velocity, and becomes a static wrapped list under reduced
 * motion. The second copy is aria-hidden and inert, so screen readers hear
 * the list once.
 *
 * Props: items, separator, duration (s per loop), gap, reverse, label,
 * velocityBoost, pauseControl, className, itemClassName.
 */
export { Marquee, type MarqueeProps } from './motion/Marquee';
