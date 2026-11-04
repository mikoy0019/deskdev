import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_STORAGE_KEY,
  attributionForIntake,
  externalReferrer,
  isMeaningful,
  leadSourceOf,
  nextAttribution,
  readAttribution,
  recordAttribution,
  sanitizeAttribution,
  touchFrom,
} from './attribution';

const NOW = new Date('2026-10-03T08:00:00.000Z');

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe('touchFrom', () => {
  it('reads UTM params, gclid, landing path and an external referrer', () => {
    const touch = touchFrom(
      'https://nixgensolutions.com/services?utm_source=google&utm_medium=cpc&utm_campaign=q4&gclid=abc&email=x@y.z',
      'https://www.google.com/search?q=private+terms',
      NOW,
    );
    expect(touch).toEqual({
      landing: '/services',
      at: '2026-10-03T08:00:00.000Z',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'q4',
      gclid: 'abc',
      referrer: 'https://www.google.com/search',
    });
  });

  it('ignores internal and non-http referrers, and strips referrer queries', () => {
    expect(externalReferrer('https://nixgensolutions.com/about', 'nixgensolutions.com')).toBeUndefined();
    expect(externalReferrer('android-app://com.x', 'nixgensolutions.com')).toBeUndefined();
    expect(externalReferrer('not a url', 'nixgensolutions.com')).toBeUndefined();
    expect(externalReferrer('https://news.example/post/1?ref=abc', 'nixgensolutions.com')).toBe('https://news.example/post/1');
  });

  it('caps values at 200 characters', () => {
    const touch = touchFrom(`https://n.com/?utm_campaign=${'c'.repeat(500)}`, '', NOW);
    expect(touch.utm_campaign).toHaveLength(200);
  });
});

describe('nextAttribution', () => {
  const ad = touchFrom('https://n.com/?utm_source=ads', '', NOW);
  const plain = touchFrom('https://n.com/about', '', NOW);
  const social = touchFrom('https://n.com/', 'https://linkedin.com/feed', NOW);

  it('first page view sets both touches', () => {
    expect(nextAttribution(null, plain)).toEqual({ first: plain, last: plain });
  });

  it('internal navigation keeps the campaign; a new campaign moves last touch only', () => {
    const start = nextAttribution(null, ad);
    expect(isMeaningful(plain)).toBe(false);
    expect(nextAttribution(start, plain)).toBe(start);
    expect(nextAttribution(start, social)).toEqual({ first: ad, last: social });
  });
});

describe('storage', () => {
  it('records and reads back through sessionStorage-like storage', () => {
    const storage = memoryStorage();
    recordAttribution('https://n.com/?utm_source=ads', '', storage, NOW);
    recordAttribution('https://n.com/contact', '', storage, NOW);
    expect(readAttribution(storage)).toEqual({
      first: { landing: '/', at: NOW.toISOString(), utm_source: 'ads' },
      last: { landing: '/', at: NOW.toISOString(), utm_source: 'ads' },
    });
  });

  it('never throws on corrupt or blocked storage', () => {
    expect(readAttribution(memoryStorage({ [ATTRIBUTION_STORAGE_KEY]: '{bad' }))).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(readAttribution(throwing)).toBeNull();
    expect(recordAttribution('https://n.com/', '', throwing, NOW)).toBeNull();
    expect(recordAttribution('https://n.com/', '', null, NOW)).toBeNull();
  });
});

describe('sanitizeAttribution', () => {
  it('keeps known string keys only and fills a missing side', () => {
    expect(
      sanitizeAttribution({ first: { utm_source: 'g', referrer: 5, extra: 'x', at: 'not a date' }, last: 'nope' }),
    ).toEqual({ first: { utm_source: 'g' }, last: { utm_source: 'g' } });
  });

  it('is null for junk', () => {
    for (const junk of [null, 'x', [], {}, { first: {}, last: {} }]) expect(sanitizeAttribution(junk)).toBeNull();
  });
});

describe('attributionForIntake', () => {
  it("renames landing to the database's landing_page and keeps the rest", () => {
    expect(
      attributionForIntake({
        first: { utm_source: 'google', landing: '/services', at: NOW.toISOString() },
        last: { referrer: 'https://news.example/post' },
      }),
    ).toEqual({
      first: { utm_source: 'google', landing_page: '/services', at: NOW.toISOString() },
      last: { referrer: 'https://news.example/post' },
    });
  });

  it('passes null through', () => {
    expect(attributionForIntake(null)).toBeNull();
  });
});

describe('leadSourceOf', () => {
  const first = (touch: Record<string, string>) => ({ first: touch, last: touch });

  it.each([
    [null, 'website'],
    [first({ landing: '/' }), 'website'],
    [first({ referrer: 'https://www.linkedin.com/feed' }), 'linkedin'],
    [first({ referrer: 'https://lnkd.in' }), 'linkedin'],
    [first({ utm_source: 'LinkedIn', utm_medium: 'social' }), 'linkedin'],
    [first({ utm_source: 'apollo', utm_medium: 'email' }), 'outbound'],
    [first({ utm_source: 'google', utm_medium: 'cpc' }), 'other'],
    [first({ gclid: 'abc', referrer: 'https://www.google.com' }), 'other'],
    [first({ referrer: 'https://www.google.com' }), 'seo'],
    [first({ referrer: 'https://duckduckgo.com' }), 'seo'],
    [first({ utm_source: 'google', utm_medium: 'organic' }), 'seo'],
    [first({ referrer: 'https://news.example/post' }), 'referral'],
    [first({ utm_source: 'partner', utm_medium: 'referral' }), 'referral'],
    [first({ utm_source: 'newsletter' }), 'other'],
  ] as const)('%j → %s', (attribution, expected) => {
    expect(leadSourceOf(attribution)).toBe(expected);
  });

  it('judges by the first touch, not the last', () => {
    expect(
      leadSourceOf({ first: { referrer: 'https://www.google.com' }, last: { referrer: 'https://www.linkedin.com' } }),
    ).toBe('seo');
  });
});
