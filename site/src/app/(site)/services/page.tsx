import { pageMeta } from '@/lib/seo';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { SectionHeader } from '@/components/site/SectionHeader';
import { Faq } from '@/components/site/Faq';
import { CtaBand } from '@/components/site/CtaBand';
import { Button } from '@/components/site/Button';
import { Accent, Beacon } from '@/components/site/Typography';
import { ServiceIndex } from '@/components/site/services/ServiceIndex';
import { CapabilityBlock, type CapabilityLabels } from '@/components/site/services/CapabilityBlock';
import { AddOnList } from '@/components/site/services/AddOnList';
import { StackBento, StackMotionScope, StackPauseButton, type StackTile } from '@/components/site/services/StackBento';
import { Magnetic } from '@/components/site/motion';
import type { AddOn, Capability } from '@/components/site/services/types';

// Description = the hero's own words (h1 + the lede's first and last sentences).
export const metadata = pageMeta({
  title: 'Services',
  description:
    'Six services. One compounding advantage. Each capability is a standalone revenue system. Every system includes deployment, analytics, and post-launch support.',
  path: '/services',
});

// `anchor` is each section's id — the footer links to /services#<anchor>.
const capabilities: Capability[] = [
  {
    id: '01',
    anchor: 'conversion',
    title: 'Conversion Websites',
    tagline: 'Editorial. Kinetic. Unfair.',
    body: 'Premium website systems engineered as revenue assets. Built like a brand launch\u00a0— not a template. Each site combines editorial-grade design, motion architecture, and conversion-first information hierarchy. We use Next.js 16, React 19, Three.js for 3D experiences, and Framer Motion for cinematic scroll animations.',
    deliverables: [
      'Brand system + visual direction',
      'Architectural layout + copy framework',
      'Next.js engineering + deployment',
      '3D / WebGL hero experiences',
      'A/B test infrastructure',
      'Post-launch optimization sprints',
      'SEO architecture + schema markup',
      'Mobile-first responsive design',
    ],
    timeline: '14–30 days',
    price: 'From $2,500/month',
    results: ['+312% organic traffic (Hike Wales)', '+142% conversion rate (Crave Fragrances)', '#1 local rankings (Four States Concrete)'],
  },
  {
    id: '02',
    anchor: 'automation',
    title: 'Automation Systems',
    tagline: 'Leverage that compounds.',
    body: 'End-to-end automation for lead capture, follow-up, fulfillment, and reporting. We deploy autonomous workflows that eliminate manual ops and collapse response times to seconds. Built on n8n (self-hosted), Claude AI, and custom webhook pipelines.',
    deliverables: [
      'CRM integration + lead routing',
      'AI-powered outreach sequences',
      'Scheduled agents (n8n / custom)',
      'Slack / email notification ops',
      'Dashboard health monitoring',
      'SOP documentation',
      'Custom webhook pipelines',
      'GoHighLevel / HubSpot integration',
    ],
    timeline: '7–21 days',
    price: 'From $3,500/month',
    results: ['+267% quote requests (Four States Concrete)', '0s response time (automated)', '20+ hrs/week saved per client'],
  },
  {
    id: '03',
    anchor: 'dashboards',
    title: 'Revenue Dashboards',
    tagline: 'One instrument panel.',
    body: "Custom KPI command centers. Campaign analytics, conversion tracking, forecasting, and execution visibility unified in a single surface. Built on Supabase and Cloudflare for real-time leverage. Every metric you need, none you don't.",
    deliverables: [
      'Custom metrics + data modeling',
      'Real-time visualizations (Recharts)',
      'Forecasting + trend analysis',
      'Drill-down UX per channel',
      'Role-based access control',
      'Weekly scorecard exports',
      'API integrations (GA4, CRM, Ad Platforms)',
      'Custom alerting + anomaly detection',
    ],
    timeline: '14–28 days',
    price: 'From $5,000/month',
    results: ['Live KPIs in one panel', 'Forecasting + drill-down by channel', 'Weekly scorecards shipped'],
  },
  {
    id: '04',
    anchor: 'operations',
    title: 'AI Operations',
    tagline: 'Your leverage, compounded.',
    body: 'Smart AI assistants handle outreach, fulfillment, and weekly reporting so your team stays focused on the work that closes deals. We design, deploy, and maintain the whole system for you.',
    deliverables: [
      'Agent mesh architecture',
      'RAG pipelines over your data',
      'Voice interfaces (optional)',
      'Autonomous revenue loops',
      'Quality-gated execution',
      'Continuous evaluation framework',
      'Self-evolution engine integration',
      'Custom skill authoring',
    ],
    timeline: '21–45 days',
    price: 'From $2,000/month',
    results: ['0s response time (automated)', '20+ hrs/week saved per client', 'Follow-up on every lead, 24/7'],
  },
  {
    id: '05',
    anchor: 'branding',
    title: 'Branding & Identity',
    tagline: 'Look the part. Instantly.',
    body: 'A complete brand system that makes you look established and trustworthy from the first impression. Logo, color, typography, and voice\u00a0— designed to be distinct, consistent, and built to last across every touchpoint.',
    deliverables: [
      'Logo design + variations',
      'Color system + palette',
      'Typography system',
      'Brand guidelines document',
      'Social media templates',
      'Messaging + tone of voice',
      'Business card / collateral',
      'Asset handoff (full ownership)',
    ],
    timeline: '7–14 days',
    price: 'From $1,000/month',
    results: ['Cohesive brand across every channel', 'Instant credibility with prospects', 'Templates your team can reuse'],
  },
  {
    id: '06',
    anchor: 'seo',
    title: 'SEO & Visibility',
    tagline: 'Get found first.',
    body: 'Show up for the people already searching for what you sell. Technical SEO, content architecture, and local optimization that climbs rankings and brings in qualified traffic on autopilot\u00a0— no ad spend required.',
    deliverables: [
      'Technical SEO audit + fixes',
      'Keyword + content strategy',
      'On-page optimization',
      'Local SEO + Google Business',
      'Schema markup',
      'Site speed optimization',
      'Backlink foundation',
      'Monthly rank tracking',
    ],
    timeline: 'Ongoing',
    price: 'From $1,000/month',
    results: ['#1 local rankings (Four States Concrete)', '+312% organic traffic (Hike Wales)', 'Qualified traffic on autopilot'],
  },
];

