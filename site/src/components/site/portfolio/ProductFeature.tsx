import Link from 'next/link';
import { ArrowRightIcon, ArrowUpRightIcon, LockSimpleIcon } from '@phosphor-icons/react/ssr';
import { BreathingDot, Reveal, RevealMedia, SplitWords, Stagger, StaggerItem } from '@/components/site/motion';
import { Monogram } from './Monogram';
import styles from './portfolio.module.css';
import { hostOf, localShotSet, NEW_TAB_NOTE_ID, pad2, type Product } from './types';

const linkPropsOf = (url: string) =>
  url.startsWith('http') ? { target: '_blank', rel: 'noreferrer noopener', 'aria-describedby': NEW_TAB_NOTE_ID } : {};

/**
 * The browser frame, a double bezel: a hairline tray holding the screen plate,
 * radii concentric (tray radius minus the 6px gap). It opens with a clip
 * aperture while the screen settles from a slight zoom. Hover (mouse only)
 * lifts the tray 4px.
 *
 * The screenshot is pinned to the top of a 16:10 screen that matches its own
 * ratio, with no scroll parallax: any overscan would cut the captured nav bar
 * through the middle.
 *
 * Only for a capture we host (`screenshot`): the address bar and the LIVE
 * mark say "this is the running app", so a product without a capture gets the
 * plain <Plate> instead and never a drawn stand-in inside browser chrome.
 * `sizes` is the frame's drawn width; the default is the /portfolio feature row.
 */
export function Frame({
  product: p,
  screenshot,
  index,
  sizes = '(min-width: 1440px) 760px, (min-width: 1024px) 54vw, 100vw',
}: {
  product: Product;
  screenshot: string;
  index: number;
  sizes?: string;
}) {
  // A private app (no public URL) keeps naming its host on the bar.
  const host = p.host ?? (hostOf(p.url) || 'private app');
  // Stored uploads bring their own two sizes; the local captures have WebP twins.
  const srcSet = p.imageSrcSet ?? localShotSet(screenshot);

  return (
    <Reveal variant="clip">
      <div className={styles.tray}>
        <div className={styles.plate}>
          {/* chrome */}
          <div className="flex h-10 items-center gap-3 px-3.5 sm:h-11 sm:px-4">
            <span className="hidden gap-1.5 sm:flex" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
            </span>
            <span
              className="nx-mono flex min-w-0 max-w-[75%] items-center gap-1.5 rounded-full bg-bg-2 px-3 py-1 text-[0.6875rem] text-fg-3 sm:mx-auto sm:max-w-[60%]"
            >
              <LockSimpleIcon size={11} aria-hidden className="shrink-0" />
              <span className="truncate">{host}</span>
            </span>
            <span
              className="nx-mono ml-auto inline-flex shrink-0 items-center gap-2 text-[0.625rem] uppercase tracking-[0.14em] text-fg-2 sm:ml-0"
            >
              {p.live ? <BreathingDot /> : <span className="h-2 w-2 rounded-full bg-fg-3" aria-hidden />}
              {p.live ? 'LIVE' : p.host ? 'PRIVATE' : 'SOON'}
            </span>
          </div>
          {/* screen: inset 6px into the plate, radius concentric with it */}
          <div className={`relative mx-1.5 mb-1.5 aspect-[16/10] overflow-hidden bg-surface-2 ring-1 ring-line ${styles.screen}`}>
            <RevealMedia className="absolute inset-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size screenshot inside the reveal frame, kept plain on purpose */}
              <img
                src={screenshot}
                srcSet={srcSet ?? undefined}
                sizes={srcSet ? sizes : undefined}
                alt={p.imageAlt ?? `${p.name} screenshot`}
                width={1600}
                height={1000}
                loading={index === 0 ? 'eager' : 'lazy'}
                decoding="async"
                className={`absolute inset-0 h-full w-full object-cover object-top ${styles.shot}`}
              />
            </RevealMedia>
          </div>
        </div>
        {/* The whole frame opens the product, as the hover lift promises. Mouse/touch
            only: keyboard and screen-reader users get the domain link in the story. */}
        {p.url && (
          <a
            href={p.url}
            {...linkPropsOf(p.url)}
            tabIndex={-1}
            aria-hidden
            className="absolute inset-0 z-10 touch-manipulation select-none rounded-[inherit] [-webkit-tap-highlight-color:transparent]"
          />
        )}
      </div>
    </Reveal>
  );
}

/**
 * The stand-in for a product with no capture we host: the same monogram plate
 * the client cards use for a site without a shot (initials, address in mono),
 * with no browser chrome and no status mark, so it never reads as a screenshot
 * that failed to load. Not a link: the address under the story is.
 */
function Plate({ product: p }: { product: Product }) {
  return (
    <Reveal>
      <div className="relative isolate aspect-[5/2] overflow-hidden rounded-[var(--nx-radius)] border border-line bg-surface-2 sm:aspect-video">
        <Monogram site={{ name: p.name, url: p.host ?? hostOf(p.url), category: p.category }} />
      </div>
    </Reveal>
  );
}

/* The eyebrow's mark, in the site's one accent for every product: a row of each product's own
   colour read as five accents, and the green ones as the "live" status dot. */
function Swatch() {
  return <span className="h-2 w-2 shrink-0 rounded-[3px] bg-accent" aria-hidden />;
}

function Stack({ stack, className }: { stack: string[]; className: string }) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {stack.map((tech) => (
        <li key={tech} className="nx-tag">
          {tech}
        </li>
      ))}
    </ul>
  );
}

