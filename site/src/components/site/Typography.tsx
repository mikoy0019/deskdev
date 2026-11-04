import { Children, Fragment, isValidElement, type ElementType, type ReactElement, type ReactNode } from 'react';
import { BreathingDot } from './motion/BreathingDot';

/**
 * Unwraps fragments so a split headline sees the real words. Pages pass titles
 * as `<>Built like a <Accent>launch</Accent></>`; <SplitWords> would treat that
 * whole fragment as one unit (one mask, no word stagger).
 */
export function flattenTitle(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement(child) && child.type === Fragment
      ? flattenTitle((child as ReactElement<{ children?: ReactNode }>).props.children)
      : [child],
  );
}

/** Section label: "01 — The Problem" in mono caps. */
export function Eyebrow({
  index,
  children,
  as = 'p',
  className = '',
  ...rest
}: {
  index?: string;
  children: ReactNode;
  as?: 'p' | 'span' | 'div' | 'h2' | 'h3' | 'li';
  className?: string;
  [data: `data-${string}`]: string | undefined;
}) {
  const Tag = as as ElementType<{ className?: string; children?: ReactNode }>;
  return (
    <Tag className={`nx-eyebrow ${className}`} {...rest}>
      {/* The index is decorative numbering ("01 —"); screen readers get the label only. */}
      {index && (
        <span className="nx-eyebrow-index" aria-hidden>
          {index}
        </span>
      )}
      {index && <span className="nx-eyebrow-line" aria-hidden />}
      <span>{children}</span>
    </Tag>
  );
}

/**
 * Live status dot + label ("Available Q2 2026 — limited slots"). The dot
 * breathes (motion kit: transform + opacity on a pseudo-element, paused
 * off-screen, still under reduced motion); the label carries the meaning.
 */
export function Beacon({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`nx-beacon ${className}`}>
      <BreathingDot />
      <span>{children}</span>
    </span>
  );
}

/** Italic serif accent for one or two words in a heading. */
export function Accent({ children }: { children: ReactNode }) {
  return <em className="nx-serif">{children}</em>;
}

/** Small pill label. */
export function Tag({ children, accent = false, className = '' }: { children: ReactNode; accent?: boolean; className?: string }) {
  return <span className={`nx-tag ${accent ? 'nx-tag-accent' : ''} ${className}`}>{children}</span>;
}