const capabilityLabels: CapabilityLabels = {
  deliverables: 'Deliverables',
  results: 'Proven Results',
  cta: 'Start This System',
  ctaHref: '/contact',
};

const addOns: AddOn[] = [
  { title: 'Brand Identity Package', price: '$1,500', body: 'Logo, color system, typography, brand guidelines, and social templates.' },
  { title: 'Content Engine', price: '$2,000/mo', body: 'Weekly blog posts, social content, and SEO articles. AI-drafted, human-edited.' },
  { title: 'Monthly Retainer', price: '$1,500/mo', body: 'Ongoing optimization, analytics review, A/B testing, and priority support.' },
  { title: '3D / WebGL Experience', price: '$3,000', body: 'Custom Three.js hero scene, interactive 3D product viewer, or immersive scroll experience.' },
  { title: 'E-commerce Integration', price: '$2,500', body: 'Shopify, Stripe, or custom checkout with inventory management and automated post-purchase flows.' },
  { title: 'Voice Agent Setup', price: '$4,000', body: 'AI voice agent for inbound calls, appointment scheduling, and lead qualification. GoHighLevel integration.' },
];

// "How they stack": one tile per system that the illustration shows working on the same lead.
const stackTiles: StackTile[] = [
  { anchor: 'conversion', title: 'Conversion Websites', caption: 'The site takes the quote request and confirms it the moment it is sent.' },
  { anchor: 'automation', title: 'Automation Systems', caption: 'Each new lead is ranked and routed to the right person as it arrives.' },
  { anchor: 'operations', title: 'AI Operations', caption: 'Assistants draft the follow-ups and the weekly report when asked.' },
  { anchor: 'dashboards', title: 'Revenue Dashboards', caption: 'Every number the other systems produce lands in one panel.' },
];

const faqItems = [
  { question: 'Can I combine multiple systems?', answer: 'Absolutely. Most Growth and Dominance clients combine 2–3 systems. We architect them as one unified platform so data flows seamlessly between your website, automation, dashboard, and AI agents.' },
  { question: 'What CRMs do you integrate with?', answer: 'GoHighLevel, HubSpot, Salesforce, Monday.com, Pipedrive, and any CRM with an API. We also build custom CRM solutions on Supabase for clients who want full ownership.' },
  { question: 'Do you offer ongoing support?', answer: 'Every engagement includes 30–90 days of post-launch support. For ongoing optimization, analytics, and priority access, we offer monthly retainers starting at $1,500/mo.' },
  { question: 'What is the ROI timeline?', answer: 'Most clients see measurable results within 30 days of launch. Website traffic improvements are visible within 2 weeks. Automation ROI is immediate\u00a0— you stop losing leads from day one.' },
];

