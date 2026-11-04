import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { CheckCircleIcon, CheckIcon, ClockIcon, LightningIcon, StackIcon } from '@phosphor-icons/react/ssr';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/site/Button';
import { Accent, Eyebrow, Tag } from '@/components/site/Typography';
import { SectionHeader } from '@/components/site/SectionHeader';
import { Faq } from '@/components/site/Faq';
import { CtaBand } from '@/components/site/CtaBand';
import {
  BreathingDot,
  Magnetic,
  Marquee,
  Reveal,
  RevealMedia,
  Stagger,
  StaggerItem,
} from '@/components/site/motion';
import { HeroStrip, HeroWall, ScrollCue } from '@/components/site/home/HeroWall';
import { VslPlayer } from '@/components/vsl/VslPlayer';
import { VSL_DURATION } from '@/components/vsl/chapters';
import { UseCaseTabs, type UseCase } from '@/components/site/home/UseCaseTabs';
import { WhyBento } from '@/components/site/home/WhyBento';
import { Bezel } from '@/components/site/home/Bezel';
import { ShotImage } from '@/components/site/home/ShotImage';
import { ArchiveStats } from '@/components/site/portfolio/ArchiveStats';
import { getShowcase, toHomeCard } from '@/lib/showcase';
import { pageMeta } from '@/lib/seo';
import styles from '@/components/site/home/home.module.css';

/* ═══════════════ SEO ═══════════════ */

// The home page keeps the brand-first title as an absolute title (the
// "%s | NixGen Solutions" template is for inner pages).
export const metadata = pageMeta({
  title: { absolute: 'NixGen Solutions — AI-Powered Digital Systems for Service Businesses' },
  description:
    "We design premium websites and wire in the automation, branding, and SEO behind them — so service businesses book more calls, follow up automatically, and see exactly what's driving revenue.",
  path: '/',
});

/* ═══════════════ DATA ═══════════════ */

const services = [
  {
    id: '01',
    title: 'Conversion Websites',
    body: 'Editorial, kinetic, cinematic. Each site is a launch\u00a0— not a template. Engineered to book calls and close leads. Built on Next.js with 3D motion, A/B testing, and conversion-first architecture.',
    signals: ['Brand Design', 'Next.js Engineering', '3D / WebGL', 'A/B Systems', 'SEO Architecture'],
  },
  {
    id: '02',
    title: 'Automation Systems',
    body: 'End-to-end automation from lead capture to close. CRM integration, AI-powered outreach, scheduled agents, and Slack/email ops. Zero manual follow-up\u00a0— your pipeline runs itself.',
    signals: ['CRM Integration', 'AI Pipelines', 'Slack / Email Ops', 'Scheduled Agents', 'n8n Workflows'],
  },
  {
    id: '03',
    title: 'Revenue Dashboards',
    body: 'Custom KPI command centers built on Supabase. Campaign analytics, conversion tracking, forecasting, and drill-down UX\u00a0— all in one instrument panel.',
    signals: ['Supabase', 'Live Metrics', 'Forecasting', 'Drill-Down UX', 'Weekly Scorecards'],
  },
  {
    id: '04',
    title: 'AI Operations',
    body: 'Smart AI agents handle outreach, follow-up, and weekly reporting so your team stays focused on the work that closes deals. Your leverage compounds every week.',
    signals: ['AI Assistants', 'Smart Replies', 'Voice Agents', 'Workflow Automation', 'Quality Checks'],
  },
  {
    id: '05',
    title: 'Branding & Identity',
    body: 'A complete brand system\u00a0— logo, color, typography, and voice\u00a0— that makes you look established and trustworthy from the first impression. Distinct, consistent, and built to last.',
    signals: ['Logo Design', 'Color System', 'Typography', 'Brand Guidelines', 'Social Templates'],
  },
  {
    id: '06',
    title: 'SEO & Visibility',
    body: 'Get found by the people already searching for what you sell. Technical SEO, content architecture, and local optimization that climbs rankings and brings in qualified traffic on autopilot.',
    signals: ['Technical SEO', 'Local SEO', 'Content Strategy', 'Schema Markup', 'Rank Tracking'],
  },
];

const shot = (url: string) =>
  `https://s.wordpress.com/mshots/v1/${encodeURIComponent('https://' + url)}?w=600&h=420`;

// The Field Work strip shows DeskDev's home-featured showcase items (see
// src/lib/showcase.ts) once there are enough to fill its eight cards. This
// list stands in until then, and whenever the showcase (live or its committed
// snapshot) has fewer.
// `fallback`: the live screenshot currently captures that site's 404 page, so
// the card renders a designed placeholder instead of the image.
const PORTFOLIO_FALLBACK = [
  { name: 'Hike Wales', domain: 'hikewales.com', tag: 'Travel / 3D', result: 'WebGL hero', image: shot('hikewales.com') },
  { name: 'Upscale Rails', domain: 'upscalerails.com', tag: 'Real Estate', result: 'Investor portal', image: shot('upscalerails.com') },
  { name: 'Four States Concrete', domain: 'fourstatesconcreterepair.com', tag: 'Concrete', result: '#1 local SEO', image: shot('fourstatesconcreterepair.com'), fallback: true },
  { name: 'Colorado River Expeditions', domain: 'coloradoriverexpeditions.com', tag: 'Travel / Tours', result: 'Booking system', image: shot('coloradoriverexpeditions.com') },
  { name: 'Shira Salon', domain: 'shirasalon.com', tag: 'Salon & Beauty', result: 'Online booking', image: shot('shirasalon.com') },
  { name: 'Lumina Comfort', domain: 'luminacomfort.com', tag: 'HVAC', result: 'Lead capture', image: shot('luminacomfort.com') },
  { name: 'TopCore IT', domain: 'topcoreit.com', tag: 'IT Services', result: 'B2B site', image: shot('topcoreit.com') },
  { name: 'Tank It Easy', domain: 'tankiteasyco.com', tag: 'Septic / Tanks', result: 'Multi-location', image: shot('tankiteasyco.com') },
];

