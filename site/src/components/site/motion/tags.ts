'use client';

import type { HTMLAttributes } from 'react';
import { m } from 'framer-motion';

/** Elements the kit's wrappers can render as. */
export type MotionTag =
  | 'div'
  | 'section'
  | 'article'
  | 'aside'
  | 'header'
  | 'footer'
  | 'figure'
  | 'ul'
  | 'ol'
  | 'li'
  | 'p'
  | 'span'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'blockquote'
  | 'dl'
  | 'dd'
  | 'dt';

/** DOM props whose types framer-motion redefines (its own animation / drag events). */
type MotionConflicts =
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onDragOver'
  | 'onDragEnter'
  | 'onDragLeave'
  | 'onDrop'
  | 'onDragExit';

/** Plain DOM props a kit wrapper forwards to its element. */
export type ElementProps = Omit<HTMLAttributes<HTMLElement>, MotionConflicts> & {
  [data: `data-${string}`]: string | number | boolean | undefined;
};

/**
 * The `m` component for each tag, resolved once at module load (stable
 * identities, so React never remounts a wrapper). Typed as the div variant:
 * they all share the HTML prop shape.
 */
export const MOTION_TAGS = {
  div: m.div,
  section: m.section,
  article: m.article,
  aside: m.aside,
  header: m.header,
  footer: m.footer,
  figure: m.figure,
  ul: m.ul,
  ol: m.ol,
  li: m.li,
  p: m.p,
  span: m.span,
  h1: m.h1,
  h2: m.h2,
  h3: m.h3,
  h4: m.h4,
  blockquote: m.blockquote,
  dl: m.dl,
  dd: m.dd,
  dt: m.dt,
} as unknown as Record<MotionTag, typeof m.div>;
