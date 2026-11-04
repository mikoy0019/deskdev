import type { ReactNode } from 'react';
import styles from './home.module.css';

/**
 * Double-bezel surface: a hairline tray (outer shell, 6px padding) holding the
 * content plate (inner core) with a concentric radius and a top-edge
 * highlight. Use it where elevation carries hierarchy (the lead quote, the
 * featured tier, bento visuals), not on every block.
 */
export function Bezel({
  children,
  accent = false,
  hover = false,
  className = '',
  coreClassName = '',
}: {
  children: ReactNode;
  /** Featured: accent hairline + tinted depth instead of a glow. */
  accent?: boolean;
  /** Hairline firms up under a mouse (no movement). */
  hover?: boolean;
  className?: string;
  coreClassName?: string;
}) {
  return (
    <div className={`${styles.bezel} ${accent ? styles.bezelAccent : ''} ${hover ? styles.bezelHover : ''} ${className}`}>
      <div className={`${styles.bezelCore} ${coreClassName}`}>{children}</div>
    </div>
  );
}
