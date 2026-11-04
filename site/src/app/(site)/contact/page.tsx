import { pageMeta } from '@/lib/seo';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { Accent, Beacon, Eyebrow } from '@/components/site/Typography';
import { Stagger, StaggerItem } from '@/components/site/motion';
import { ChannelList } from '@/components/site/contact/ChannelList';
import { ContactForm } from '@/components/site/contact/ContactForm';
import { ResponseReadout } from '@/components/site/contact/ResponseReadout';
import type { Channel } from '@/components/site/contact/types';

export const metadata = pageMeta({
  title: 'Contact',
  description:
    "Every great project starts with a conversation. Tell us about your business, your goals, and the problems you need solved. We'll respond within 12 hours with a strategy outline.",
  path: '/contact',
});

const channels: Channel[] = [
  { label: 'Email', value: 'nixgensolutions@gmail.com', href: 'mailto:nixgensolutions@gmail.com' },
  { label: 'Phone', value: '+1 (555) 123-4567', href: 'tel:+15551234567' },
  // The scheduling page: open times from the team calendar, booked straight into DeskDev.
  { label: 'Calendar', value: 'Book a call', href: '/book' },
  { label: 'Response', value: 'Within 12 hours', href: null },
  { label: 'Location', value: 'Remote / Worldwide', href: null },
];

const budgets = ['$2.5K — $5K', '$5K — $10K', '$10K — $25K', '$25K+'];
const systems = ['Website', 'Automation', 'Dashboard', 'AI Operations', 'Full Stack'];
// LEAD_TIMELINES (deskdev/lib/leads.ts), copied so the page does not pull the
// workspace's data layer in. The key is what the lead stores and scores on.
const timelines = [
  { key: 'asap', label: 'As soon as possible' },
  { key: '1_3_months', label: 'In 1–3 months' },
  { key: '3_6_months', label: 'In 3–6 months' },
  { key: '6_plus_months', label: 'In 6+ months' },
  { key: 'exploring', label: 'Just exploring' },
];

const response = channels.find((c) => c.label === 'Response') ?? channels[3];

export default function Contact() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        {/* ═══════════════ HERO ═══════════════ */}
        <PageHero
          eyebrow={<Beacon>Direct Line / Signal Open</Beacon>}
          title={
            <>
              Let&apos;s build something <Accent>exceptional.</Accent>
            </>
          }
          lede={
            <>
              Every great project starts with a conversation. Tell us about your business, your goals, and the problems
              you need solved. We&apos;ll respond within 12 hours with a strategy outline.
            </>
          }
          aside={<ResponseReadout channel={response} />}
        />

        {/* ═══════════════ CONTACT PANEL ═══════════════
            Editorial split: the direct lines read down the left (sticky beside
            the brief on desktop), the brief sits on the right as the one
            machined object on the page — a double bezel (tinted tray + inner
            core with a top highlight). */}
        <section
          aria-labelledby="channels-title"
          className="relative border-t border-line pt-[var(--nx-section)] pb-[calc(var(--nx-section)+1.5rem)]"
        >
          <div className="nx-wrap grid gap-x-16 gap-y-16 lg:grid-cols-12">
            {/* LEFT — Channels readout. One group entrance (60ms apart) the first time it scrolls in. */}
            <div className="lg:col-span-5">
              <Stagger className="flex flex-col gap-10 lg:sticky lg:top-[calc(var(--nx-nav-h)+2.5rem)] lg:pt-[3rem] xl:pt-[4rem]">
                <div>
                  <StaggerItem>
                    {/* Below lg the brief sits above this column, so "02" would be read before "01": the numerals step aside there. */}
                    <Eyebrow as="h2" index="01" className="mb-6 max-lg:[&_.nx-eyebrow-index]:hidden max-lg:[&_.nx-eyebrow-line]:hidden">
                      <span id="channels-title">Channels</span>
                    </Eyebrow>
                  </StaggerItem>
                  <StaggerItem as="p" className="nx-lede max-w-md">
                    Reach the studio directly. Every inquiry is read by a human within 12 hours&nbsp;— no intake form
                    routing, no bots, no gatekeepers.
                  </StaggerItem>
                </div>

                <ChannelList channels={channels} shownInHero={response.label} />

                {/* Availability: set flat in the column's own hairline language, so the
                    brief stays the page's only raised object (and two trays never stack on phones). */}
                <StaggerItem className="grid gap-x-6 gap-y-4 sm:grid-cols-[7.5rem_1fr]">
                  <Eyebrow as="h3" className="self-start pt-1 text-accent-text">
                    Availability
                  </Eyebrow>
                  <div>
                    <p className="nx-body max-w-[46ch]">
                      We take a limited number of clients per quarter to maintain quality. Currently accepting projects for
                      Q2 2026.
                    </p>
                    <p className="mt-5">
                      <Beacon>2 slots remaining</Beacon>
                    </p>
                  </div>
                </StaggerItem>
              </Stagger>
            </div>

            {/* RIGHT — Project brief. Not revealed on scroll: it is the anchor target and the thing people came to use. */}
            {/* Below lg the brief comes first: it is what every "Get started" link lands here for. */}
            <div className="max-lg:order-first lg:col-span-7">
              {/* #form is where every "Get started" link lands: on the brief itself. The Calendar line goes to /book. */}
              <div
                id="form"
                className="scroll-mt-[calc(var(--nx-nav-h)+1.5rem)] rounded-[1.75rem] bg-[color-mix(in_oklab,var(--fg)_3.5%,transparent)] p-1.5 shadow-[var(--shadow-lg)] ring-1 ring-line sm:rounded-[2rem] sm:p-2"
              >
                <div className="rounded-[calc(1.75rem-0.375rem)] bg-surface p-6 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--fg)_7%,transparent)] sm:rounded-[calc(2rem-0.5rem)] sm:p-10 xl:p-14">
                  <ContactForm systems={systems} budgets={budgets} timelines={timelines} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
