import type { Metadata } from 'next';
import Link from 'next/link';
import { cache, type ReactNode } from 'react';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/ssr';
import { Button } from '@/components/site/Button';
import { ThemeToggle } from '@/components/site/ThemeToggle';
import { Accent, Eyebrow } from '@/components/site/Typography';
import { QuickForm } from '@/components/site/forms/QuickForm';
import { isAnswered } from '@/deskdev/lib/forms';
import { readFormLink, type FormLinkRead } from '@/lib/formLinks';

// A customer quick form: DeskDev sends a private link to /f/<token> for a
// lead's discovery form or a project's onboarding form (migration 047). This
// page reads the link on the server and hands the client component ONLY the
// template's customer view and the answers to those fields (readFormLink
// filters both); the team's internal notes never reach the browser.
//
// Private by construction: rendered per request (never cached or statically
// generated), noindex, and no Referer — the token is in the URL, so no link
// or asset on this page may carry it to another site.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

const EMAIL = 'nixgensolutions@gmail.com';

// generateMetadata and the page read the same link once per request.
const readOnce = cache((token: string): Promise<FormLinkRead> => readFormLink(token));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const link = await readOnce((await params).token);
  const title = link.status === 'open' || link.status === 'submitted' ? link.template.title : 'Your form';
  return {
    title: { absolute: `${title} — NixGen Solutions` },
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  };
}

function firstNameOf(name: string | null): string | null {
  return name?.split(/\s+/)[0] || null;
}

/** "October 20" — the date a link stops working (dates in UTC, like the database's). */
function untilLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** The focused shell: the studio's mark, the theme toggle, nothing to wander off to. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col bg-bg">
      <div className="nx-grid-bg pointer-events-none absolute inset-0 -z-10 opacity-50" aria-hidden />
      <div className="nx-aura pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] opacity-80" aria-hidden />
      <header className="nx-wrap flex items-center justify-between gap-4 pt-4 sm:pt-6">
        <Link href="/" className="inline-flex min-h-11 items-center" aria-label="NixGen Solutions — home">
          <span className="font-heading text-[1.1rem] font-semibold tracking-[0.14em] text-fg">
            NIXGEN<span className="text-accent-text">.</span>
          </span>
        </Link>
        <ThemeToggle className="!h-11 !w-11" />
      </header>
      <main className="nx-wrap flex-1 pt-[clamp(2.5rem,7vw,5rem)] pb-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
      <footer className="nx-wrap flex flex-col items-center justify-center gap-x-6 pb-6 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-fg-3 sm:flex-row">
        <span className="py-2 sm:py-0">© {new Date().getFullYear()} NixGen Solutions</span>
        <a href={`mailto:${EMAIL}`} className="inline-flex min-h-11 items-center hover:text-fg">
          {EMAIL}
        </a>
      </footer>
    </div>
  );
}

/** Not found, expired, or down: what happened, and how to reach a person. */
function Notice({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children: ReactNode }) {
  return (
    <Shell>
      <Eyebrow className="mb-6">{eyebrow}</Eyebrow>
      <h1 className="nx-h1 max-w-[18ch] text-[clamp(2.25rem,5vw,3.75rem)] text-balance">{title}</h1>
      <div className="nx-lede mt-6 max-w-[52ch]">{children}</div>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button href={`mailto:${EMAIL}`} size="lg" arrow>
          Email us
        </Button>
        <Button href="/contact" variant="secondary" size="lg">
          Contact page
        </Button>
      </div>
    </Shell>
  );
}

export default async function QuickFormPage({ params }: Props) {
  const { token } = await params;
  const link = await readOnce(token);

  switch (link.status) {
    case 'not_found':
      return (
        <Notice eyebrow="Private form" title={<>This link isn&apos;t <Accent>valid.</Accent></>}>
          It may be mistyped, or it was replaced by a newer one. Email us and we&apos;ll send you a fresh link.
        </Notice>
      );
    case 'expired':
      return (
        <Notice eyebrow="Private form" title={<>This link has <Accent>expired.</Accent></>}>
          Form links stop working after a couple of weeks to keep your answers private. Email us and we&apos;ll send a
          new one.
        </Notice>
      );
    case 'not_configured':
    case 'unavailable':
    case 'timeout':
      return (
        <Notice eyebrow="Private form" title={<>We can&apos;t open this form <Accent>right now.</Accent></>}>
          Please try again in a few minutes. If it keeps happening, email us and we&apos;ll sort it out.
        </Notice>
      );
    case 'submitted': {
      const name = firstNameOf(link.context.name);
      return (
        <Shell>
          <Eyebrow className="mb-6">{link.template.title}</Eyebrow>
          <h1 className="nx-h1 max-w-[18ch] text-[clamp(2.25rem,5vw,3.75rem)] text-balance">
            Thanks{name ? `, ${name}` : ''} — <Accent>we have your answers.</Accent>
          </h1>
          <p className="nx-lede mt-6 max-w-[52ch]">
            We&apos;ll go through them before our next conversation. Need to change something? Email{' '}
            <a href={`mailto:${EMAIL}`} className="nx-link text-fg">
              {EMAIL}
            </a>
            .
          </p>
          <div className="mt-10">
            <Button href="/" variant="secondary" size="lg">
              Back to nixgensolutions.com
            </Button>
          </div>
        </Shell>
      );
    }
    case 'open': {
      const { context, template, answers } = link;
      const name = firstNameOf(context.name);
      const about = [name ? `For ${name}` : null, context.company, context.projectTitle].filter(Boolean).join(' · ');
      const until = untilLabel(link.expiresAt);
      const prefilled = Object.values(answers).some(isAnswered);
      return (
        <Shell>
          <Eyebrow className="mb-6">{about ? `Private form · ${about}` : 'Private form'}</Eyebrow>
          <h1 className="nx-h1 max-w-[20ch] text-[clamp(2.25rem,5vw,3.75rem)] text-balance">{template.title}</h1>
          <p className="nx-lede mt-6 max-w-[56ch]">{template.description}</p>
          <p className="nx-small mt-4 flex flex-wrap items-center gap-x-2">
            <EnvelopeSimpleIcon size={14} aria-hidden />
            {prefilled ? 'We filled in what we already know; correct anything that’s off.' : 'Anything you’re unsure of can stay blank.'}
            {until && <span>This link works until {until}.</span>}
          </p>

          {/* The form in the contact page's double bezel: a tinted tray around the inner core. */}
          <div className="mt-10 rounded-[1.75rem] bg-[color-mix(in_oklab,var(--fg)_3.5%,transparent)] p-1.5 shadow-[var(--shadow-lg)] ring-1 ring-line sm:rounded-[2rem] sm:p-2">
            <div className="rounded-[calc(1.75rem-0.375rem)] bg-surface p-6 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--fg)_7%,transparent)] sm:rounded-[calc(2rem-0.5rem)] sm:p-10">
              <QuickForm token={token} template={template} initialAnswers={answers} firstName={name} />
            </div>
          </div>
        </Shell>
      );
    }
  }
}