const pricing = [
  {
    name: 'Launch',
    price: '$1,000',
    subtitle: 'A premium site, fast.',
    bullets: [
      'Five-page custom website',
      'Brand-aligned visual design',
      'Foundational SEO + analytics',
      'Lead capture integration',
      'Fourteen-day delivery',
      '30-day post-launch support',
    ],
  },
  {
    name: 'Growth',
    price: '$1,500',
    subtitle: 'The flagship revenue system.',
    bullets: [
      'Everything in Launch',
      'Automation workflows',
      'CRM integration + routing',
      'Funnel design + A/B testing',
      'Weekly performance reports',
      'Quarterly optimization sprints',
    ],
    featured: true,
  },
  {
    name: 'Dominance',
    price: '$2,000',
    subtitle: 'Full-stack growth infrastructure.',
    bullets: [
      'Everything in Growth',
      'Custom AI agents + automation',
      'Revenue dashboard + forecasting',
      'Authority content engine',
      '90-day execution plan',
      'Dedicated account strategist',
    ],
  },
];

const processSteps = [
  { n: '01', title: 'Signal', body: 'We dissect your business model, competitive landscape, and conversion targets. No surface-level discovery calls\u00a0— we go deep.' },
  { n: '02', title: 'Compose', body: 'Architect the brand system, design language, information hierarchy, and trust architecture. Every pixel gets a job assignment.' },
  { n: '03', title: 'Forge', body: 'Engineer the surface in Next.js. Wire automation, analytics, CRM, and AI agents into the bedrock. Ship fast, ship right.' },
  { n: '04', title: 'Launch', body: 'Deploy to production. Connect live analytics. Establish the weekly scorecard. Begin the iteration loop that compounds.' },
];

const testimonials = [
  {
    quote: 'NixGen didn\'t just build us a website\u00a0— they built a system that books work for us. Within 60 days we had 3x the leads and an automated follow-up pipeline. It paid for itself almost immediately.',
    author: 'Austin Hayes',
    role: 'Owner, Service Business',
    metric: '3x leads in 60 days',
  },
  {
    quote: 'They built a beautiful, fast website and added automation that sends every inquiry to my CRM automatically. In the first month, we saw a huge jump in calls and quote requests.',
    author: 'Joshua Lane',
    role: 'Owner, Brick Insulation',
    metric: '+267% quote requests',
  },
  {
    quote: 'Working with NixGen is like hiring a full agency without the agency overhead. The dashboard alone saved us 20 hours a week in manual reporting, and the site finally looks like the business we are.',
    author: 'Laith Hofayz',
    role: 'Director, Codetic',
    metric: '20+ hrs/week saved',
  },
  {
    quote: 'NixGen understood our vision immediately and created a sleek, scalable web presence. The AI assistant and automated lead capture transformed how we connect with clients.',
    author: 'Tyler Morgan',
    role: 'Founder, Tech Startup',
    metric: '3x lead volume',
  },
];

const journey = [
  {
    icon: <StackIcon size={22} weight="light" aria-hidden />,
    title: 'Your website looks like everyone else\'s',
    body: 'Templates, stock photos, generic copy. Visitors bounce because nothing says "this is different." Your brand gets lost in a sea of sameness.',
  },
  {
    icon: <LightningIcon size={22} weight="light" aria-hidden />,
    title: 'Leads slip through the cracks',
    body: 'No automation. Inquiries sit in an inbox for hours. Follow-ups are manual. Revenue leaks while you sleep. Your competitors respond in seconds.',
  },
  {
    icon: <ClockIcon size={22} weight="light" aria-hidden />,
    title: 'You can\'t measure what matters',
    body: 'No dashboard. No conversion tracking. No forecasting. You know the spend but not the return. Every decision is a guess.',
  },
  {
    icon: <CheckCircleIcon size={22} weight="light" aria-hidden />,
    title: 'Then everything changes',
    body: 'A system that converts, follows up automatically, surfaces real-time analytics, and shows you exactly where revenue comes from. That\'s what we build.',
  },
];

