import { pageMeta } from '@/lib/seo';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { SectionHeader } from '@/components/site/SectionHeader';
import { Faq } from '@/components/site/Faq';
import { CtaBand } from '@/components/site/CtaBand';
import { Button } from '@/components/site/Button';
import { Accent, Beacon } from '@/components/site/Typography';
import { PhaseIndex } from '@/components/site/process/PhaseIndex';
import { PhaseTrack } from '@/components/site/process/PhaseTrack';
import { GuaranteeRow } from '@/components/site/process/GuaranteeRow';
import { Stagger, StaggerItem } from '@/components/site/motion';
import type { Guarantee, Phase } from '@/components/site/process/types';

export const metadata = pageMeta({
  title: 'Process',
  description:
    'Every NixGen engagement follows a rigorous four-phase protocol. No guesswork. No scope creep. Just systematic execution from business audit to production deployment.',
  path: '/process',
});

const phases: Phase[] = [
  {
    id: '01',
    title: 'Signal',
    subtitle: 'Discovery & Strategy',
    duration: '1–2 days',
    body: 'We start by dissecting your business model, competitive landscape, ideal customer profile, and conversion targets. This isn\'t a surface-level discovery call\u00a0— we go deep into your unit economics, current traffic sources, and growth bottlenecks.',
    deliverables: [
      'Business audit + competitive analysis',
      'Customer journey mapping',
      'Conversion target framework',
      'Technical requirements spec',
      'Project scope + timeline',
    ],
  },
  {
    id: '02',
    title: 'Compose',
    subtitle: 'Design & Architecture',
    duration: '3–7 days',
    body: 'We architect the brand system, design language, information hierarchy, and trust architecture. Every layout decision is informed by the strategy phase. We design for conversion, not awards.',
    deliverables: [
      'Brand system + visual direction',
      'Wireframes + information architecture',
      'Copy framework + messaging hierarchy',
      'Motion design spec',
      'Component library (Figma)',
    ],
  },
  {
    id: '03',
    title: 'Forge',
    subtitle: 'Engineering & Integration',
    duration: '5–14 days',
    body: 'We engineer the site in Next.js with React, Tailwind, and Framer Motion. Wire in automation, analytics, CRM integration, and AI assistants. Ship fast, ship right\u00a0— built by senior engineers, not juniors.',
    deliverables: [
      'Next.js production build',
      'CRM + automation integration',
      'Analytics + tracking setup',
      'SEO architecture + schema',
      'Performance optimization (<2s LCP)',
    ],
  },
  {
    id: '04',
    title: 'Launch',
    subtitle: 'Deploy & Compound',
    duration: 'Day 14+',
    body: 'Deploy to production on Cloudflare. Connect live analytics. Establish the weekly scorecard. Begin the optimization loop that compounds results week over week. Your system gets better with time.',
    deliverables: [
      'Cloudflare production deployment',
      'Weekly performance scorecard',
      'A/B test infrastructure',
      'Post-launch support (30–90 days)',
      'Quarterly strategy review (Growth+)',
    ],
  },
];

const guarantees: Guarantee[] = [
  { icon: 'clock', title: '14-Day Delivery', body: 'Launch packages ship in 14 days. We build fast because a focused senior team and sharp process handle it\u00a0— not because we cut corners.' },
  { icon: 'key', title: 'Full Code Ownership', body: 'You own the domain, code, content, and design. Deployed to your Cloudflare + GitHub. Zero lock-in, zero hidden fees.' },
  { icon: 'chart', title: 'Revenue-First Design', body: 'Every pixel has a job. We measure success by pipeline revenue, conversion rate, and organic traffic\u00a0— not aesthetics.' },
  { icon: 'support', title: 'Post-Launch Support', body: 'Every engagement includes 30–90 days of support. We don\'t disappear after launch\u00a0— we iterate against the scorecard.' },
  { icon: 'report', title: 'Weekly Scorecards', body: 'Growth and Dominance clients get weekly performance reports with traffic, conversion, and revenue metrics. Full transparency.' },
  { icon: 'badge', title: 'Satisfaction Guarantee', body: '96% client satisfaction rate. If you\'re not happy with the initial design concepts, we\'ll revise until you are\u00a0— no extra charge.' },
];