/** The product's way out: its live address, or a plain note when the app is private; then its case study, if any. */
function Links({ product: p }: { product: Product }) {
  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-1">
      {p.url ? (
        <HostLink url={p.url} />
      ) : (
        <p className="nx-mono inline-flex min-h-11 items-center gap-2 text-[0.8125rem] tracking-[0.04em] text-fg-3">
          <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
          Private app. Demo on request.
        </p>
      )}
      {p.detailHref && (
        <Link
          href={p.detailHref}
          className="nx-link group/link min-h-11 touch-manipulation text-[0.875rem] font-medium [-webkit-tap-highlight-color:transparent]"
        >
          <span>Case study</span>
          <ArrowRightIcon
            size={14}
            aria-hidden
            className="shrink-0 transition-[translate] duration-200 ease-out motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/link:translate-x-0.5"
          />
        </Link>
      )}
    </div>
  );
}

function HostLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      {...linkPropsOf(url)}
      className="nx-link nx-mono group/link min-h-11 touch-manipulation text-[0.8125rem] tracking-[0.04em] [-webkit-tap-highlight-color:transparent]"
    >
      <span>{hostOf(url)}</span>
      <ArrowUpRightIcon
        size={14}
        aria-hidden
        className="shrink-0 transition-[translate] duration-200 ease-out motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/link:translate-x-0.5 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/link:-translate-y-0.5"
      />
    </a>
  );
}

/**
 * One in-house product. Two scales, so the section changes pace:
 *
 * - default: a large alternating feature row (the editorial split) for the
 *   products with a real in-app capture. Frame on one side, story on the
 *   other; odd rows flip sides on desktop. The story follows in a 60ms
 *   stagger with the name rising word by word.
 * - without `screenshot`: a ledger row for the products that have no capture
 *   we host. The monogram plate, then the name and the story side by side
 *   under one hairline, about a third of the height of a feature row.
 *
 * The Client Apps section on /portfolio uses the same rows, with its own
 * `idPrefix` so the two lists never share a heading id.
 */
export function ProductFeature({
  product: p,
  screenshot,
  index,
  total,
  idPrefix = 'product',
}: {
  product: Product;
  /** The capture we host for this product (see `hostedShot`), or null. */
  screenshot: string | null;
  index: number;
  total: number;
  idPrefix?: string;
}) {
  const titleId = `${idPrefix}-${index + 1}-title`;

  if (!screenshot) {
    return (
      <article aria-labelledby={titleId} className="border-t border-line py-10 last:pb-0 md:py-12">
        <div className="grid items-center gap-x-8 gap-y-7 sm:grid-cols-12 xl:gap-x-12">
          <div className="min-w-0 sm:col-span-5 lg:col-span-4">
            <Plate product={p} />
          </div>

          <Stagger className="grid min-w-0 gap-x-8 gap-y-5 sm:col-span-7 lg:col-span-8 lg:grid-cols-2 lg:items-start xl:gap-x-12">
            <StaggerItem className="min-w-0">
              <p className="nx-mono text-[0.75rem] tabular-nums text-fg-3" aria-hidden>
                <span className="text-fg-2">{pad2(index + 1)}</span> / {pad2(total)}
              </p>
              <p className="nx-eyebrow mt-4 text-accent-text">
                <Swatch />
                <span>{p.category}</span>
              </p>
              <h3 id={titleId} className="nx-h3 mt-3 text-[clamp(1.5rem,2.2vw,2rem)]">
                {p.name}
              </h3>
            </StaggerItem>

            <StaggerItem className="min-w-0">
              <p className="max-w-[34rem] text-pretty text-[1rem] leading-[1.6] text-fg-2">{p.blurb}</p>
              <Stack stack={p.stack} className="mt-5" />
              <div className="mt-3">
                <Links product={p} />
              </div>
            </StaggerItem>
          </Stagger>
        </div>
      </article>
    );
  }

  const flip = index % 2 === 1;

  return (
    <article aria-labelledby={titleId} className="border-t border-line py-[clamp(4rem,9vw,8.5rem)] first:border-t-0 first:pt-0 last:pb-0">
      <div className="grid items-center gap-x-16 gap-y-10 lg:grid-cols-12">
        <div className={`min-w-0 lg:col-span-7 ${flip ? 'lg:order-2 lg:col-start-6' : ''}`}>
          <Frame product={p} screenshot={screenshot} index={index} />
        </div>

        {/* ── Story ── */}
        <Stagger className={`min-w-0 lg:col-span-5 ${flip ? 'lg:order-1 lg:col-start-1' : 'lg:col-start-8 lg:col-end-13 lg:pl-2'}`}>
          <StaggerItem className="flex items-end gap-4" aria-hidden>
            <span className="nx-numeral nx-numeral-outline block text-[clamp(4.5rem,8vw,7.75rem)] leading-[0.78] tracking-[-0.06em] tabular-nums">
              {pad2(index + 1)}
            </span>
            <span className="nx-mono pb-[0.35rem] text-[0.75rem] tabular-nums text-fg-3">/ {pad2(total)}</span>
          </StaggerItem>

          <StaggerItem as="p" className="nx-eyebrow mt-9 text-accent-text">
            <Swatch />
            <span>{p.category}</span>
          </StaggerItem>
          <SplitWords as="h3" id={titleId} className="nx-h2 mt-4 text-[clamp(2.15rem,3.8vw,3.5rem)]">
            {p.name}
          </SplitWords>

          <StaggerItem>
            <p className="nx-lede mt-6 max-w-[34rem] text-pretty">{p.blurb}</p>
            <Stack stack={p.stack} className="mt-8" />
            <div className="mt-6 lg:mt-9 lg:border-t lg:border-line lg:pt-5">
              <Links product={p} />
            </div>
          </StaggerItem>
        </Stagger>
      </div>
    </article>
  );
}
