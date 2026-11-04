import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, CaretDownIcon, CheckIcon } from '@phosphor-icons/react/ssr';
import { LegalToc, type TocItem } from './LegalToc';

export interface LegalSection {
  /** Anchor id: stable, so other pages and emails can deep-link (/privacy#google). */
  id: string;
  title: string;
  /** Short label for the table of contents when the title is long. */
  short?: string;
  content: ReactNode;
}

/**
 * Body copy for a legal section. Descendant rules instead of a class per tag,
 * so section content stays plain <p>/<ul>/<code>/<strong>:
 * - paragraphs and lists keep a 36rem measure (about 72 characters a line in
 *   Geist) at 1.75 leading, since this is read start to finish; the fact rows
 *   use the whole column, like the summary and the rules;
 * - bullets are short accent dashes, not discs (they line up with the index);
 * - inline code is for literal names (storage keys, scopes) only.
 */
const PROSE = [
  'text-[1.02rem] leading-[1.75] text-fg-2 [&>p]:max-w-[36rem] [&>ul]:max-w-[36rem]',
  '[&_p]:[text-wrap:pretty] [&>*+*]:mt-5',
  '[&_strong]:font-semibold [&_strong]:text-fg',
  '[&_ul]:flex [&_ul]:flex-col [&_ul]:gap-3',
  '[&_ul>li]:relative [&_ul>li]:pl-6',
  "[&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:top-[0.85em] [&_ul>li]:before:h-px [&_ul>li]:before:w-3 [&_ul>li]:before:bg-accent-text [&_ul>li]:before:content-['']",
  '[&_code]:rounded-[0.3rem] [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.86em] [&_code]:text-fg [&_code]:[overflow-wrap:anywhere]',
].join(' ');

/** Sub-heading inside a section. */
export function Sub({ children }: { children: ReactNode }) {
  return <h3 className="nx-h4 !mt-10 first:!mt-0">{children}</h3>;
}

/** Inline link in legal copy: underline that fills on hover (nx-link), external links open in place. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:\/\//.test(href);
  const className = 'nx-link font-medium text-fg [overflow-wrap:anywhere]';
  if (external || href.startsWith('mailto:')) {
    return (
      <a href={href} className={className} {...(external ? { rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export interface LegalRow {
  term: ReactNode;
  /** Mono tag beside the term: a duration, a role. */
  meta?: ReactNode;
  detail: ReactNode;
}

/**
 * Two-column facts (processors, retention). Hairline rows instead of a table
 * or cards: it reads as one list and collapses to stacked pairs on a phone
 * without horizontal scrolling.
 */
