import { SiteDocument, siteMetadata, siteViewport } from "./SiteDocument";

// The site's root layout. The document itself (fonts, styles, theme boot,
// structured data, the listeners) is in SiteDocument.tsx, shared with
// app/global-not-found.tsx, which has to build its own <html>.
export const metadata = siteMetadata;
export const viewport = siteViewport;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <SiteDocument>{children}</SiteDocument>;
}
