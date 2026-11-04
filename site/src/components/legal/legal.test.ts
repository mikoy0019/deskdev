import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_STORAGE_KEY } from '../../lib/attribution';
import { THEME_KEY } from '../../lib/theme';
import { PURPOSES } from '../../../../supabase/functions/_shared/google_policy';
import {
  BROWSER_STORAGE,
  GOOGLE_SCOPES,
  OWNER_FACT_LABELS,
  OWNER_FACTS,
  pendingOwnerFacts,
  placeholderText,
  RETENTION_WINDOWS,
} from './facts';

// vitest runs from site/.
const MIGRATION_039 = '../supabase/migrations/039_subscribers_retention.sql';
const PAGES = ['src/app/(site)/privacy/page.tsx', 'src/app/(site)/terms/page.tsx'];

/** The key/value pairs of public.retention_windows()'s jsonb_build_object. */
function retentionWindowsFromSql(sql: string): Record<string, string> {
  const body = sql.match(/FUNCTION public\.retention_windows\(\)[\s\S]*?jsonb_build_object\(([\s\S]*?)\)\s*\$\$/);
  if (!body) throw new Error('retention_windows() not found in 039');
  const pairs = [...body[1].matchAll(/'([a-z_]+)'\s*,\s*'([^']+)'/g)];
  return Object.fromEntries(pairs.map(([, key, value]) => [key, value]));
}

describe('privacy policy matches the code it describes', () => {
  it('states the retention windows migration 039 enforces', () => {
    const windows = retentionWindowsFromSql(readFileSync(MIGRATION_039, 'utf8'));
    expect(windows).toEqual(RETENTION_WINDOWS);
  });

  it('discloses every Google scope the workspace can request, and no others', () => {
    const requested = new Set(Object.values(PURPOSES).flatMap((p) => p.scopes));
    const disclosed = new Set(GOOGLE_SCOPES.map((s) => s.scope));
    expect([...disclosed].sort()).toEqual([...requested].sort());
  });

  it('names the browser storage keys the site actually uses', () => {
    expect(BROWSER_STORAGE.attributionKey).toBe(ATTRIBUTION_STORAGE_KEY);
    expect(BROWSER_STORAGE.themeKey).toBe(THEME_KEY);
  });

  it('carries the Google Limited Use statement', () => {
    // Whitespace-normalised: JSX line breaks are not part of the sentence.
    const privacy = readFileSync(PAGES[0], 'utf8').replace(/\s+/g, ' ');
    expect(privacy).toContain('Google API Services User Data Policy</TextLink>, including the Limited Use requirements.');
  });
});

describe('owner facts', () => {
  it('renders a marked placeholder for a missing fact', () => {
    expect(placeholderText('entityName')).toBe('[Legal entity name - owner to confirm]');
    for (const key of Object.keys(OWNER_FACT_LABELS) as (keyof typeof OWNER_FACT_LABELS)[]) {
      expect(placeholderText(key)).toMatch(/^\[.+ - owner to confirm\]$/);
    }
  });

  it('lists the facts still pending', () => {
    expect(
      pendingOwnerFacts({ entityName: 'NixGen Ltd', registeredAddress: '  ', governingLaw: null, courts: 'X' }),
    ).toEqual(['registeredAddress', 'governingLaw']);
    // The live list: every fact the pages need has a label.
    expect(Object.keys(OWNER_FACTS).sort()).toEqual(Object.keys(OWNER_FACT_LABELS).sort());
  });
});

describe('legal copy rules', () => {
  it.each(PAGES)('%s sets its own canonical and description', (path) => {
    const source = readFileSync(path, 'utf8');
    // pageMeta (lib/seo.ts) turns `path` into the canonical and the share card's url.
    expect(source).toMatch(/export const metadata = pageMeta\(\{[\s\S]*?path: '\/(privacy|terms)',\s*\}\);/);
    expect(source).toMatch(/description:\s*\n?\s*'/);
  });
});

// The launch gate. These are owner decisions, so they do not fail everyday CI;
// run `RELEASE_CHECK=1 npm test` before a production deploy and it refuses to
// pass while a visitor would still see unfinished or untrue content.
describe.runIf(process.env.RELEASE_CHECK === '1')('launch gate (RELEASE_CHECK=1)', () => {
  const read = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ');

  it('has every owner fact, so no placeholder chip reaches the legal pages', () => {
    expect(pendingOwnerFacts()).toEqual([]);
  });

  it('does not publish a fictional (555) phone number on /contact', () => {
    expect(read('src/app/(site)/contact/page.tsx')).not.toMatch(/555[)\s-]*\d{3}[\s-]?\d{4}/);
  });

  it('links footer socials to NixGen profiles, never a bare service homepage', () => {
    expect(read('src/components/layout/Footer.tsx')).not.toMatch(/href: 'https:\/\/(www\.)?(twitter|x|github|linkedin)\.com\/?'/);
  });

  it('describes the contact form that is actually on the site', () => {
    const privacy = read(PAGES[0]);
    const form = read('src/components/site/contact/ContactForm.tsx');
    // Each claim in the policy needs the matching control in ContactForm.
    if (privacy.includes('ticked the box agreeing to this policy')) expect(form).toMatch(/name="consent"/);
    if (privacy.includes('phone number (optional)')) expect(form).toMatch(/name="phone"/);
    if (/budget range, timeline/.test(privacy)) expect(form).toMatch(/timeline/i);
    if (privacy.includes('runs a short check in your browser when you use a form')) expect(form).toMatch(/turnstile/i);
  });
});
