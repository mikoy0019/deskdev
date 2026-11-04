import type { ReactNode } from 'react';
import { faqJsonLd, nodeText } from '@/lib/seo';
import { JsonLd } from './JsonLd';
import { Stagger, StaggerItem } from './motion/Stagger';

export interface FaqItem {
  question: string;
  answer: ReactNode;
}

/**
 * Overrides for nx.css's `.nx-faq-*` rules (utilities beat the components layer):
 * - the answer opens like Emil's accordion recipe: height in 200ms on the strong
 *   ease-out (nx.css had 500ms), where ::details-content is supported;
 * - the plus folds into a minus in 200ms on the ease-in-out (an on-screen morph);
 *   the disc's fill changes colour with `ease`;
 * - touch screens: a tapped question doesn't keep its hover colour (sticky hover),
 *   no tap flash, no long-press selection of the question.
 */
const ITEM =
  'nx-faq-item group/faq [&::details-content]:[transition-duration:var(--dur-dropdown)] [&::details-content]:[transition-timing-function:var(--ease-out)] [@media(hover:none)]:[&>summary:hover]:text-fg';
const SUMMARY =
  'min-h-11 touch-manipulation select-none [-webkit-tap-highlight-color:transparent] focus-visible:rounded-md';
const ICON =
  'nx-faq-icon text-fg-2 group-open/faq:text-accent-fg [transition:background-color_200ms_ease,border-color_200ms_ease,color_200ms_ease] [&::after]:[transition:rotate_var(--dur-dropdown)_var(--ease-in-out)]';

/**
 * Accessible accordion on native <details>. A shared `name` makes it
 * exclusive (one open at a time) where supported; height animates via
 * ::details-content where supported, and simply snaps elsewhere.
 * Answers stay in the DOM when closed (find-in-page and SEO still see them).
 *
 * Motion (kit): the questions enter as a group when the list scrolls into
 * view, 60ms apart, once. Opening a question is a click, so it stays fast.
 *
 * Structured data: the same questions and answers, as printed, in a FAQPage
 * block (src/lib/seo.ts). One FAQ per page; pass `structuredData={false}` to a
 * second list on the same page.
 */
export function Faq({
  items,
  name,
  className = '',
  structuredData = true,
}: {
  items: FaqItem[];
  name: string;
  className?: string;
  structuredData?: boolean;
}) {
  return (
    <Stagger className={`nx-faq ${className}`}>
      {items.map((item, i) => (
        <StaggerItem key={i}>
          <details className={ITEM} name={name}>
            <summary className={SUMMARY}>
              <span>{item.question}</span>
              <span className={ICON} aria-hidden />
            </summary>
            <div className="nx-faq-answer nx-body">{item.answer}</div>
          </details>
        </StaggerItem>
      ))}
      {/* Last, and not rendered as a box: the list's layout and its first/last rules never see it. */}
      {structuredData && (
        <JsonLd data={faqJsonLd(items.map((item) => ({ question: item.question, answer: nodeText(item.answer) })))} />
      )}
    </Stagger>
  );
}