export default function Services() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        {/* ═══════════════ HERO ═══════════════ */}
        {/* className: the jump index is hidden below lg, but PageHero still gives it a
            grid row, so the grid's 3rem gap comes off the hero's bottom padding there. */}
        <PageHero
          className="max-lg:pb-[calc(clamp(3.5rem,8vw,7rem)-3rem)]"
          eyebrow="Capability Matrix / Full Spectrum"
          title={
            <>
              Six services. <Accent>One compounding</Accent> advantage.
            </>
          }
          lede={
            <>
              Each capability is a standalone revenue system. Stacked, they become a revenue operations platform engineered
              against your specific business. Every system includes deployment, analytics, and post-launch support.
            </>
          }
          aside={<ServiceIndex items={capabilities} label="Capability Matrix" />}
        />

        {/* ═══════════════ CAPABILITY DETAIL ═══════════════ */}
        <div>
          {/* The flagship gets the full-width composition; after it the identity column alternates sides. */}
          {capabilities.map((c, i) => (
            <CapabilityBlock
              key={c.anchor}
              capability={c}
              labels={capabilityLabels}
              layout={i === 0 ? 'feature' : i % 2 === 0 ? 'mirrored' : 'standard'}
            />
          ))}
        </div>

        {/* ═══════════════ HOW THEY STACK ═══════════════ */}
        <section className="nx-section border-t border-line" aria-labelledby="stack-title">
          <StackMotionScope>
            <div className="nx-wrap">
              <SectionHeader
                id="stack-title"
                eyebrow="How They Stack"
                title={
                  <>
                    One lead, through <Accent>every system.</Accent>
                  </>
                }
                lede="Each panel shows one system at work on the same inbound lead. Names and figures are sample data."
                aside={<StackPauseButton pause="Pause motion" play="Play motion" />}
              />
              <div className="mt-14 md:mt-20">
                <StackBento tiles={stackTiles} sample="Sample data" />
              </div>
            </div>
          </StackMotionScope>
        </section>

        {/* ═══════════════ ADD-ONS ═══════════════ */}
        <section className="nx-section nx-band border-y border-line" aria-labelledby="add-ons-title">
          <div className="nx-wrap">
            <SectionHeader
              id="add-ons-title"
              eyebrow="Add-Ons"
              title={
                <>
                  Expand any system with <Accent>precision modules.</Accent>
                </>
              }
              titleClassName="max-w-[15ch]"
            />
            <div className="mt-14 md:mt-20">
              <AddOnList items={addOns} />
            </div>
          </div>
        </section>

        {/* ═══════════════ FAQ ═══════════════ */}
        <section className="nx-section" aria-labelledby="services-faq-title">
          <div className="nx-wrap grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <div className="lg:sticky lg:top-[calc(var(--nx-nav-h)+2.5rem)]">
                <SectionHeader
                  id="services-faq-title"
                  eyebrow="Service Questions"
                  title={
                    <>
                      Common <Accent>questions</Accent> about our systems.
                    </>
                  }
                  layout="stack"
                />
              </div>
            </div>
            <div className="lg:col-span-7">
              <Faq items={faqItems} name="faq-services" />
            </div>
          </div>
        </section>

        {/* ═══════════════ CTA ═══════════════ */}
        {/* pt-0: the FAQ's bottom padding already sets the gap (two stacked section paddings left ~320px of air). */}
        <CtaBand
          className="pt-0"
          kicker={<Beacon>Taking discovery calls</Beacon>}
          title={
            <>
              Not sure which <Accent>system fits?</Accent>
            </>
          }
          body={
            <>
              Book a 30-minute discovery call. We&apos;ll audit your current stack, identify the highest-leverage
              intervention, and scope a proposal&nbsp;— complete with timeline, deliverables, and expected ROI.
            </>
          }
          actions={
            <>
              <Magnetic>
                <Button href="/contact" variant="white" size="lg" arrow>
                  Book Discovery
                </Button>
              </Magnetic>
              <Magnetic>
                <Button href="/portfolio" variant="outline-white" size="lg">
                  See Proof
                </Button>
              </Magnetic>
            </>
          }
        />
      </main>

      <Footer />
    </div>
  );
}
