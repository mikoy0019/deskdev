import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
// The /ssr entry has no React context, so this file stays usable from server
// pages and client components alike.
import { ArrowRightIcon } from '@phosphor-icons/react/ssr';
import { twMerge } from 'tailwind-merge';
import { Magnetic } from './motion/Magnetic';

type Variant = 'primary' | 'secondary' | 'ghost' | 'invert' | 'white' | 'outline-white';
type Size = 'sm' | 'md' | 'lg';

interface Common {
  variant?: Variant;
  size?: Size;
  /** Trailing arrow in its own circular island, flush with the right edge. */
  arrow?: boolean;
  /** A different trailing icon for the island (e.g. a retry glyph). Implies `arrow`. */
  icon?: ReactNode;
  /** Magnetic pull toward a mouse pointer (motion kit; never touch, pen or reduced motion). */
  magnetic?: boolean;
  className?: string;
  children: ReactNode;
}

type AsLink = Common & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'children'>;
type AsButton = Common & { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

/**
 * Press and touch behaviour layered over nx.css's `.nx-btn` (utilities win
 * over the components layer):
 * - press (Emil): the independent `scale` property to 0.97 in 140ms on the
 *   strong ease-out, replacing nx-btn's 250ms translate+scale; colours keep `ease`;
 * - no double-tap delay, no tap flash, no long-press text selection;
 * - reduced motion: no size change on press (the colour change still answers).
 */
const PRESS =
  'touch-manipulation select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [transition:background-color_200ms_ease,color_200ms_ease,box-shadow_200ms_ease,scale_var(--dur-press)_var(--ease-out)] active:[transform:none] active:scale-[0.97] motion-reduce:active:scale-100';

/**
 * Depth without a neon halo: the filled variants get a hairline top highlight
 * (light catching the edge) and a short shadow in the page's own blue-black,
 * instead of nx.css's coloured glow.
 */
const SURFACE: Partial<Record<Variant, string>> = {
  primary: 'shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(2_4_10/0.35),0_10px_24px_-14px_rgb(2_4_10/0.6)]',
  white: 'shadow-[inset_0_-1px_0_rgb(18_33_73/0.08),0_1px_2px_rgb(2_4_10/0.25),0_12px_28px_-14px_rgb(2_4_10/0.5)]',
};

/** Island geometry per size: right padding equals the gap around the circle, so it sits concentric with the pill. */
const ISLAND: Record<Size, { pad: string; circle: string; icon: number }> = {
  sm: { pad: 'pl-4 pr-[5px] gap-3', circle: 'size-[1.875rem]', icon: 14 },
  md: { pad: 'pl-5 pr-1.5 gap-3.5', circle: 'size-9', icon: 16 },
  lg: { pad: 'pl-7 pr-2 gap-5', circle: 'size-10', icon: 18 },
};

/** The island's tint follows the label colour, so it works on every variant. */
const ISLAND_TINT: Record<Variant, string> = {
  primary: 'bg-white/15',
  'outline-white': 'bg-white/15',
  white: 'bg-[#122149]/[0.08]',
  secondary: 'bg-fg/[0.07]',
  invert: 'bg-bg/15',
  ghost: 'bg-fg/[0.07]',
};

/** Hover nudge for the icon: mouse/trackpad only, never under reduced motion. */
const NUDGE =
  '[transition:translate_200ms_var(--ease-out)] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover/btn:translate-x-0.5';

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return ['nx-btn', `nx-btn-${variant}`, size !== 'md' ? `nx-btn-${size}` : '', PRESS, SURFACE[variant] ?? '', extra]
    .filter(Boolean)
    .join(' ');
}

/** Bare trailing arrow (decorative). Prefer `<Button arrow>`, which nests it in an island. */
export function Arrow({ className = '', size = 16 }: { className?: string; size?: number }) {
  return <ArrowRightIcon size={size} aria-hidden className={`${NUDGE} ${className}`} />;
}

/** The circular icon island that closes an arrow button. */
export function ButtonIsland({ variant = 'primary', size = 'md', icon }: { variant?: Variant; size?: Size; icon?: ReactNode }) {
  const geo = ISLAND[size];
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full ${geo.circle} ${ISLAND_TINT[variant]}`}>
      {icon ?? <Arrow size={geo.icon} />}
    </span>
  );
}

/** One button for links and actions. Internal hrefs use next/link; external,
 *  mailto: and tel: hrefs render a plain anchor. */
export function Button(props: AsLink | AsButton) {
  const { variant = 'primary', size = 'md', arrow = false, icon, magnetic = false, className = '', children, ...rest } = props;
  const island = arrow || icon !== undefined;
  // A ghost button has no padding of its own; its island just trails the label.
  const shape = island ? (variant === 'ghost' ? 'group/btn gap-3' : `group/btn ${ISLAND[size].pad}`) : '';
  // Magnetic wraps the button: the caller's layout classes (margins, width,
  // visibility such as "hidden lg:inline-flex") go on an outer slot span, merged
  // so they win over its default display; the magnet and the button fill it.
  const cls = buttonClass(variant, size, [shape, magnetic ? 'w-full' : className].filter(Boolean).join(' '));
  const content = (
    <>
      <span>{children}</span>
      {island && <ButtonIsland variant={variant} size={size} icon={icon} />}
    </>
  );

  let el: ReactNode;
  if (typeof (rest as AsLink).href === 'string') {
    const { href, ...anchor } = rest as Omit<AsLink, keyof Common>;
    const external = /^(https?:|mailto:|tel:)/.test(href);
    el = external ? (
      <a href={href} className={cls} {...anchor}>
        {content}
      </a>
    ) : (
      // No viewport prefetch here, in the Navbar or in the Footer: on a phone the
      // home page's links fetched six other pages while it was still loading.
      <Link prefetch={false} href={href} className={cls} {...anchor}>
        {content}
      </Link>
    );
  } else {
    const { type = 'button', ...button } = rest as Omit<AsButton, keyof Common>;
    el = (
      <button type={type} className={cls} {...button}>
        {content}
      </button>
    );
  }

  if (!magnetic) return el;
  return (
    <span className={twMerge('inline-flex', className)}>
      <Magnetic className="w-full">{el}</Magnetic>
    </span>
  );
}