export function LegalRows({ rows, label }: { rows: LegalRow[]; label: string }) {
  return (
    <dl aria-label={label} className="!mt-8 border-b border-line">
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 border-t border-line py-5 sm:grid-cols-12 sm:gap-6">
          <dt className="flex flex-col items-start gap-2 sm:col-span-5">
            <span className="font-medium leading-snug text-fg">{row.term}</span>
            {row.meta && (
              <span className="rounded-full border border-line-2 px-2.5 py-0.5 font-mono text-[0.72rem] uppercase tracking-[0.08em] text-fg-2">
                {row.meta}
              </span>
            )}
          </dt>
          <dd className="text-[0.97rem] leading-[1.7] sm:col-span-7">{row.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "In short": the few lines most readers came for, before the full text. */
export function LegalSummary({ title = 'In short', points }: { title?: string; points: ReactNode[] }) {
  return (
    <div className="nx-panel p-6 sm:p-8">
      <p className="nx-eyebrow mb-5">{title}</p>
      <ul className="grid gap-4 sm:grid-cols-2 sm:gap-x-8">
        {points.map((point, i) => (
          <li key={i} className="flex gap-3 text-[0.97rem] leading-relaxed text-fg-2">
            <span className="mt-[0.2rem] grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text" aria-hidden>
              <CheckIcon size={12} weight="bold" />
            </span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface MetaRow {
  label: string;
  value: ReactNode;
}

/**
 * Hero aside: when the page was updated, who it is from, where to write.
 * A link here stands alone (it is not inline in a sentence), so on touch
 * layouts it gets a 44px target; the negative margin keeps the row's rhythm.
 */
export function LegalMeta({ rows }: { rows: MetaRow[] }) {
  return (
    <dl className="flex flex-col border-t border-line">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1 border-b border-line py-4">
          <dt className="nx-eyebrow">{row.label}</dt>
          <dd className="text-[0.97rem] leading-snug text-fg max-lg:[&_a]:-my-2.5 max-lg:[&_a]:min-h-11">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The body of a legal page: a sticky contents rail beside numbered sections on
 * large screens; on phones the contents fold into a disclosure above the text.
 *
 * Sections don't animate in. A policy is read top to bottom by someone looking
 * for one answer; entrances would only slow them down (the hero keeps the
 * site's load stagger, so the page still opens like its siblings).
 */
export function LegalDocument({
  sections,
  intro,
  aside,
}: {
  sections: LegalSection[];
  /** Above the first section (e.g. <LegalSummary>). */
  intro?: ReactNode;
  /** Under the last section (cross-links). */
  aside?: ReactNode;
}) {
  const toc: TocItem[] = sections.map((s, i) => ({
    id: s.id,
    index: String(i + 1).padStart(2, '0'),
    title: s.short ?? s.title,
  }));

  return (
    <section className="nx-section-tight !pt-0 pb-[var(--nx-section)]">
      <div className="nx-wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4 xl:col-span-3">
          {/* Phone and tablet: contents collapse into one row above the text. */}
          <details className="group/toc rounded-[var(--nx-radius)] border border-line bg-bg-2 lg:hidden">
            <summary className="flex min-h-12 cursor-pointer touch-manipulation list-none items-center justify-between gap-4 px-5 text-[0.95rem] font-medium text-fg select-none [-webkit-tap-highlight-color:transparent] [&::-webkit-details-marker]:hidden">
              On this page
              <CaretDownIcon
                size={16}
                aria-hidden
                className="text-fg-3 [transition:rotate_200ms_var(--ease-out)] group-open/toc:rotate-180"
              />
            </summary>
            <ol className="flex flex-col border-t border-line px-2 py-2">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="flex min-h-11 items-baseline gap-3 rounded-md px-3 py-2.5 text-[0.95rem] text-fg-2 active:bg-surface-2"
                  >
                    <span className="font-mono text-[0.75rem] tabular-nums text-fg-3" aria-hidden>
                      {item.index}
                    </span>
                    {item.title}
                  </a>
                </li>
              ))}
            </ol>
          </details>

          <div className="hidden lg:sticky lg:top-[calc(var(--nx-nav-h)+2.5rem)] lg:block">
            <LegalToc items={toc} />
          </div>
        </div>

        {/* The column runs to the grid edge (the summary, the rules and the closing links use all of it); only the prose is held to a reading measure. */}
        <div className="min-w-0 lg:col-span-8 xl:col-span-8 xl:col-start-5">
          <div>
            {intro && <div className="mb-14">{intro}</div>}

            {sections.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="border-t border-line pb-14 pt-10 first-of-type:border-t-0 first-of-type:pt-0"
              >
                <div className="mb-6 flex items-baseline gap-4">
                  <span className="font-mono text-[0.8rem] tabular-nums text-accent-text" aria-hidden>
                    {toc[i].index}
                  </span>
                  <h2 id={`${section.id}-title`} className="nx-h3">
                    {section.title}
                  </h2>
                </div>
                <div className={PROSE}>{section.content}</div>
              </section>
            ))}

            {aside}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Closing row: where to go next (the other legal page, contact). */
export function LegalNext({ links }: { links: { label: string; hint: string; href: string }[] }) {
  return (
    <nav aria-label="Related" className="grid gap-px overflow-hidden rounded-[var(--nx-radius-lg)] border border-line bg-line sm:grid-cols-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="group flex min-h-28 flex-col justify-between gap-6 bg-bg p-6 [transition:background-color_200ms_ease] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-bg-2"
        >
          <span className="nx-eyebrow">{link.hint}</span>
          <span className="flex items-center justify-between gap-4 font-heading text-[1.25rem] tracking-[-0.02em] text-fg">
            {link.label}
            <ArrowUpRightIcon
              size={18}
              aria-hidden
              className="shrink-0 text-fg-3 [transition:translate_200ms_var(--ease-out),color_200ms_ease] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover:translate-x-0.5 [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-accent-text"
            />
          </span>
        </Link>
      ))}
    </nav>
  );
}
