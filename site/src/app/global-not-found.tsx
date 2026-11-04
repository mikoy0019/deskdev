import type { Metadata } from 'next';
import { SiteDocument, siteMetadata, siteViewport } from './(site)/SiteDocument';
import NotFound from './(site)/not-found';

// The 404 for a path that no route matches. The app has two root layouts
// ((site) and workspace) and none above them, so Next.js has no layout to put
// (site)/not-found.tsx in for such a path and would show its plain default
// page. This builds the site's own document around the designed 404 instead
// (next.config.ts turns the file on: experimental.globalNotFound). Unknown
// paths under /workspace never get here: DeskDev's catch-all route takes them.
export const metadata: Metadata = {
  ...siteMetadata,
  title: 'Page not found | NixGen Solutions',
};
export const viewport = siteViewport;

export default function GlobalNotFound() {
  return (
    <SiteDocument>
      <NotFound />
    </SiteDocument>
  );
}
