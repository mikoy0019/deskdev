import { mapShowcaseRows, type ShowcaseItem, type ShowcaseRow } from '@/lib/showcase';

/**
 * Case-study fixtures for the test build only (`vite --mode test`: the e2e
 * build and the local demo server). The committed fallback has no featured
 * row, so without these /portfolio/<slug> can only be rendered against the
 * live database and the screen would never be seen in e2e or a design pass.
 *
 * Nothing here is a client fact: every name and figure is a placeholder, the
 * links go to example.com, and the list is empty in every other build, so a
 * production page can neither list nor serve them.
 *
 * Two shapes, so both branches of the page render: a website with a public
 * link and its own capture, and a product whose link is private and that has
 * no hosted capture (no capture section, "Private app" instead of the visit
 * button).
 */
const ROWS: ShowcaseRow[] = [
  {
    slug: 'fixture-case-study',
    kind: 'website',
    title: 'Fixture Plumbing Co.',
    url: 'https://example.com',
    link_public: true,
    industry: 'Plumbing',
    summary: 'Placeholder summary for the test build: a service business site rebuilt around one booking flow.',
    result_tag: 'Test fixture',
    stack: ['Next.js', 'Tailwind', 'Supabase'],
    accent: null,
    mockup_variant: null,
    image_key: '/products/inbox-ai.png',
    image_key_small: null,
    image_alt: 'Placeholder capture for the case-study fixture',
    image_source: 'local',
    case_study: {
      challenge:
        'Placeholder challenge. The old site buried the phone number and the booking form sat three taps deep.\n\nA second paragraph, so the lede and body styles both render.',
      approach:
        'Placeholder approach. One booking flow on every page, a quote form that asks four questions, and a rebuild of the service pages.',
      outcome: 'Placeholder outcome. The figures above are sample values, not a client result.',
      metrics: [
        { label: 'Sample metric one', value: '+00%' },
        { label: 'Sample metric two', value: '0.0s' },
        { label: 'Sample metric three', value: '00 days' },
        { label: 'Sample metric four', value: '#0' },
        { label: 'Sample metric five', value: '0,000' },
      ],
      quote: {
        text: 'Placeholder quote for the test build. It runs long enough to wrap onto a second line at phone width.',
        author: 'Sample Author',
        role: 'Owner, Fixture Plumbing Co.',
      },
    },
    featured: true,
    home_featured: false,
    sort_order: 100_000,
    launched_on: '2026-01-15',
    published_at: null,
  },
  {
    slug: 'fixture-private-app',
    kind: 'product',
    title: 'Fixture Console',
    url: 'https://app.example.com',
    link_public: false,
    industry: 'Test Fixture',
    summary: 'Placeholder summary for the test build: a login-gated app, so the page shows no visit button.',
    result_tag: null,
    stack: ['React', 'Supabase'],
    accent: '#22d3ee',
    mockup_variant: 'crm',
    image_key: null,
    image_key_small: null,
    image_alt: null,
    image_source: 'mockup',
    case_study: {
      challenge: 'Placeholder challenge for the private-app variant.',
      approach: 'Placeholder approach for the private-app variant.',
      outcome: 'Placeholder outcome for the private-app variant.',
      metrics: [
        { label: 'Sample metric one', value: '00%' },
        { label: 'Sample metric two', value: '0h' },
      ],
      quote: null,
    },
    featured: true,
    home_featured: false,
    sort_order: 100_010,
    launched_on: null,
    published_at: null,
  },
];

// Only the e2e build sets NEXT_PUBLIC_CASE_STUDY_FIXTURES (playwright.config.ts).
// A NEXT_PUBLIC_ value is inlined at build time, so every other build ships an
// empty list.
export const CASE_STUDY_FIXTURES: readonly ShowcaseItem[] =
  process.env.NEXT_PUBLIC_CASE_STUDY_FIXTURES === '1' ? mapShowcaseRows(ROWS, null) : [];