const useCases: UseCase[] = [
  {
    label: 'Service Businesses',
    title: 'Turn Your Website Into a Revenue Engine',
    description: 'From local contractors to nationwide service providers\u00a0— we build websites that rank, convert, and automate the entire lead-to-close pipeline. Your phone rings while you sleep.',
    metrics: ['3x avg lead volume', '14-day launch', '$2.5K–$8.5K'],
  },
  {
    label: 'SaaS & Tech Startups',
    title: 'Launch Fast. Scale Faster.',
    description: 'Product-led websites with 3D hero experiences, interactive demos, and conversion-optimized pricing pages. Built on the same stack unicorns use\u00a0— Next.js, Supabase, Cloudflare.',
    metrics: ['Sub-2s load time', 'A/B testing built-in', 'Custom dashboards'],
  },
  {
    label: 'E-commerce & DTC',
    title: 'Editorial Storefronts That Sell',
    description: 'Cinematic product pages, scent/style discovery quizzes, Shopify integration, and automated post-purchase flows. We make your brand feel like a luxury experience.',
    metrics: ['+142% avg conversion', 'Quiz funnels', 'Automated emails'],
  },
  {
    label: 'Real Estate & Finance',
    title: 'Authority Platforms That Close Deals',
    description: 'Listing intelligence, investor portals, underwriting tools, and CRM automation. We build the digital infrastructure that sources $14M+ deal pipelines.',
    metrics: ['$14M+ deals sourced', 'Custom portals', 'Investor CRM'],
  },
];

const faqItems = [
  {
    question: 'How long does a website take to build?',
    answer: 'Launch packages deliver in 14 days. Growth packages in 3 weeks. Dominance engagements are scoped individually but typically 30–45 days. Every project includes a dedicated launch runway with built-in buffer for revisions.',
  },
  {
    question: 'What makes NixGen different from other agencies?',
    answer: 'Three things: (1) Senior designers and engineers work on your project directly\u00a0— no juniors, no outsourcing. (2) Every site is engineered as a revenue system, not a pretty brochure. (3) We measure success by booked calls and pipeline revenue, not dribbble likes.',
  },
  {
    question: 'Do you work with businesses outside the US?',
    answer: 'Yes. We work with clients worldwide across 12+ time zones. We handle localization, currency, and regional compliance. Most of our communication is async, which makes international work seamless.',
  },
  {
    question: 'What happens after launch?',
    answer: 'Every package includes post-launch support (30–90 days depending on tier). We monitor analytics, run optimization sprints, handle updates, and provide weekly scorecards. Growth and Dominance clients get quarterly strategy reviews.',
  },
  {
    question: 'Do I own my website and code?',
    answer: 'Absolutely. You own the domain, code, content, and design. Everything is deployed to your own Cloudflare account and GitHub repository. Zero lock-in. You can take it anywhere, anytime.',
  },
  {
    question: 'Who actually works on my project?',
    answer: 'Senior designers and developers\u00a0— the same people from start to finish. You get a small, dedicated team that knows your project inside out, backed by smart automation tooling that lets us move fast without cutting corners on quality.',
  },
  {
    question: 'Can you integrate with my existing CRM / tools?',
    answer: 'Yes. We integrate with GoHighLevel, HubSpot, Salesforce, Monday.com, Slack, Notion, Airtable, Zapier, Make, and virtually any tool with an API. Custom integrations are included in Growth and Dominance tiers.',
  },
  {
    question: 'What if I just need a simple website?',
    answer: 'Our Launch tier at $2,500 delivers a premium 5-page website with SEO, analytics, and lead capture in 14 days. It\'s not "simple"\u00a0— it\'s a kinetic, editorial-grade surface that makes your competitors look templated. We don\'t do basic.',
  },
];

const partnerLogos = [
  'Hike Wales', 'Upscale Rails', 'Four States Concrete', 'Shira Salon',
  'Lumina Comfort', 'TopCore IT', 'Colorado River Expeditions', 'Tank It Easy',
  'Elite Management', 'Star Care ABA', 'RemoteCruit', 'Codetic',
];

const stats = [
  { value: '200+', label: 'Websites Delivered' },
  { value: '14 days', label: 'Average Launch Time' },
  { value: '96%', label: 'Client Satisfaction' },
  { value: '3x', label: 'Avg. Traffic Growth' },
];

const whyItems = [
  { n: 'Senior', title: 'A Senior Team Only', body: 'You work directly with the designers and engineers building your site. No juniors, no outsourcing.' },
  { n: '14d', title: 'Live in ~14 Days', body: 'A premium site shipped in about two weeks\u00a0— fast, and without cutting corners.' },
  { n: 'Yours', title: 'Fully Yours', body: 'Your site, code, and domain stay on your own accounts\u00a0— transferable any time, no strings.' },
  { n: '1:1', title: 'Always a Human', body: 'Clear weekly updates, honest timelines, and a team that actually replies.' },
  { n: 'ROI', title: 'Built to Make Money', body: 'We measure success in booked calls and revenue\u00a0— not design-award likes.' },
  { n: '24/7', title: 'Works While You Sleep', body: 'Automation keeps capturing and following up with every lead, around the clock.' },
];

