import Link from 'next/link';
import { Suspense } from 'react';
import { AddressBookIcon, EnvelopeSimpleIcon, HashIcon, KanbanIcon } from '@phosphor-icons/react/ssr';
import { Accent } from '@/components/site/Typography';
import { ThemeToggle } from '@/components/site/ThemeToggle';
import { SplitWords, Stagger, StaggerItem } from '@/components/site/motion';
import { Wordmark } from '@/components/site/login/Wordmark';
import { LoginStyles } from '@/components/site/login/LoginStyles';
import { CONTACT_EMAIL, pageMeta } from '@/lib/seo';

// Named like every other page ("Team login | NixGen Solutions"), with its own share card and
// og:url instead of the home page's. Still kept out of search results.
export const metadata = {
  ...pageMeta({
    title: 'Team login',
    description: 'Your projects, clients, meetings and team chat — all in one place.',
    path: '/login',
  }),
  robots: { index: false, follow: false },
};

// What the workspace holds, each with its own hairline icon (Phosphor light: decorative, ≥ 18px).
const HIGHLIGHTS = [
  { label: 'Projects & tasks', Icon: KanbanIcon },
  { label: 'Clients & CRM', Icon: AddressBookIcon },
  { label: 'Team channels', Icon: HashIcon },
];

// An empty studio interior (concrete, steel, daylight) rather than a stock "team at laptops" shot:
// it sets the place the headline names without staged people. Served from /public/login (WebP
// exports of Unsplash photo 1497366811353-6870744d04b2), so the sign-in page asks no third party
// for its largest paint.
// The 3:2 photo is object-cover'd into a box that is about 52vw wide and 100dvh tall, so the
// rendered width is max(52vw, 1.5 × viewport height); the 2400w file covers 2x laptop screens.
// Desktop only: phones (panel hidden) never request it.
const PANEL_SRCSET = [1000, 1600, 2400].map((w) => `/login/studio-${w}.webp ${w}w`).join(', ');

const PANEL_SIZES = 'max(52vw, 150vh)';
// 1x1 transparent GIF: the <img> fallback below lg, so phones download nothing.
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const FOOTER_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/contact', label: 'Contact' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

