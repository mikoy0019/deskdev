import { pageMeta } from '@/lib/seo';
import { Navbar } from '@/components/layout/Navbar';
import { FrameLoader } from '@/components/site/templates/FrameLoader';
import { GallerySkeleton } from '@/components/site/templates/Skeletons';

export const metadata = pageMeta({
  title: 'Template Gallery',
  description: 'The NixGen Template Gallery: 128 hand-crafted PRO website templates, searchable by type, each one live to open.',
  path: '/templates',
});

/**
 * The gallery is a static document (public/templates/gallery.html) with its own
 * filters, search and infinite grid. It reads the same `nixgen-theme` cookie /
 * localStorage pair as the site and follows the navbar toggle live (storage event).
 *
 * The page itself never scrolls: it is an app shell, so 100dvh (it tracks the phone's
 * collapsing browser bar), and the frame fills the viewport under the floating navbar,
 * so the iframe owns the only scrollbar.
 *
 * From md up the frame is a double bezel: a hairline tray (outer shell) holding the
 * gallery plate (inner core) with a concentric radius, so it reads as a framed object
 * under the floating nav rather than an embed glued to the page. Phones get the full width.
 */
export default function TemplatesPage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <Navbar />
      <main className="flex min-h-0 flex-1 flex-col pt-[var(--nx-nav-h)] md:px-3 md:pt-[calc(var(--nx-nav-h)+0.5rem)]">
        <h1 className="sr-only">NixGen Template Gallery</h1>
        <div className="flex min-h-0 flex-1 border-t border-line md:rounded-t-[2rem] md:border-t-0 md:bg-surface-2/60 md:p-1.5 md:pb-0 md:ring-1 md:ring-line">
          <FrameLoader
            src="/templates/gallery.html"
            title="NixGen Template Gallery"
            skeleton={<GallerySkeleton />}
            className="min-h-0 flex-1 overflow-hidden bg-bg md:rounded-t-[calc(2rem-0.375rem)] md:shadow-[var(--shadow-md)]"
          />
        </div>
      </main>
    </div>
  );
}
