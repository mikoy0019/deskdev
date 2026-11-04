import { pageMeta } from '@/lib/seo';
import Link from 'next/link';
import { ArrowRightIcon, PlusIcon } from '@phosphor-icons/react/ssr';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { SectionHeader } from '@/components/site/SectionHeader';
import { Accent, Beacon } from '@/components/site/Typography';
import { Marquee, Reveal } from '@/components/site/motion';
import { ArchiveIndex } from '@/components/site/portfolio/ArchiveIndex';
import { ArchiveStats } from '@/components/site/portfolio/ArchiveStats';
import { ProductFeature } from '@/components/site/portfolio/ProductFeature';
import { ClientCard } from '@/components/site/portfolio/ClientCard';
import styles from '@/components/site/portfolio/portfolio.module.css';
import { PortfolioCta } from '@/components/site/portfolio/PortfolioCta';
import { hostedShot, leadShot, NEW_TAB_NOTE_ID, pad2, type ClientSite, type Product } from '@/components/site/portfolio/types';
import { getShowcase, toClientCard, toProduct, type ShowcaseItem } from '@/lib/showcase';
import { CASE_STUDY_FIXTURES } from '@/components/site/portfolio/caseStudyFixture';

export const metadata = pageMeta({
  title: 'Portfolio',
  description:
    "A working archive of sites we've designed, built, and shipped — plus the in-house products that power them.",
  path: '/portfolio',
});

/* ═══════════════ DATA ═══════════════ */

// Everything on this page is the published showcase (DeskDev → Showcase),
// read through lib/showcase.ts: live from Supabase, or the committed fallback
// when it cannot answer. Products render a capture we host, else the monogram
// plate (a remote mShots capture of an app can come back as an error page).
// Client sites render their stored capture, else an mShots one.
//
// Re-render at most every five minutes, like the reader's fetch (tag
// 'showcase'): a publish in DeskDev shows here within that window, no deploy
// needed.
export const revalidate = 300;

// The studio's own claims (owner's call). Only the product count follows the
// data: it is a count of what is listed right below it. The hero eyebrow, the
// stat band and the Client Work title all read this one figure; the index and
// the expander count the cards listed on the page, which can be fewer.
const SITES_SHIPPED = { value: '80+', label: 'Live Sites Shipped' };

const productOf = (item: ShowcaseItem): Product => ({
  ...toProduct(item),
  imageSrcSet: item.imageSrcSet,
  imageAlt: item.imageAlt,
  host: item.host,
  detailHref: item.detailHref,
});

const clientOf = (item: ShowcaseItem): { site: ClientSite; src: string; srcSet: string | null } => {
  const card = toClientCard(item);
  return {
    site: { ...card.site, href: item.url, imageAlt: item.imageAlt, detailHref: item.detailHref },
    src: card.src,
    srcSet: item.imageSrcSet,
  };
};

// The archive opens on the first LEAD sites; the rest sit in a native
// <details> below (every link stays in the HTML). 9 = the 2x2 lead (4 cells)
// plus 8 cards = 12 cells, which fills the 3- and the 4-column grid exactly;
// at two columns the lead takes a full row, so 8 cards close that grid too.
const LEAD = 9;
// The rest grid would end on a part-filled row. A closing plate (not a card)
// takes the cells that are left at each breakpoint, or hides when the row is
// already full. No capture is ever stretched or cropped to fill a hole.
const leftover = (count: number, cols: number) => (cols - (count % cols)) % cols;
const SM_PLATE = ['sm:hidden', 'sm:flex sm:col-span-1'];
const LG_PLATE = ['lg:hidden', 'lg:flex lg:col-span-1', 'lg:flex lg:col-span-2'];
const XL_PLATE = ['xl:hidden', 'xl:flex xl:col-span-1', 'xl:flex xl:col-span-2', 'xl:flex xl:col-span-3'];
const plateSpanOf = (rest: number) => `${SM_PLATE[leftover(rest, 2)]} ${LG_PLATE[leftover(rest, 3)]} ${XL_PLATE[leftover(rest, 4)]}`;

const GRID = 'grid sm:grid-cols-2 sm:gap-x-5 sm:gap-y-12 lg:grid-cols-3 xl:grid-cols-4 xl:gap-x-6';

