import { pageMeta } from '@/lib/seo';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { SectionHeader } from '@/components/site/SectionHeader';
import { CtaBand } from '@/components/site/CtaBand';
import { Button } from '@/components/site/Button';
import { Accent, Beacon, Eyebrow } from '@/components/site/Typography';
import { Reveal, SplitWords, Stagger, StaggerItem } from '@/components/site/motion';
import { AboutIndex } from '@/components/site/about/AboutIndex';
import { ArchiveStats } from '@/components/site/portfolio/ArchiveStats';
import { StudioPanel } from '@/components/site/about/StudioPanel';
import { PrincipleRow } from '@/components/site/about/PrincipleRow';
import { Timeline } from '@/components/site/about/Timeline';
import { ValueGrid } from '@/components/site/about/ValueGrid';
import { StackList } from '@/components/site/about/StackList';
import type { AboutSection, Milestone, Principle, StackGroup, Value } from '@/components/site/about/types';

export const metadata = pageMeta({
  title: 'About',
  description:
    'NixGen is a small, senior studio that designs premium websites and the branding, automation, and SEO behind them. No juniors, no outsourcing — you work directly with the people who design and build your project.',
  path: '/about',
});

// In-page index (hero aside) — `anchor` is each section's id.
const sections: AboutSection[] = [
  { id: '01', anchor: 'thesis', label: 'Thesis' },
  { id: '02', anchor: 'team', label: 'The Team' },
  { id: '03', anchor: 'values', label: 'Values' },
  { id: '04', anchor: 'principles', label: 'Operating Principles' },
  { id: '05', anchor: 'journey', label: 'Journey' },
  { id: '06', anchor: 'stack', label: 'Hardware' },
];

const stats = [
  { value: '200+', label: 'Projects Delivered' },
  { value: '14 days', label: 'Avg. Launch Time' },
  { value: '96%', label: 'Client Satisfaction' },
  { value: '100%', label: 'Code Ownership' },
];

const principles: Principle[] = [
  {
    n: '01',
    title: 'Editorial over Templated',
    body: 'Every surface is composed like a brand launch. Asymmetric layouts, intentional typography, cinematic motion. Nothing looks stamped. Your website should feel like a premiere\u00a0— not a download.',
  },
  {
    n: '02',
    title: 'Architecture over Decoration',
    body: 'Depth, negative space, and tonal shifts replace borders and drop shadows. The interface feels carved, not pasted. Every element exists because it earns its place.',
  },
  {
    n: '03',
    title: 'Revenue over Vanity',
    body: 'We measure surfaces by bookings, close rates, and recurring revenue\u00a0— not dribbble likes. Every pixel has a job. If it doesn\'t convert, it doesn\'t ship.',
  },
  {
    n: '04',
    title: 'Leverage over Labor',
    body: 'Automation and AI agents compound the value of each engagement. You buy a system, not a stack of deliverables. The work keeps working after we leave.',
  },
];

const stack: StackGroup[] = [
  { label: 'Frontend', items: ['Next.js 16', 'React 19', 'TypeScript', 'Tailwind v4', 'Framer Motion', 'Three.js / WebGL'] },
  { label: 'Backend', items: ['Supabase (PostgreSQL)', 'Edge Functions', 'Cloudflare Workers', 'Resend (Transactional)', 'Webhook Pipelines'] },
  { label: 'Automation', items: ['n8n (Self-hosted)', 'Claude AI / GPT-4', 'Custom Agent Mesh', 'Scheduled Jobs', 'Quality Gates'] },
  { label: 'Analytics', items: ['PostHog', 'Cloudflare Web Analytics', 'Custom Dashboards', 'Weekly Scorecards', 'A/B Test Infrastructure'] },
];

const timeline: Milestone[] = [
  { year: '2023', title: 'Founded', body: 'NixGen launched with a simple thesis: service businesses deserve the same digital quality as funded startups.' },
  { year: '2024', title: 'First 50 Clients', body: 'Delivered 50+ websites across local services, SaaS, e-commerce, and real estate. Refined our signature design system.' },
  { year: '2025', title: 'The Team Grows', body: 'Grew into a tight senior team of designers and engineers, sharpened our delivery process, and cut launch times in half.' },
  { year: '2026', title: 'Full Growth Stack', body: 'Expanded beyond websites into branding, automation, and SEO\u00a0— a complete growth partner for service businesses.' },
];

