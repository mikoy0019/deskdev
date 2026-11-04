'use client';

import { Children, Fragment, isValidElement, useMemo, type ReactNode } from 'react';
import { m } from 'framer-motion';
import { StaggerContext, useInStagger, useMotionKit, usePrefersReducedMotion } from './hooks';
import { IN_VIEW, STAGGER } from './presets';
import { liveMotionMode } from './mode';
import { staggerDelay, wordFrames, wordTransition, wordsSpan } from './variants';
import { splitWords } from './split';
import { MOTION_TAGS, type ElementProps, type MotionTag } from './tags';

export type SplitWordsProps = ElementProps & {
  /** Heading level or element. Default h2. */
  as?: MotionTag;
  /** `inView` (default) or `load` (hero headline). Ignored inside a <Stagger>. */
  trigger?: 'inView' | 'load';
  /** Seconds before the first word (standalone only). */
  delay?: number;
  /** Seconds between words, clamped to 30–80ms. Default 50ms. */
  each?: number;
  margin?: string;
  /** How much of the heading must be visible before `inView` fires: `some` (default), `all` or 0–1. */
  amount?: 'some' | 'all' | number;
  /** Text, optionally with inline elements (an accent <em>, a <span>): each element rises as one unit. */
  children: ReactNode;
};

/**
 * Headline whose words rise out of their own line masks, in sequence.
 * Replaces `data-split`.
 *
 * Accessibility: the words are the real text, in order, with real spaces
 * between them — screen readers, find-in-page, copy and crawlers get the
 * sentence once, exactly as written. Only presentation spans are added.
 */
export function SplitWords({
  as = 'h2',
  trigger = 'inView',
  delay = 0,
  each = STAGGER.words,
  margin = IN_VIEW.margin,
  amount,
  children,
  ...rest
}: SplitWordsProps) {
  const inStagger = useInStagger();
  const reduced = usePrefersReducedMotion();
  const { instant } = useMotionKit();
  const Tag = MOTION_TAGS[as];

  const parentVariants = useMemo(
    () => ({
      hidden: {},
      // A function: resolved when the entrance starts, with the live motion mode (mode.ts).
      shown: () => {
        const mode = liveMotionMode({ reduced, instant });
        const together = mode.instant || mode.reduced;
        return { transition: { delayChildren: (i: number) => (inStagger ? 0 : delay) + (together ? 0 : staggerDelay(i, each, 1)) } };
      },
    }),
    [inStagger, delay, instant, reduced, each],
  );

  const wordVariants = useMemo(() => {
    const frames = wordFrames();
    return { hidden: frames.hidden, shown: () => ({ ...frames.shown, transition: wordTransition(liveMotionMode({ reduced, instant })) }) };
  }, [reduced, instant]);

  const word = (content: ReactNode, key: string | number) => (
    <span key={key} className="nx-kit-word-mask">
      <m.span className="nx-kit-word" data-nx-reveal="" variants={wordVariants}>
        {content}
      </m.span>
    </span>
  );

  let n = 0;
  const parts = Children.toArray(children).map((child, ci) => {
    if (typeof child === 'string' || typeof child === 'number') {
      return (
        <Fragment key={`t${ci}`}>
          {splitWords(String(child)).map((token) => (token.type === 'space' ? token.text : word(token.text, n++)))}
        </Fragment>
      );
    }
    // <br /> and other void/structural elements pass through untouched.
    if (isValidElement(child) && child.type === 'br') return child;
    return word(child, n++);
  });

  // Inside a Stagger the heading is one item that holds the stage for its whole
  // cascade: the group reads `data-nx-span` to start the next item after it.
  const trig = inStagger
    ? { 'data-nx-item': '', 'data-nx-span': wordsSpan(n, each).toFixed(3) }
    : {
        initial: 'hidden',
        ...(trigger === 'load' ? { animate: 'shown' } : { whileInView: 'shown', viewport: { once: true, margin, amount } }),
      };

  return (
    <StaggerContext.Provider value>
      <Tag {...rest} variants={parentVariants} {...trig}>
        {parts}
      </Tag>
    </StaggerContext.Provider>
  );
}
