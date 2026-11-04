// The site's document shell, shared by (site)/layout.tsx and app/global-not-found.tsx.
import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Geist, Instrument_Serif, Geist_Mono } from "next/font/google";
import "../globals.css";
import { MotionProvider } from "@/components/site/motion/MotionProvider";
import { MotionNoScript } from "@/components/site/motion/MotionNoScript";
import { AttributionCapture } from "@/components/attribution/AttributionCapture";
import { ClientErrorListeners } from "@/components/layout/ClientErrorListeners";
import { RouteAnnouncer } from "@/components/layout/RouteAnnouncer";
import { SiteJsonLd } from "@/components/layout/SiteJsonLd";
import { JsonLd } from "@/components/site/JsonLd";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { SHARED_OPEN_GRAPH, SHARED_TWITTER, SHARE_DESCRIPTION, SHARE_TITLE, SITE_NAME, SITE_URL, organizationJsonLd } from "@/lib/seo";

// Display face. It, Geist and Geist Mono are variable fonts: one file covers
// every weight, and DeskDev (app/workspace/layout.tsx) loads the same files.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display-local",
  subsets: ["latin"],
  display: "swap",
});

// Body and UI text. next/font downloads every face at build time and serves it
// from this origin, so no page asks Google for a font at runtime.
const geist = Geist({
  variable: "--font-sans-local",
  subsets: ["latin"],
  display: "swap",
});

// Italic serif for one or two accent words per headline (.nx-serif). Only the
// italic is loaded: every page preloads its fonts, and the upright face was
// painted by nothing but one decorative quotation mark.
const instrumentSerif = Instrument_Serif({
  variable: "--font-serif-local",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  display: "swap",
});

// Eyebrows, labels, numerals in tags. Geist's own mono, so the two share
// proportions and the same figure shapes.
const geistMono = Geist_Mono({
  variable: "--font-mono-local",
  subsets: ["latin"],
  display: "swap",
});

// The canonical origin, the share card and the structured data live in
// src/lib/seo.ts, so pages, the sitemap and this layout read the same values.
const DEFAULT_TITLE = "NixGen Solutions — AI-Powered Digital Systems for Service Businesses";
const DEFAULT_DESCRIPTION =
  "NixGen designs premium websites, branding, automation, and SEO for service businesses — so you book more calls, follow up automatically, and see what drives revenue. Built by a senior team of designers and engineers.";

// Pages set a bare `title` ("Services") and get "Services | NixGen Solutions".
// The share card here is the fallback: a page names itself in it through
// pageMeta() (src/lib/seo.ts), which also sets its canonical and og:url. None
// of those are set here, or every page would claim "/".
export const siteMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    ...SHARED_OPEN_GRAPH,
    images: [...SHARED_OPEN_GRAPH.images],
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
  },
  twitter: {
    ...SHARED_TWITTER,
    images: [...SHARED_TWITTER.images],
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
  },
  // app/favicon.ico (16 to 48px) is linked by the framework and stays the tab
  // icon; the PNG serves high-density tabs, the apple-touch-icon an iOS
  // home-screen bookmark, the manifest an Android one. All the same "N." tile.
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/manifest.webmanifest",
  keywords: [
    "web design",
    "AI automation",
    "revenue dashboards",
    "service business",
    "NixGen",
    "digital agency",
    "website development",
    "AI operations",
  ],
};

// What still works when JavaScript does not run (the motion kit has its own
// rule, <MotionNoScript />):
// - controls that need script are not shown at all (.nx-js-only: the menu
//   button, the footer sign-up), each with a plain fallback beside it;
// - every tab panel is laid out, one under the other, since the tabs cannot switch them
//   (inactive panels carry the `hidden` class: Tailwind's reset hides the `hidden` attribute
//   with an important rule inside a layer, which nothing here could override);
// - the bar is glass from the start, because it never learns the page scrolled.
const NOSCRIPT_CSS =
  ".nx-js-only{display:none!important}" +
  "[role=tabpanel].hidden{display:block!important}" +
  // Stacked, each at its own height (a panel is 100% of the column when only one shows), and
  // the tab list keeps its natural size beside them instead of stretching down the stack.
  "[role=tabpanel]{height:auto!important}[role=tabpanel]+[role=tabpanel]{margin-top:1.5rem}[role=tablist]{align-self:start}" +
  ".nx-nav-pill{background:var(--glass);-webkit-backdrop-filter:saturate(1.6) blur(18px);backdrop-filter:saturate(1.6) blur(18px);box-shadow:var(--shadow-md)}";

// Cloudflare Web Analytics (cookieless; the privacy page describes it). The
// token is public. Unset, as it is until the owner creates the site in the
// Cloudflare dashboard, no beacon is requested at all.
const CF_BEACON_TOKEN = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN?.trim() || "";

export const siteViewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#06080d" },
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
  ],
  colorScheme: "dark light",
};

/**
 * The site's whole document: <html> with the fonts, the theme boot script and
 * the structured data, and <body> with the providers and the listeners that
 * render nothing. (site)/layout.tsx wraps every page in it, and
 * app/global-not-found.tsx the 404 for a path no route matches.
 */
export function SiteDocument({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${geist.variable} ${instrumentSerif.variable} ${geistMono.variable}`}
    >
      <head>
        {/* Sets data-theme before first paint (no flash) and arms reveal states. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Who publishes the site: only facts it already states (name, domain, logo, the
            contact address). Blocks that depend on the page are rendered in the body. */}
        <JsonLd data={organizationJsonLd()} />
        {/* Without JavaScript, motion-kit entrances are shown at once (never stuck invisible). */}
        <MotionNoScript />
        <noscript dangerouslySetInnerHTML={{ __html: `<style>${NOSCRIPT_CSS}</style>` }} />
      </head>
      <body>
        {/* Framer Motion kit (components/site/motion): LazyMotion + reduced-motion config. */}
        <MotionProvider>{children}</MotionProvider>
        {/* Structured data that follows from the path: WebSite, breadcrumbs, the Service list. */}
        <SiteJsonLd />
        {/* Client-side navigation: names the new page to screen readers and moves focus to <main>. */}
        <RouteAnnouncer />
        {/* First and last touch (UTM, referrer) in sessionStorage, sent with a project brief. Renders nothing. */}
        <AttributionCapture />
        {/* Uncaught errors and unhandled rejections, scrubbed, to /api/client-errors. Renders nothing. */}
        <ClientErrorListeners />
        {CF_BEACON_TOKEN && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
          />
        )}
      </body>
    </html>
  );
}