// Hero wall (decorative, so it may change freely): the studio's own template
// designs. No stock photos. The tiles draw at about 180px wide, so the wall
// uses 640px WebP copies in public/hero-wall (one per slug, made from
// public/templates/premium/<slug>-template.png) instead of the full captures.
const heroImages = [
  'consulting-swiss',
  'saas-premium',
  'coffee-premium',
  'fitness-premium',
  'accounting-firm',
  'craft-brewery',
  'healthcare-premium',
  'hotel-premium',
  'app-neobrutalist',
  'construction-premium',
  'car-marketplace',
  'energy-drink',
  'telehealth',
  'portfolio-premium',
  'language-app',
  'perfume-brand',
  'project-management-saas',
  'coding-bootcamp',
  'car-rental',
  'trading-app',
  'design-tool-saas',
].map((slug) => `/hero-wall/${slug}.webp`);
const wallColumns = [0, 1, 2].map((c) => heroImages.filter((_, i) => i % 3 === c));

/* ═══════════════ PIECES ═══════════════ */

/* Hero intro: a CSS sequence (home.module.css) that starts on first paint, so
   the headline never waits for hydration and reduced motion applies from the
   first frame. Order: eyebrow, headline words 50ms apart, then the lede, the
   CTAs and the wall once every word is on its way. */
const introDelay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;
const INTRO = { words: 80, word: 50, lede: 400, ctas: 480, wall: 560 };

/** One headline line. Each word settles into place inside its own mask (the
 *  kit's mask class), visible from the first frame; the words are real text
 *  with real spaces. `from` is the index of
 *  the line's first word in the sequence. Balanced, so a phone never leaves
 *  one word alone on a line. */