export default async function Portfolio() {
  const [productItems, appItems, siteItems] = await Promise.all([
    getShowcase({ kind: 'product' }),
    getShowcase({ kind: 'web_app' }),
    getShowcase({ kind: 'website' }),
  ]);
  // Empty outside the test build (see caseStudyFixture.ts).
  const fixtures = (kind: ShowcaseItem['kind']) => CASE_STUDY_FIXTURES.filter((i) => i.kind === kind);
  const products = [...productItems, ...fixtures('product')].map(productOf);
  const apps = [...appItems, ...fixtures('web_app')].map(productOf);
  const clients = [...siteItems, ...fixtures('website')].map(clientOf);
  const clientSites = clients.map((c) => c.site);
  const leadSites = clients.slice(0, LEAD);
  const restSites = clients.slice(LEAD);
  const plateSpan = plateSpanOf(restSites.length);

  const stats = [
    SITES_SHIPPED,
    { value: String(products.length), label: 'In-House Products' },
    { value: '14 days', label: 'Avg. Launch Time' },
    { value: '96%', label: 'Client Satisfaction' },
  ];

  // Every industry in the archive, once, in order of first appearance.
  const industries = Array.from(new Set(clientSites.map((s) => s.category).filter(Boolean)));

  // Section numbers follow what is on the page: client apps only appear once one is published.
  const appsIndex = '02';
  const workIndex = apps.length ? '03' : '02';

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        {/* Accessible description for every external link on the page. */}
        <span id={NEW_TAB_NOTE_ID} hidden>
          Opens in a new tab
        </span>

        {/* ═══════════════ HERO ═══════════════ */}
        <PageHero
          eyebrow={<Beacon>Field Archive / {SITES_SHIPPED.value} Live Sites</Beacon>}
          title={
            <>
              Real businesses. <Accent>Real sites.</Accent> Live now.
            </>
          }
          lede={
            <>
              A working archive of sites we&apos;ve designed, built, and shipped&nbsp;— plus the in-house products that power
              them. Click any card to visit the real thing.
            </>
          }
          aside={
            <ArchiveIndex
              label="Field Archive"
              items={[
                { id: '01', anchor: 'in-house-products', title: 'In-House Products', count: products.length },
                { id: appsIndex, anchor: 'client-apps', title: 'Client Apps', count: apps.length },
                { id: workIndex, anchor: 'client-work', title: 'Client Work', count: clientSites.length },
              ].filter((section) => section.count > 0)}
            />
          }
        />

        {/* ═══════════════ STATS ═══════════════ */}
        <section className="nx-band border-y border-line">
          <div className="nx-wrap">
            <ArchiveStats stats={stats} />
          </div>
        </section>

        {/* ═══════════════ IN-HOUSE PRODUCTS ═══════════════ */}
        {products.length > 0 && (
        <section id="in-house-products" className="nx-section" aria-labelledby="in-house-products-title">
          <div className="nx-wrap">
            <SectionHeader
              id="in-house-products-title"
              index="01"
              eyebrow="In-House Products"
              title={
                <>
                  Software we built <Accent>for ourselves.</Accent>
                </>
              }
              lede="The same SaaS tools we use to run NixGen&nbsp;— dashboards, CRM, and automation we design, ship, and rely on every day."
              titleClassName="max-w-[14ch]"
            />

            <div className="mt-16 md:mt-24">
              {products.map((p, i) => (
                // A hosted capture gets the full feature row; without one, the compact ledger row.
                <ProductFeature key={p.name} product={p} screenshot={hostedShot(p)} index={i} total={products.length} />
              ))}
            </div>
          </div>
        </section>
        )}

        {/* ═══════════════ CLIENT APPS (once DeskDev publishes one) ═══════════════ */}
        {apps.length > 0 && (
          <section id="client-apps" className="nx-section border-t border-line" aria-labelledby="client-apps-title">
            <div className="nx-wrap">
              <SectionHeader
                id="client-apps-title"
                index={appsIndex}
                eyebrow="Client Apps"
                title={
                  <>
                    Platforms we built <Accent>for clients.</Accent>
                  </>
                }
                lede="Custom web apps, portals, and dashboards running real businesses. Some sit behind a login; ask us for a walkthrough."
                titleClassName="max-w-[14ch]"
              />

              <div className="mt-16 md:mt-24">
                {apps.map((p, i) => (
                  // Same two scales as the products: a hosted capture gets the feature row, else the ledger row.
                  <ProductFeature key={p.name} product={p} screenshot={hostedShot(p)} index={i} total={apps.length} idPrefix="client-app" />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════ CLIENT WORK ═══════════════ */}
        {clientSites.length > 0 && (
        <section id="client-work" className="nx-section nx-band border-y border-line" aria-labelledby="client-work-title">
          <div className="nx-wrap">
            <SectionHeader
              id="client-work-title"
              index={workIndex}
              eyebrow="Client Work"
              title={
                <>
                  {SITES_SHIPPED.value} sites, <Accent>launched &amp; live.</Accent>
                </>
              }
              lede="Service businesses across insulation, plumbing, concrete, travel, real estate, wellness, and more. Click any card to open the live site."
              titleClassName="max-w-[14ch]"
            />
          </div>

          <div className="mt-14 border-y border-line py-5 md:mt-20">
            <Marquee
              items={industries.map((c) => (
                // Reduced motion turns the band into a static, wrapped list: set
                // smaller there so 44 industries read as an index, not a wall.
                <span
                  key={c}
                  className="font-heading text-[clamp(1.25rem,2vw,1.75rem)] font-medium tracking-[-0.02em] text-fg-2 motion-reduce:text-[1.0625rem] motion-reduce:tracking-[-0.01em]"
                >
                  {c}
                </span>
              ))}
              separator={<span className="h-1.5 w-1.5 rotate-45 bg-accent" />}
              duration={70}
              gap="2rem"
              label="Client Work"
            />
          </div>

          <div className="nx-wrap mt-14 md:mt-20">
            {/* The first site leads: a full row at two columns, a 2x2 block from lg up. */}
            <div className={`${GRID} border-t border-line sm:border-t-0`}>
              {leadSites.map(({ site, src, srcSet }, i) => (
                <Reveal key={site.url || site.name} delay={(i % 4) * 0.06} className={i === 0 ? 'sm:col-span-2 lg:row-span-2' : undefined}>
                  <ClientCard site={site} src={i === 0 ? leadShot(src) : src} srcSet={srcSet} index={i} featured={i === 0} />
                </Reveal>
              ))}
            </div>

            {restSites.length > 0 && (
              <details className={`${styles.more} mt-10 sm:mt-14`}>
                <summary className="group/more flex min-h-[4.5rem] cursor-pointer touch-manipulation select-none items-center gap-5 border-y border-line py-4 text-fg-2 transition-colors duration-200 ease-[ease] [-webkit-tap-highlight-color:transparent] hover:text-fg focus-visible:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)] active:text-fg">
                  <span className="flex-1 font-heading text-[1.125rem] font-medium tracking-[-0.012em] sm:text-[1.25rem]">
                    All {clientSites.length} sites
                  </span>
                  <span className="nx-mono text-xs tabular-nums text-fg-3" aria-hidden>
                    {pad2(LEAD + 1)}–{pad2(clientSites.length)}
                  </span>
                  <PlusIcon size={18} aria-hidden className={`shrink-0 text-fg-3 group-hover/more:text-accent-text ${styles.moreIcon}`} />
                </summary>

                <div className={`${GRID} sm:mt-12`}>
                  {restSites.map(({ site, src, srcSet }, i) => (
                    <Reveal key={site.url || site.name} delay={(i % 4) * 0.06}>
                      <ClientCard site={site} src={src} srcSet={srcSet} index={LEAD + i} />
                    </Reveal>
                  ))}

                  {/* Closing plate: the archive count and the way in. Existing copy only. */}
                  <Reveal className={`hidden ${plateSpan}`}>
                    <div className="flex w-full flex-col justify-between gap-8 rounded-[var(--nx-radius)] border border-dashed border-line-2 p-6">
                      <div>
                        <span className="nx-numeral nx-numeral-outline block text-[clamp(3rem,5vw,4.25rem)] leading-[0.9] tabular-nums">
                          {stats[0].value}
                        </span>
                        <span className="nx-eyebrow mt-4">{stats[0].label}</span>
                      </div>
                      <Link
                        href="/contact"
                        className="nx-link group/link min-h-11 touch-manipulation self-start font-heading text-[1rem] font-medium [-webkit-tap-highlight-color:transparent]"
                      >
                        <span>Start a Project</span>
                        <ArrowRightIcon
                          size={15}
                          aria-hidden
                          className="shrink-0 transition-[translate] duration-200 ease-out motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/link:translate-x-0.5"
                        />
                      </Link>
                    </div>
                  </Reveal>
                </div>
              </details>
            )}
          </div>
        </section>
        )}

        {/* ═══════════════ CTA ═══════════════ */}
        <PortfolioCta />
      </main>

      <Footer />
    </div>
  );
}