/**
 * Split-screen shell for the team login (layout archetype: Editorial Split). The photo plate,
 * header and footer live here, outside the Suspense boundary, so they hydrate with the root and
 * use the site motion kit. The page (the form card) reads useSearchParams(), which needs the
 * Suspense boundary; it hydrates later, so its entrance is CSS (see LoginStyles).
 *
 * Motion (Emil's gate; the login is a rare, first-visit surface on the marketing site):
 * - The photo fades in with CSS from first paint (nx-intro-fade). It is the page's largest
 *   paint, so it never waits for hydration the way a motion-kit reveal does.
 * - The plate copy enters as one Stagger, 60ms apart, with the headline rising word by word out
 *   of its line masks.
 * - The Stagger uses the in-view trigger rather than `load`. The plate fills the viewport, so it
 *   fires on the first frame anyway, but an IntersectionObserver callback always lands after
 *   hydration has settled the reduced-motion preference (a load trigger can start with motion
 *   first). It also never fires for the display:none plate on phones, so they do no animation
 *   work for it.
 * - The header (navigation and the theme toggle) never animates.
 * - No perpetual loops. Nothing here carries live state, so a loop would only be decoration.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-[100dvh] bg-bg lg:grid-cols-[52fr_48fr]">
      <LoginStyles />

      {/* ═══════════════ RIGHT — form panel (follows the theme) ═══════════════ */}
      <main className="relative isolate flex min-w-0 flex-col overflow-hidden px-4 pb-6 pt-4 sm:px-10 sm:pb-8 sm:pt-8 lg:col-start-2 lg:row-start-1 lg:pt-10 xl:px-14 xl:pt-12">
        <div className="nx-grid-bg pointer-events-none absolute inset-0 -z-10 opacity-50" aria-hidden />

        <header className="flex items-center justify-between gap-4">
          <span className="lg:hidden">
            <Wordmark compact />
          </span>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <Link
              href="/"
              className="nx-link nx-login-link min-h-11 whitespace-nowrap text-[0.875rem] font-medium text-fg-2 hover:text-fg"
            >
              <span className="hidden sm:inline">Back to nixgensolutions.com →</span>
              <span className="sm:hidden">Back to site →</span>
            </Link>
            <span className="h-5 w-px bg-line-2" aria-hidden />
            <ThemeToggle />
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center py-12 lg:py-10">
          {/* The page reads useSearchParams(), which needs a Suspense boundary. */}
          <Suspense>{children}</Suspense>
          {/* The form arrives through that boundary, which only a script can swap in: without
              JavaScript this line stands where the card would be. */}
          <noscript>
            <p className="nx-body max-w-sm text-center">
              Signing in needs JavaScript. Turn it on and reload, or email{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-fg underline decoration-line-2 underline-offset-4">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </noscript>
        </div>

        <footer className="flex flex-col items-center justify-center gap-x-6 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-fg-3 sm:flex-row">
          <span className="py-2 sm:py-0">© {new Date().getFullYear()} NixGen Solutions</span>
          <nav aria-label="Site" className="flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-6">
            {FOOTER_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors duration-200 ease-[ease] hover:text-fg"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </footer>
      </main>

      {/* ═══════════════ LEFT — photo plate (desktop) ═══════════════
          Double bezel: the plate sits in a hairline tray inset from the viewport edge, so it reads
          as a framed object rather than a full-bleed stock photo. Dark scrim in both themes.
          Sticky + viewport-tall: the plate stays put if the form side ever outgrows the screen.
          Comes after <main> in the source so the form's h1 and fields lead reading / tab order;
          grid placement puts it back on the left. */}
      <aside className="hidden p-3 lg:sticky lg:top-0 lg:col-start-1 lg:row-start-1 lg:block lg:h-[100dvh] lg:self-start xl:p-4">
        <div className="h-full rounded-[2rem] bg-surface-2/70 p-1.5 ring-1 ring-line">
          <div className="nx-login-plate relative isolate flex h-full flex-col overflow-hidden rounded-[calc(2rem-0.375rem)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]">
            <div className="nx-intro-fade absolute inset-0 -z-20">
              {/* The aside is display:none below lg, but browsers still fetch an eager <img> in a
                  hidden ancestor, so the photo only comes from the desktop <source>. */}
              <picture className="block h-full w-full">
                <source media="(min-width: 1024px)" srcSet={PANEL_SRCSET} sizes={PANEL_SIZES} />
                <img
                  src={BLANK_PIXEL}
                  alt=""
                  width={1600}
                  height={1068}
                  className="h-full w-full object-cover grayscale-[0.7] contrast-[1.05]"
                  loading="eager"
                  fetchPriority="high"
                />
              </picture>
            </div>
            {/* Neutral scrim in the page's own ink (no coloured wash): dark under the wordmark and
                the copy, open in the middle so the photo still reads. */}
            <div className="nx-login-scrim pointer-events-none absolute inset-0 -z-10" aria-hidden />

            <Stagger className="flex h-full flex-col justify-between p-10 xl:p-12">
              <StaggerItem variant="fade">
                <Wordmark tone="photo" />
              </StaggerItem>

              <div>
                <SplitWords
                  as="h2"
                  className="nx-h2 max-w-[13ch] !text-white text-[clamp(2.75rem,4.3vw,4.5rem)]"
                >
                  Welcome back
                  <br />
                  to the <span className="text-[var(--plate-ink)]"><Accent>studio.</Accent></span>
                </SplitWords>
                <StaggerItem
                  as="p"
                  className="mt-6 max-w-[38ch] text-pretty text-[1.0625rem] leading-relaxed text-white/75"
                >
                  Your projects, clients, meetings and team chat&nbsp;— all in one place.
                </StaggerItem>

                {/* An editorial index rather than three equal columns: one hairline-ruled row per
                    area, the mark trailing. Each row carries its own top rule, so the rules draw in
                    with the rows instead of sitting alone on the plate before they arrive. */}
                <Stagger as="ul" className="mt-10" aria-label="Inside the workspace">
                  {HIGHLIGHTS.map(({ label, Icon }, i) => (
                    <StaggerItem
                      as="li"
                      key={label}
                      className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center border-t border-white/15 py-3.5"
                    >
                      <span className="font-mono text-[0.6875rem] tabular-nums tracking-[0.08em] text-white/50" aria-hidden>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[0.9375rem] font-medium tracking-[-0.005em] text-white/90">{label}</span>
                      <Icon size={22} weight="light" className="text-[var(--plate-ink)]" aria-hidden />
                    </StaggerItem>
                  ))}
                </Stagger>

                <StaggerItem className="flex justify-end border-y border-white/15 py-1.5">
                  <a
                    href="mailto:nixgensolutions@gmail.com"
                    className="nx-link nx-login-link min-h-11 text-[0.875rem] font-medium text-white/85 hover:text-white"
                  >
                    <EnvelopeSimpleIcon size={16} aria-hidden />
                    nixgensolutions@gmail.com
                  </a>
                </StaggerItem>
              </div>
            </Stagger>
          </div>
        </div>
      </aside>
    </div>
  );
}