function IntroLine({ words, from = 0 }: { words: ReactNode[]; from?: number }) {
  return (
    <span className="block [text-wrap:balance]">
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="nx-kit-word-mask">
            <span className={styles.introWord} style={introDelay(INTRO.words + (from + i) * INTRO.word)}>
              {w}
            </span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('');

/* The eyebrow names the film's length, so it reads the same figure the player
   shows on its chip ("Watch · 3:01") and cannot drift from it. */
const vslMinutes = Math.max(1, Math.round(VSL_DURATION / 60));

/* Proof: two asymmetric rows (lead 8 / 4, then 7 / 5), so no row is three equal
   cards. The longest quote takes the wider cell of the second row. */
const quoteCell = ['md:col-span-2 lg:col-span-8', 'lg:col-span-4', 'lg:col-span-7', 'md:col-span-2 lg:col-span-5'];

/* ═══════════════ PAGE ═══════════════ */

/** The home strip re-reads the showcase at most every five minutes, like /portfolio. */
export const revalidate = 300;

export default async function Home() {
  // The strip is a fixed 8-card grid: use the Showcase's home picks only when
  // they fill it, otherwise keep the built-in list.
  const homePicks = (await getShowcase({ homeOnly: true })).map(toHomeCard);
  const work =
    homePicks.length >= PORTFOLIO_FALLBACK.length ? homePicks.slice(0, PORTFOLIO_FALLBACK.length) : PORTFOLIO_FALLBACK;
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="nx-grid-bg pointer-events-none absolute inset-0 -z-10 opacity-70" />

          <div className="nx-wrap grid grid-cols-1 lg:min-h-[100svh] lg:grid-cols-12 lg:gap-x-10">
            <div className="flex min-h-[100svh] min-w-0 flex-col pb-8 pt-[calc(var(--nx-nav-h)+2.5rem)] lg:col-span-7 lg:pt-[calc(var(--nx-nav-h)+1rem)]">
              <div className="my-auto py-8 lg:py-6">
                <div className={styles.intro}>
                  <p className="nx-eyebrow rounded-full border border-line bg-[color-mix(in_oklab,var(--surface)_70%,transparent)] px-3.5 py-1.5 max-sm:text-[0.6875rem] max-sm:tracking-[0.1em]">
                    Websites · Automation · Branding · SEO
                  </p>
                </div>
                <h1 className="nx-display mt-8 text-[clamp(2.75rem,5.8vw,5.2rem)]">
                  <IntroLine words={['Websites', 'That', 'Work.']} />{' '}
                  <IntroLine
                    from={3}
                    words={[
                      'Systems',
                      'That',
                      <em key="accent" className="nx-serif text-accent-text">
                        Scale.
                      </em>,
                    ]}
                  />
                </h1>
                <p className={`nx-lede mt-8 max-w-[35rem] ${styles.intro}`} style={introDelay(INTRO.lede)}>
                  We design premium websites and wire in the automation, branding, and SEO
                  behind them&nbsp;— so service businesses book more calls, follow up
                  automatically, and see exactly what&apos;s driving revenue.
                </p>
                <div className={`mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center ${styles.intro}`} style={introDelay(INTRO.ctas)}>
                  <Magnetic className="sm:w-auto">
                    <Button href="/contact" size="lg" arrow className="w-full sm:w-auto">
                      Book Discovery Call
                    </Button>
                  </Magnetic>
                  <Button href="/portfolio" variant="secondary" size="lg">
                    View the Work
                  </Button>
                </div>
              </div>

              <div className={`-mx-[var(--nx-gutter)] mb-2 lg:hidden ${styles.introFade}`} style={introDelay(INTRO.wall)}>
                <HeroStrip images={heroImages.slice(0, 9)} />
              </div>
              {/* Desktop only: the copy column fits one viewport, so the cue sits on the fold's
                  bottom edge. On phones the image strip already signals there's more below. */}
              <ScrollCue className="hidden lg:flex" />
            </div>

            <div className={`relative hidden lg:col-span-5 lg:block ${styles.introFade}`} style={introDelay(INTRO.wall)}>
              <HeroWall columns={wallColumns} className="absolute inset-y-0 left-0 right-[calc(-1*var(--nx-gutter))]" />
            </div>
          </div>
        </section>

        {/* ═══════════════ VSL ═══════════════ */}
        <section className="nx-cv nx-section nx-band border-y border-line" aria-labelledby="vsl-title">
          <div className="nx-wrap">
            <SectionHeader
              id="vsl-title"
              eyebrow={`${vslMinutes}-Minute Overview`}
              title={
                <>
                  See exactly what we <Accent>build for you.</Accent>
                </>
              }
              titleClassName="max-w-[14ch]"
            />
            <Reveal className="mt-14 md:mt-20">
              <VslPlayer />
            </Reveal>
          </div>
        </section>

        {/* ═══════════════ TRUSTED BY ═══════════════ */}
        <section className="nx-cv pb-[clamp(3rem,6vw,5rem)] pt-[clamp(4.5rem,9vw,7.5rem)]" aria-labelledby="trusted-title">
          <div className="nx-wrap">
            <Reveal className="flex justify-center">
              <Eyebrow>
                <span id="trusted-title">Trusted by Growing Brands</span>
              </Eyebrow>
            </Reveal>
          </div>
          <Marquee
            className="mt-10 md:mt-12"
            label="Trusted by Growing Brands"
            duration={70}
            gap="clamp(1.75rem,3vw,2.75rem)"
            items={partnerLogos.map((name) => (
              <span
                key={name}
                className="whitespace-nowrap font-heading text-[clamp(1.5rem,2.5vw,2.25rem)] font-medium tracking-[-0.03em] text-fg-3 [transition:color_200ms_ease] hover:text-fg"
              >
                {name}
              </span>
            ))}
            separator={<span className="block h-1.5 w-1.5 rotate-45 bg-accent" />}
          />
        </section>

        {/* ═══════════════ STATS ═══════════════ */}
        {/* The same four-figure band as Portfolio and About. */}
        <section className="nx-cv nx-band border-y border-line">
          <div className="nx-wrap">
            <ArchiveStats stats={stats} />
          </div>
        </section>

        {/* ═══════════════ 01 — PROBLEM / JOURNEY ═══════════════ */}
        <section className="nx-cv nx-section" aria-labelledby="problem-title">
          <div className="nx-wrap">
            <Reveal>
              <Eyebrow index="01" className="mb-8">
                The Problem
              </Eyebrow>
            </Reveal>
            <Reveal as="h2" id="problem-title" className="nx-h2 max-w-[25ch]">
              Most service businesses are <Accent>invisible online</Accent>
              <span className="text-fg-3">. Not because they lack talent&nbsp;— because their digital presence doesn&apos;t match their value.</span>
            </Reveal>

            <div className="relative mt-16 md:mt-24 lg:-ml-7">
              {/* Connecting hairline: vertical on phones, horizontal on desktop */}
              <div
                aria-hidden
                className="absolute bottom-6 left-[5px] top-2 w-px bg-[linear-gradient(to_bottom,var(--line-2)_65%,var(--accent))] lg:bottom-auto lg:left-7 lg:right-0 lg:top-[5px] lg:h-px lg:w-auto lg:bg-[linear-gradient(to_right,var(--line-2)_70%,var(--accent))]"
              />
              <Stagger as="ol" each={0.08} className="relative grid gap-10 lg:grid-cols-4 lg:gap-4">
                {journey.map((j, i) => {
                  const last = i === journey.length - 1;
                  const content = (
                    <>
                      <div className="flex items-center justify-between">
                        <span
                          className={`grid h-12 w-12 place-items-center rounded-xl ${
                            last ? 'bg-accent text-accent-fg' : 'border border-line bg-surface text-fg-2'
                          }`}
                        >
                          {j.icon}
                        </span>
                        <span className={`nx-mono text-xs tabular-nums ${last ? 'text-accent-text' : 'text-fg-3'}`} aria-hidden>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <h3 className="nx-h4 mt-7 text-[1.3125rem] leading-[1.2] lg:min-h-[2lh]">{j.title}</h3>
                      <p className="nx-body mt-3 text-[0.9375rem]">{j.body}</p>
                    </>
                  );
                  return (
                    <StaggerItem key={j.title} as="li" className="relative pl-10 lg:pl-0 lg:pt-10">
                      <span
                        aria-hidden
                        className={`absolute left-0 top-2 h-[11px] w-[11px] rounded-full border lg:left-7 lg:top-0 ${
                          last ? 'border-accent bg-accent ring-[6px] ring-accent/15' : 'border-line-2 bg-bg'
                        }`}
                      />
                      {last ? (
                        <Bezel accent className="h-full" coreClassName="flex flex-col p-6 lg:p-7">
                          {content}
                        </Bezel>
                      ) : (
                        <div className="flex h-full flex-col lg:p-7 lg:pt-[calc(1.75rem+0.375rem)]">{content}</div>
                      )}
                    </StaggerItem>
                  );
                })}
              </Stagger>
            </div>
          </div>
        </section>

        {/* ═══════════════ 02 — SERVICES ═══════════════ */}
        <section className="nx-cv nx-section nx-band border-y border-line" aria-labelledby="services-title">
          <div className="nx-wrap">
            <SectionHeader
              id="services-title"
              index="02"
              eyebrow="Services"
              title={
                <>
                  Six services. One compounding <Accent>advantage.</Accent>
                </>
              }
              lede="Each service stands on its own. Stacked together, they become a complete growth system&nbsp;— website, brand, traffic, and automation working as one."
              titleClassName="max-w-[13ch]"
            />

            <ol className="mt-16 border-t border-line md:mt-24">
              {services.map((s) => (
                <Reveal
                  key={s.id}
                  as="li"
                  className={`${styles.row} relative isolate grid gap-5 border-b border-line py-9 md:grid-cols-12 md:gap-8 lg:py-12`}
                >
                  <span
                    aria-hidden
                    className={`${styles.rowWash} pointer-events-none absolute inset-y-0 -left-4 -right-4 -z-10 bg-surface sm:-left-6 sm:-right-6`}
                  />
                  {/* Decorative numerals are drawn from data-n (::before), like the 404 watermark: not text to read or contrast-check. */}
                  <span
                    aria-hidden
                    data-n={s.id}
                    className={`nx-numeral text-[clamp(3.25rem,6vw,5.25rem)] before:content-[attr(data-n)] md:col-span-2 ${styles.rowNum}`}
                  />
                  <div className="md:col-span-10 lg:col-span-6">
                    <h3 className="nx-h3">{s.title}</h3>
                    <p className="nx-body mt-4 max-w-[34rem]">{s.body}</p>
                  </div>
                  <div className="flex flex-col gap-4 md:col-span-10 md:col-start-3 lg:col-span-4 lg:col-start-9 lg:pt-1.5">
                    <span className="nx-eyebrow">SYSTEM</span>
                    <ul className="flex flex-wrap gap-2">
                      {s.signals.map((sig) => (
                        <li key={sig} className="nx-tag">
                          {sig}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ═══════════════ 03 — INDUSTRIES ═══════════════ */}
        <section className="nx-cv nx-section" aria-labelledby="industries-title">
          <div className="nx-wrap">
            <SectionHeader
              id="industries-title"
              index="03"
              eyebrow="Industries"
              title={
                <>
                  Who we <Accent>build for.</Accent>
                </>
              }
            />
            <Reveal className="mt-14 md:mt-20">
              <UseCaseTabs cases={useCases} labelledBy="industries-title" />
            </Reveal>
          </div>
        </section>

        {/* ═══════════════ 04 — PROOF ═══════════════ */}
        <section id="testimonials" className="nx-cv nx-section nx-band border-y border-line" aria-labelledby="proof-title">
          <div className="nx-wrap">
            <SectionHeader
              id="proof-title"
              index="04"
              eyebrow="Proof"
              title={
                <>
                  Real results. <Accent>Real revenue.</Accent>
                </>
              }
              lede={
                <>
                  Every project is measured against business outcomes&nbsp;— not vanity metrics.
                  Here&apos;s what clients say about working with NixGen.
                </>
              }
            />

            <Stagger each={0.08} className="mt-14 grid gap-4 md:mt-20 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
              {testimonials.map((t, i) => {
                const lead = i === 0;
                const mark = (
                  <span aria-hidden className="block h-10 font-serif text-[5rem] leading-[0.9] text-accent-text md:h-12 md:text-[6rem]">
                    &ldquo;
                  </span>
                );
                const author = (
                  <div className="flex items-center gap-4 border-t border-line pt-6">
                    <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[0.875rem] border border-line-2 bg-bg-2 font-heading text-sm font-medium text-fg-2">
                      {initials(t.author)}
                    </span>
                    <span>
                      <span className="block font-heading text-[1.0625rem] font-medium tracking-[-0.012em] text-fg">{t.author}</span>
                      <span className="nx-small mt-0.5 block">{t.role}</span>
                    </span>
                  </div>
                );
                return (
                  <StaggerItem key={t.author} className={`flex ${quoteCell[i]}`}>
                    {lead ? (
                      <Bezel accent className="flex-1" coreClassName="p-6 sm:p-9 lg:p-11">
                        <figure className="flex h-full flex-col">
                          <div className="flex items-start justify-between gap-6">
                            {mark}
                            <Tag accent className="lg:hidden">{t.metric}</Tag>
                            <p className="hidden max-w-[11ch] text-balance pt-1 text-right font-heading text-[clamp(1.75rem,2.4vw,2.375rem)] font-medium leading-[1.02] tracking-[-0.035em] text-accent-text lg:block">
                              {t.metric}
                            </p>
                          </div>
                          <blockquote className="mt-6 flex-1 lg:mt-8">
                            <p className="text-[1.1875rem] leading-[1.5] text-fg md:font-heading md:text-[clamp(1.5rem,2.2vw,2rem)] md:font-medium md:leading-[1.24] md:tracking-[-0.022em]">
                              {t.quote}
                            </p>
                          </blockquote>
                          <figcaption className="mt-8 md:mt-12">{author}</figcaption>
                        </figure>
                      </Bezel>
                    ) : (
                      <figure className="nx-card flex flex-1 flex-col">
                        <div className="flex items-start justify-between gap-6">
                          {mark}
                          <Tag accent>{t.metric}</Tag>
                        </div>
                        <blockquote className="mt-6 flex-1">
                          <p className={`text-fg ${i === 2 ? 'text-[1.125rem] leading-[1.55] lg:text-[1.25rem] lg:leading-[1.5]' : 'text-[1.0625rem] leading-[1.6] lg:text-[1.125rem]'}`}>
                            {t.quote}
                          </p>
                        </blockquote>
                        <figcaption className="mt-8 md:mt-10">{author}</figcaption>
                      </figure>
                    )}
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </section>

        {/* ═══════════════ 05 — FIELD WORK ═══════════════ */}
        <section className="nx-cv nx-section" aria-labelledby="work-title">
          <div className="nx-wrap">
            <SectionHeader
              id="work-title"
              index="05"
              eyebrow="Field Work"
              title={
                <>
                  Launched. Ranking. <Accent>Compounding.</Accent>
                </>
              }
            />

            {/* Tiles open 60ms apart; each caption rises with its own tile. */}
            <Stagger as="ul" each={0.06} className="mt-12 grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 sm:gap-y-12 md:mt-20 lg:grid-cols-4">
              {work.map((p) => (
                <StaggerItem key={`${p.domain}-${p.name}`} as="li" distance={12} className="group">
                  {p.fallback ? (
                    <Reveal
                      variant="clip"
                      role="img"
                      aria-label={p.name}
                      className="nx-media relative aspect-[4/3] border border-line bg-[radial-gradient(120%_100%_at_0%_100%,var(--accent-soft),transparent_65%)]"
                    >
                      <div aria-hidden className="nx-grid-bg absolute inset-0 opacity-70" />
                      <span
                        aria-hidden
                        className={`${styles.fallbackMark} absolute bottom-3 left-4 font-heading text-[clamp(2.5rem,6vw,4.75rem)] font-medium leading-none tracking-[-0.05em] text-accent-text sm:bottom-4 sm:left-5`}
                      >
                        {initials(p.name)}
                      </span>
                      <span aria-hidden className="nx-mono absolute right-5 top-4 hidden text-[0.6875rem] text-fg-3 sm:block">
                        {p.domain}
                      </span>
                    </Reveal>
                  ) : (
                    <Reveal variant="clip" className={`nx-media ${styles.shot} aspect-[4/3] border border-line`}>
                      <RevealMedia className="relative h-full w-full">
                        <ShotImage src={p.image} alt={p.name} />
                      </RevealMedia>
                    </Reveal>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 sm:mt-5 sm:gap-2">
                    <Tag>{p.tag}</Tag>
                    {p.result && <Tag accent>{p.result}</Tag>}
                  </div>
                  <h3 className="nx-h4 mt-3 text-[1rem] sm:mt-4 sm:text-[1.125rem]">{p.name}</h3>
                  <p className="nx-mono mt-1 truncate text-xs text-fg-3">{p.domain}</p>
                </StaggerItem>
              ))}
            </Stagger>

            <Reveal className="mt-14 flex justify-center md:mt-20">
              <Button href="/portfolio" variant="secondary" size="lg" arrow>
                View Full Portfolio
              </Button>
            </Reveal>
          </div>
        </section>

        {/* ═══════════════ 06 — PRICING ═══════════════ */}
        <section id="pricing" className="nx-cv nx-section nx-band border-y border-line" aria-labelledby="pricing-title">
          <div className="nx-wrap">
            <SectionHeader
              id="pricing-title"
              index="06"
              eyebrow="Engagements"
              align="center"
              title={
                <>
                  Three ways to enter <Accent>the system.</Accent>
                </>
              }
              lede="Every tier includes deployment, analytics, and post-launch support. Pick the system that matches your growth stage&nbsp;— upgrade anytime."
            />

            {/* The recommended tier is wider and set in an accent tray; the others sit
                in a matching inset (5px + the card's own 1px border = the tray's 6px)
                so every header, price and list shares one line. */}
            <Stagger each={0.08} className="mx-auto mt-14 grid max-w-md gap-4 md:mt-20 lg:max-w-none lg:grid-cols-[1fr_1.16fr_1fr] lg:gap-4">
              {pricing.map((tier) => {
                const body = (
                  <>
                    <div className="flex min-h-7 items-center justify-between gap-4">
                      <h3 className="font-heading text-[1.375rem] font-medium tracking-[-0.02em] text-fg">{tier.name}</h3>
                      {tier.featured && <Tag accent>Most chosen</Tag>}
                    </div>
                    <p className="mt-8 flex items-baseline gap-1.5">
                      <span className="nx-numeral text-[clamp(3rem,4.4vw,4rem)]">{tier.price}</span>
                      <span className="nx-small">/month</span>
                    </p>
                    <p className="nx-body mt-3">{tier.subtitle}</p>
                    <ul className="mt-8 flex flex-1 flex-col gap-3.5 border-t border-line pt-8">
                      {tier.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-3 text-[0.9375rem] leading-snug text-fg-2">
                          <CheckIcon size={16} weight="regular" aria-hidden className="mt-0.5 shrink-0 text-accent-text" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                );
                return tier.featured ? (
                  <StaggerItem key={tier.name} as="article" className="flex">
                    <Bezel accent className="flex-1" coreClassName="flex flex-col p-[clamp(1.5rem,2.6vw,2.25rem)]">
                      {body}
                      <Magnetic className="mt-10 w-full">
                        <Button href="/contact" arrow className="w-full">
                          Claim This Tier
                        </Button>
                      </Magnetic>
                    </Bezel>
                  </StaggerItem>
                ) : (
                  <StaggerItem key={tier.name} as="article" className="flex lg:p-[5px]">
                    <div className="nx-card flex flex-1 flex-col">
                      {body}
                      <Button href="/contact" variant="secondary" arrow className="mt-10 w-full">
                        Begin
                      </Button>
                    </div>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </section>

        {/* ═══════════════ 07 — METHOD ═══════════════ */}
        <section className="nx-cv nx-section" aria-labelledby="method-title">
          <div className="nx-wrap">
            <SectionHeader
              id="method-title"
              index="07"
              eyebrow="Method"
              title={
                <>
                  A four-phase protocol from <Accent>signal to launch.</Accent>
                </>
              }
              titleClassName="max-w-[18ch]"
            />

            <div className="relative mt-16 md:mt-24">
              {/* Progress hairline (desktop): fills as the timeline scrolls into view */}
              <div aria-hidden className="absolute inset-x-0 top-0 hidden h-px bg-line-2 lg:block">
                <div className={`h-full w-full bg-accent ${styles.progressFill}`} />
              </div>
              <Stagger as="ol" each={0.08} className="grid gap-12 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4 lg:gap-8">
                {processSteps.map((p) => (
                  <StaggerItem
                    key={p.n}
                    as="li"
                    className="relative border-l border-line pl-6 sm:border-l-0 sm:border-t sm:pl-0 sm:pt-8 lg:border-t-0 lg:pt-10"
                  >
                    <span aria-hidden className="absolute -top-[5px] left-0 hidden h-[11px] w-[11px] rounded-full border border-accent bg-bg lg:block" />
                    <span
                      aria-hidden
                      data-n={p.n}
                      className={`nx-numeral block text-[clamp(4.5rem,8vw,7.25rem)] before:content-[attr(data-n)] ${styles.outline}`}
                    />
                    <h3 className="nx-h3 mt-6 lg:mt-8">{p.title}</h3>
                    <p className="nx-body mt-3 max-w-xs">{p.body}</p>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
          </div>
        </section>

        {/* ═══════════════ 08 — WHY NIXGEN ═══════════════ */}
        <section className="nx-cv nx-section nx-band border-y border-line" aria-labelledby="why-title">
          <div className="nx-wrap">
            <SectionHeader
              id="why-title"
              index="08"
              eyebrow="Why NixGen"
              title={
                <>
                  A senior team that <Accent>actually gives a damn.</Accent>
                </>
              }
              titleClassName="max-w-[16ch]"
              lede="No juniors, no outsourcing, no account-manager telephone game. You work directly with the designers and engineers building your site&nbsp;— backed by smart tooling that lets us deliver agency-grade work at startup speed."
            />

            <div className="mt-14 md:mt-20">
              <WhyBento items={whyItems} />
            </div>
          </div>
        </section>

        {/* ═══════════════ 09 — FAQ ═══════════════ */}
        <section id="faq" className="nx-cv nx-section" aria-labelledby="faq-title">
          <div className="nx-wrap grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <div className="lg:sticky lg:top-[calc(var(--nx-nav-h)+2.5rem)]">
                <SectionHeader
                  id="faq-title"
                  index="09"
                  eyebrow="Questions"
                  layout="stack"
                  title={
                    <>
                      Frequently asked <Accent>questions.</Accent>
                    </>
                  }
                />
              </div>
            </div>
            <div className="lg:col-span-8">
              <Faq items={faqItems} name="faq-home" />
            </div>
          </div>
        </section>

        {/* ═══════════════ FINAL CTA ═══════════════ */}
        <CtaBand
          className="nx-cv !pt-0"
          kicker={
            <span className="nx-beacon">
              <BreathingDot />
              <span>Available Q2 2026&nbsp;— limited slots</span>
            </span>
          }
          title={
            <>
              Ready to launch something <Accent>unfair to competitors?</Accent>
            </>
          }
          body={
            <>
              We take a small number of clients each quarter. If your business
              is ready for a revenue-grade digital surface&nbsp;— book a discovery call.
              No pressure, no pitch decks. Just strategy.
            </>
          }
          actions={
            <>
              <Magnetic>
                <Button href="/contact" variant="white" size="lg" arrow>
                  Book Discovery Call
                </Button>
              </Magnetic>
              <Button href="/portfolio" variant="outline-white" size="lg">
                Review Proof
              </Button>
            </>
          }
        />
      </main>

      <Footer />
    </div>
  );
}
