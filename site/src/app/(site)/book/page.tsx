import type { Metadata } from 'next';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { Accent, Beacon } from '@/components/site/Typography';
import { BookingWidget } from '@/components/site/booking/BookingWidget';

// Book a call: open times from the studio's real calendar (business hours
// from DeskDev, minus Google and DeskDev busy time), shown in the visitor's
// own time zone. Booking records a meeting on the lead in DeskDev and sends a
// Google Calendar invite with a Meet link (src/lib/booking.ts).
//
// Open times are fetched by the browser on every visit (/api/booking/slots),
// so the page itself carries no time-sensitive data. ?name= and ?email=
// (from DeskDev's "Send booking link") prefill the form; they are read here
// and passed down, never logged.

export const metadata: Metadata = {
  title: 'Book a call',
  description:
    'Pick a time for a discovery call with NixGen. See open times in your own time zone and get a Google Calendar invite with a Meet link right away.',
  alternates: { canonical: '/book' },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function param(value: string | string[] | undefined, max: number): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const clean = v?.trim().slice(0, max);
  return clean || undefined;
}

export default async function BookPage({ searchParams }: Props) {
  const sp = await searchParams;
  const prefill = { name: param(sp.name, 120), email: param(sp.email, 254) };

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        <PageHero
          eyebrow={<Beacon>Calendar / Open times</Beacon>}
          title={
            <>
              Book a <Accent>call.</Accent>
            </>
          }
          lede={
            <>
              Pick a time that suits you. We&apos;ll talk through your goals, scope and budget, and you&apos;ll leave with a
              clear next step. Times are shown in your own time zone.
            </>
          }
        />

        <section aria-label="Booking" className="relative border-t border-line pt-[var(--nx-section)] pb-[calc(var(--nx-section)+1.5rem)]">
          <div className="nx-wrap">
            {/* The contact page's double bezel: a tinted tray around the inner core. */}
            <div className="mx-auto max-w-4xl rounded-[1.75rem] bg-[color-mix(in_oklab,var(--fg)_3.5%,transparent)] p-1.5 shadow-[var(--shadow-lg)] ring-1 ring-line sm:rounded-[2rem] sm:p-2">
              <div className="rounded-[calc(1.75rem-0.375rem)] bg-surface p-6 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--fg)_7%,transparent)] sm:rounded-[calc(2rem-0.5rem)] sm:p-10 xl:p-14">
                <BookingWidget prefill={prefill} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