const values: Value[] = [
  { visual: 'craft', title: 'In-House Craft', body: 'We don\'t outsource the thinking. Every design decision, every line of code, every automation rule is authored in-house by senior people who own the outcome.' },
  { visual: 'scorecard', title: 'Radical Transparency', body: 'You get weekly scorecards, full code ownership, and zero lock-in. We succeed when your metrics improve\u00a0— not when you stay subscribed.' },
  { visual: 'compound', title: 'Compounding Returns', body: 'We build systems that get better over time. Automation that learns. Content that compounds. Analytics that sharpen every decision.' },
  { visual: 'sprint', title: 'Speed Without Sacrifice', body: '14-day delivery doesn\'t mean cutting corners. A focused senior team and a sharp, repeatable process let us move fast while holding staff-engineer quality.' },
];

const studioTags = ['Next.js', 'Design', 'Automation', 'Branding', 'SEO'];

const [thesis, team, valuesSection, principlesSection, journey, hardware] = sections;

export default function About() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        {/* ═══════════════ HERO ═══════════════ */}
        {/* className: the jump index is hidden below lg, but PageHero still gives it a
            grid row, so the grid's 3rem gap comes off the hero's bottom padding there. */}
        <PageHero
          className="max-lg:pb-[calc(clamp(3.5rem,8vw,7rem)-3rem)]"
          eyebrow="Studio Profile / The Operator"
          title={
            <>
              A <Accent>senior</Accent> studio for operators who refuse to look templated.
            </>
          }
          lede={
            <>
              NixGen is a small, senior studio that designs premium websites and the branding, automation, and SEO behind
              them. No juniors, no outsourcing&nbsp;— you work directly with the people who design and build your project.
            </>
          }
          aside={<AboutIndex items={sections} label="Studio Profile" />}
        />

        {/* ═══════════════ STATS ═══════════════ */}
        {/* The same four-figure band as Home and Portfolio. */}
        <section className="nx-band border-y border-line">
          <div className="nx-wrap">
            <ArchiveStats stats={stats} />
          </div>
        </section>

        {/* ═══════════════ MANIFESTO ═══════════════ */}
        <section id={thesis.anchor} className="nx-section" aria-labelledby="thesis-title">
          <div className="nx-wrap grid gap-x-16 gap-y-10 lg:grid-cols-12">
            <div className="lg:col-span-3">
              <div className="lg:sticky lg:top-[calc(var(--nx-nav-h)+2.5rem)]">
                <Reveal distance={8}>
                  <Eyebrow index={thesis.id} as="h2">
                    <span id="thesis-title">{thesis.label}</span>
                  </Eyebrow>
                </Reveal>
              </div>
            </div>

            <div className="lg:col-span-9">
              {/* A beat behind its label, so the two read in order when they arrive together. */}
              <Reveal
                as="p"
                delay={0.08}
                className="max-w-[24ch] font-heading text-[clamp(1.75rem,3.7vw,3.5rem)] font-medium leading-[1.08] tracking-[-0.034em] text-fg"
              >
                NixGen is a <Accent>senior</Accent> design and engineering studio.{' '}
                <span className="text-fg-3">
                  We build premium, editorial-grade websites and the systems behind them for service
                  businesses that want a <Accent>compounding</Accent> digital presence&nbsp;— not another deliverable pile.
                </span>
              </Reveal>

              {/* The first paragraph is the claim (set as a lede); the two that
                  back it share a row beneath, divided by hairlines. */}
              <Stagger className="mt-16 grid gap-x-10 gap-y-10 md:mt-24 md:grid-cols-2" each={0.08}>
                <StaggerItem as="p" className="nx-lede max-w-[40rem] md:col-span-2">
                  We take on a small client volume on purpose. Each engagement is treated like a product launch: architected,
                  versioned, measured, and iterated against real numbers. We don&apos;t ship themes. We ship systems that
                  make you money.
                </StaggerItem>
                <StaggerItem as="p" className="nx-body border-t border-line-2 pt-6">
                  Every project is handled directly by the senior people designing and building it&nbsp;— no juniors, no
                  outsourcing, no account-manager telephone game. You always talk to the person doing the work.
                </StaggerItem>
                <StaggerItem as="p" className="nx-body border-t border-line-2 pt-6">
                  Our north star is your result. We believe a small, sharp team using the right modern tools can out-deliver
                  a bloated agency on quality, speed, and business impact&nbsp;— and we&apos;ve built NixGen to prove it.
                </StaggerItem>
              </Stagger>
            </div>
          </div>
        </section>

        {/* ═══════════════ FOUNDER / THE STUDIO ═══════════════ */}
        <section id={team.anchor} className="nx-section nx-band border-y border-line" aria-labelledby="team-title">
          <div className="nx-wrap grid items-center gap-x-16 gap-y-14 lg:grid-cols-12">
            {/* One group, so the column reads in order however it arrives:
                label, headline, then the copy once the headline is under way. */}
            <Stagger className="lg:col-span-7 lg:pl-4" each={0.08}>
              <StaggerItem distance={8} className="mb-6">
                <Eyebrow index={team.id}>{team.label}</Eyebrow>
              </StaggerItem>
              <SplitWords as="h2" id="team-title" className="nx-h2 max-w-[16ch]">
                Built by senior people. Obsessed with your <Accent>results.</Accent>
              </SplitWords>
              <Stagger delay={0.3} each={0.08}>
                <Reveal as="p" className="nx-lede mt-10 max-w-[38rem]">
                  NixGen was founded on a simple belief: a small, senior team using the right modern tools can outperform
                  a 20-person agency in quality, speed, and business impact. Not by working harder&nbsp;— by working sharper.
                </Reveal>
                <div className="mt-10 grid gap-8 border-t border-line pt-8 sm:grid-cols-2">
                  <StaggerItem as="p" className="nx-body">
                    So we kept the team small and senior, automated the busywork, and put every hour into the things
                    that actually move your numbers&nbsp;— design, engineering, branding, and traffic.
                  </StaggerItem>
                  <StaggerItem as="p" className="nx-body">
                    The result: 200+ websites delivered, sub-14-day launch times, 96% client satisfaction, and full code
                    ownership on every project. <span className="text-fg">Staff-engineer quality at startup speed.</span>
                  </StaggerItem>
                </div>
              </Stagger>
            </Stagger>
            <Reveal variant="clip" className="lg:order-first lg:col-span-5">
              <StudioPanel
                title="The Studio"
                discipline="Senior Design + Engineering"
                body="A tight team of senior designers and engineers. The people you meet are the people who build your project&nbsp;— start to finish."
                tags={studioTags}
              />
            </Reveal>
          </div>
        </section>

        {/* ═══════════════ VALUES ═══════════════ */}
        <section id={valuesSection.anchor} className="nx-section" aria-labelledby="values-title">
          <div className="nx-wrap">
            <SectionHeader
              id="values-title"
              index={valuesSection.id}
              eyebrow={valuesSection.label}
              title={
                <>
                  What we <Accent>stand for.</Accent>
                </>
              }
            />
            <div className="mt-14 md:mt-20">
              <ValueGrid items={values} />
            </div>
          </div>
        </section>

        {/* ═══════════════ OPERATING PRINCIPLES ═══════════════ */}
        <section id={principlesSection.anchor} className="nx-section nx-band border-y border-line" aria-labelledby="principles-title">
          <div className="nx-wrap grid gap-x-16 gap-y-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <div className="lg:sticky lg:top-[calc(var(--nx-nav-h)+2.5rem)]">
                <SectionHeader
                  id="principles-title"
                  index={principlesSection.id}
                  eyebrow={principlesSection.label}
                  title={
                    <>
                      Four rules. <Accent>No exceptions.</Accent>
                    </>
                  }
                  layout="stack"
                  titleClassName="max-w-[10ch]"
                />
              </div>
            </div>
            <Stagger as="ol" className="border-t border-line lg:col-span-8" each={0.08}>
              {principles.map((p) => (
                <PrincipleRow key={p.n} principle={p} label="Principle" />
              ))}
            </Stagger>
          </div>
        </section>

        {/* ═══════════════ TIMELINE ═══════════════ */}
        <section id={journey.anchor} className="nx-section" aria-labelledby="journey-title">
          <div className="nx-wrap">
            <SectionHeader
              id="journey-title"
              index={journey.id}
              eyebrow={journey.label}
              title={
                <>
                  From studio to <Accent>AI growth OS.</Accent>
                </>
              }
              titleClassName="max-w-[16ch]"
            />
            <div className="mt-16 md:mt-24">
              <Timeline items={timeline} />
            </div>
          </div>
        </section>

        {/* ═══════════════ STACK ═══════════════ */}
        <section id={hardware.anchor} className="nx-section nx-band border-y border-line" aria-labelledby="stack-title">
          <div className="nx-wrap">
            <SectionHeader
              id="stack-title"
              index={hardware.id}
              eyebrow={hardware.label}
              title={
                <>
                  The stack behind the <Accent>monolith.</Accent>
                </>
              }
              titleClassName="max-w-[14ch]"
            />
            <div className="mt-14 md:mt-20">
              <StackList groups={stack} />
            </div>
          </div>
        </section>

        {/* ═══════════════ CTA ═══════════════ */}
        <CtaBand
          kicker={<Beacon>Taking discovery calls</Beacon>}
          title={
            <>
              Let&apos;s architect something <Accent>permanent.</Accent>
            </>
          }
          body={
            <>
              Whether you need a premium website, an automation system, or a full AI growth platform&nbsp;— the conversation
              starts with a 30-minute discovery call.
            </>
          }
          actions={
            <>
              <Button href="/contact" variant="white" size="lg" arrow magnetic>
                Book Discovery
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