const faqItems = [
  { question: 'What if I need changes after the design is approved?', answer: 'All packages include revision rounds. Launch includes 2 rounds, Growth includes 3, and Dominance includes unlimited revisions within scope. Minor tweaks are always handled quickly.' },
  { question: 'How do you handle communication during the project?', answer: 'We use a dedicated Slack channel (or email if preferred) with daily updates during the Forge phase. You get a project timeline on day one and status updates at every milestone.' },
  { question: 'Can I see work-in-progress during development?', answer: 'Yes. We deploy to a staging URL on day one of development. You can see real-time progress and provide feedback throughout the build phase.' },
  { question: 'What if my project needs more than 14 days?', answer: 'Complex projects (dashboards, AI operations, custom integrations) are scoped individually. We\'ll give you an accurate timeline during the Signal phase. Most projects complete within 30 days.' },
];

export default function Process() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        {/* ═══════════════ HERO ═══════════════ */}
        <PageHero
          eyebrow="Operating Protocol / Four Phases"
          title={
            <>
              From signal to <Accent>launch</Accent> in four phases.
            </>
          }
          lede={
            <>
              Every NixGen engagement follows a rigorous four-phase protocol. No guesswork. No scope creep. Just
              systematic execution from business audit to production deployment.
            </>
          }
          aside={<PhaseIndex phases={phases} label="Operating Protocol" />}
          // The schedule is taller than the copy at most desktop widths, and the hero grid aligns
          // its columns to the bottom, which pushed the headline down (150px at 1024). Top-aligned,
          // the headline starts where it does on every other page. Drop this once PageHero itself
          // aligns to the top and bottom-aligns only its aside.
          className="lg:[&_.nx-wrap>div]:items-start"
        />

        {/* ═══════════════ PHASES (two-by-two grid from lg, stacked below) ═══════════════ */}
        <PhaseTrack phases={phases} label="Operating Protocol" deliverablesLabel="Phase Deliverables" />

        {/* ═══════════════ GUARANTEES ═══════════════ */}
        <section className="nx-section nx-band border-y border-line" aria-labelledby="guarantees-title">
          <div className="nx-wrap">
            <SectionHeader
              id="guarantees-title"
              eyebrow="Guarantees"
              title={
                <>
                  What we promise on every <Accent>engagement.</Accent>
                </>
              }
              titleClassName="max-w-[16ch]"
            />
            {/* A ledger of promises (hairline rows), not a grid of equal cards. */}
            <Stagger className="mt-14 border-b border-line md:mt-20">
              {guarantees.map((g, i) => (
                <StaggerItem key={g.title}>
                  <GuaranteeRow guarantee={g} index={i} />
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* ═══════════════ FAQ ═══════════════ */}
        <section className="nx-section" aria-labelledby="process-faq-title">
          <div className="nx-wrap grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <div className="lg:sticky lg:top-[calc(var(--nx-nav-h)+2.5rem)]">
                <SectionHeader
                  id="process-faq-title"
                  eyebrow="Process Questions"
                  title={
                    <>
                      How we <Accent>work.</Accent>
                    </>
                  }
                  layout="stack"
                />
              </div>
            </div>
            <div className="lg:col-span-7">
              <Faq items={faqItems} name="faq-process" />
            </div>
          </div>
        </section>

        {/* ═══════════════ CTA ═══════════════ */}
        <CtaBand
          kicker={<Beacon>Ready to begin</Beacon>}
          title={
            <>
              Phase 01 starts with a <Accent>single call.</Accent>
            </>
          }
          body={
            <>
              Book a 30-minute discovery call. We&apos;ll audit your current digital presence, identify the
              highest-leverage system for your business, and give you an honest timeline + budget estimate.
            </>
          }
          actions={
            <>
              <Button href="/contact" variant="white" size="lg" arrow magnetic>
                Book Discovery Call
              </Button>
              <Button href="/services" variant="outline-white" size="lg" magnetic>
                See Capabilities
              </Button>
            </>
          }
        />
      </main>

      <Footer />
    </div>
  );
}
