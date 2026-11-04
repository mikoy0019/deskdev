import Link from 'next/link';
import { ArrowRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react/ssr';
import { ClientShot } from './ClientShot';
import { Monogram } from './Monogram';
import { isMshots, NEW_TAB_NOTE_ID, pad2, type ClientSite } from './types';

/**
 * One live client site: 16:9 screenshot of its hero (the capture's own ratio,
 * so nothing is cropped), category, name and domain.
 * The whole card opens the live site (stretched link on the name). Sites whose
 * auto-capture is known to show an error page get the monogram plate, and so
 * does any capture that fails to load (see ClientShot).
 * Below 640px it collapses to a compact list row (thumb left, text right).
 * `featured`: the lead card. It takes a full row at two columns and a 2x2
 * block from lg up, with the meta set larger. From lg an mShots capture is
 * asked for at 4:3 (see `leadShot`) and shown in a box about 3:2 (66% of the
 * card's own width, 66cqw): tall enough to use most of the height the second
 * row adds, short enough to end just under the captured page's first screen
 * instead of part-way into its next section. The box only ever drops the
 * capture's bottom edge, never its sides. A stored 16:9 capture keeps its
 * ratio. Either way the meta spreads over what height is left (category under
 * the image, name and domain on the block's bottom line), so the block has no
 * empty band.
 *
 * Feedback: a press gives the whole card a little (scale 0.98, 140ms); a
 * mouse hover firms the hairline, settles the capture in and shows the
 * open-in-new-tab chip, rising 4px (keyboard focus shows the chip too). On
 * touch the chip only fades, so a sticky tap-hover never leaves it shifted.
 *
 * A site with a case study gets a second link under the domain; it sits above
 * the stretched one. A site whose link is private opens its case study instead
 * (in this tab, so the chip is a plain arrow), or is not a link at all.
 */
const SIZES = '(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 38vw';
const SIZES_FEATURED = '(min-width: 1280px) 50vw, (min-width: 1024px) 66vw, (min-width: 640px) 100vw, 38vw';

export function ClientCard({
  site,
  src,
  srcSet,
  index,
  featured = false,
}: {
  site: ClientSite;
  src: string;
  /** Stored 640w and 1280w files, when the showcase has both. */
  srcSet?: string | null;
  index: number;
  featured?: boolean;
}) {
  const href = site.href === undefined ? `https://${site.url}` : site.href;
  // A private link with a case study: the whole card opens the case study, in this tab.
  const toCaseStudy = !href && Boolean(site.detailHref);
  // The lead image may be taller than 16:9 only when its capture is tall enough for it.
  const grow = featured && !site.noShot && isMshots(src);
  const stretched =
    "touch-manipulation [-webkit-tap-highlight-color:transparent] after:absolute after:inset-0 after:z-10 after:rounded-[var(--nx-radius)] after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-[var(--ring)]";

  return (
    <article
      className={`group relative flex items-center gap-4 border-b border-line py-4 transition-[scale] duration-[var(--dur-press)] ease-out has-[a:active]:scale-[0.98] sm:flex-col sm:items-stretch sm:gap-0 sm:border-0 sm:py-0 ${featured ? 'lg:h-full' : ''} ${grow ? '@container' : ''}`}
    >
      <div
        className={`relative isolate aspect-video w-[38%] shrink-0 overflow-hidden rounded-[0.75rem] border border-line bg-surface-2 transition-[border-color] duration-200 ease-[ease] group-hover:border-line-2 sm:w-auto sm:rounded-[var(--nx-radius)] ${featured ? 'lg:rounded-[var(--nx-radius-lg)]' : ''} ${grow ? 'lg:aspect-auto lg:min-h-0 lg:shrink lg:grow-0 lg:basis-[66cqw]' : ''}`}
      >
        {site.noShot || !src ? (
          <Monogram site={site} />
        ) : (
          <ClientShot site={site} src={src} srcSet={srcSet} sizes={featured ? SIZES_FEATURED : SIZES} />
        )}
        <span
          aria-hidden
          className={`absolute right-3 top-3 hidden h-9 w-9 place-items-center rounded-full bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] text-fg opacity-0 shadow-[var(--shadow-sm)] ring-1 ring-line [transition:opacity_200ms_ease,translate_250ms_var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:translate-y-1 ${href || toCaseStudy ? 'sm:grid' : ''}`}
        >
          {toCaseStudy ? <ArrowRightIcon size={14} /> : <ArrowUpRightIcon size={14} />}
        </span>
      </div>

      <div className={`min-w-0 flex-1 sm:mt-5 ${featured ? 'sm:flex-none lg:flex lg:flex-1 lg:flex-col lg:justify-between lg:gap-6' : 'sm:flex-none'}`}>
        <div className="flex items-start justify-between gap-3 sm:items-center">
          {/* phones: plain label that can wrap (a pill would have to truncate); sm+: pill */}
          <span className="nx-mono text-[0.6875rem] uppercase leading-snug tracking-[0.08em] text-fg-3 sm:hidden">{site.category}</span>
          <span className="nx-tag hidden min-w-0 max-w-full sm:inline-flex">
            <span className="truncate">{site.category}</span>
          </span>
          <span className="nx-mono shrink-0 text-[0.6875rem] leading-snug tabular-nums text-fg-3" aria-hidden>
            {pad2(index + 1)}
          </span>
        </div>
        <div className="min-w-0">
          <h3
            className={`nx-h4 mt-1.5 text-[1.0625rem] transition-colors duration-200 ease-[ease] group-hover:text-accent-text group-focus-within:text-accent-text sm:mt-3 sm:text-[1.125rem] ${featured ? 'lg:text-[clamp(1.75rem,2.6vw,2.5rem)] lg:leading-[1.05] lg:tracking-[-0.025em] lg:mt-0' : ''}`}
          >
            {href ? (
              <a href={href} target="_blank" rel="noreferrer noopener" aria-describedby={NEW_TAB_NOTE_ID} className={stretched}>
                {site.name}
              </a>
            ) : site.detailHref ? (
              <Link href={site.detailHref} className={stretched}>
                {site.name}
              </Link>
            ) : (
              site.name
            )}
          </h3>
          <p className={`nx-mono mt-1 text-[0.6875rem] text-fg-3 [overflow-wrap:anywhere] sm:mt-1.5 sm:truncate sm:text-[0.75rem] ${featured ? 'lg:mt-3 lg:text-[0.8125rem]' : ''}`}>
            {site.url}
          </p>
          {site.detailHref && href && (
            <Link
              href={site.detailHref}
              className="nx-link group/link relative z-20 mt-1 min-h-11 touch-manipulation text-[0.875rem] font-medium [-webkit-tap-highlight-color:transparent]"
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
      </div>
    </article>
  );
}
