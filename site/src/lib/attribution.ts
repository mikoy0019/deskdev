// Where a visitor came from, first and last touch, for the Growth reports
// (PLAN Topic A, A5). Pure and import-free: AttributionCapture records it in
// the browser, the contact form reads it, and /api/contact runs the same
// sanitizer on what the browser sends back.
//
// Stored in sessionStorage only (gone when the tab closes), never a cookie.
// The privacy page discloses it, since EU ePrivacy rules cover any browser
// storage. Referrers keep their origin and path only: a referrer's query
// string can carry someone else's search terms or tokens.

export const ATTRIBUTION_STORAGE_KEY = 'nx_attribution';

const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'] as const;
type Param = (typeof PARAMS)[number];

export type Touch = Partial<Record<Param, string>> & {
  /** Origin + path of an external referrer, or absent for direct/internal. */
  referrer?: string;
  /** Path the visit landed on (no query). */
  landing?: string;
  /** ISO time of the touch. */
  at?: string;
};

export type Attribution = { first: Touch; last: Touch };

const MAX_VALUE = 200;

function clip(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  return v ? v.slice(0, MAX_VALUE) : undefined;
}

/** Origin + path of a referrer from another host; undefined for none, internal or unparseable. */
export function externalReferrer(referrer: string, currentHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.host === currentHost) return undefined;
    return clip(url.origin + (url.pathname === '/' ? '' : url.pathname));
  } catch {
    return undefined;
  }
}

/** The touch this page view represents. */
export function touchFrom(href: string, referrer: string, now: Date = new Date()): Touch {
  const url = new URL(href);
  const touch: Touch = { landing: clip(url.pathname) ?? '/', at: now.toISOString() };
  for (const key of PARAMS) {
    const value = clip(url.searchParams.get(key));
    if (value) touch[key] = value;
  }
  const ref = externalReferrer(referrer, url.host);
  if (ref) touch.referrer = ref;
  return touch;
}

/** A touch says something about the source only when it has campaign params or an outside referrer. */
export function isMeaningful(touch: Touch): boolean {
  return Boolean(touch.referrer || PARAMS.some((key) => touch[key]));
}

/**
 * The stored record after this page view. First touch is the session's first
 * page view and never changes. Last touch moves only on a meaningful touch,
 * so clicking around the site does not overwrite the campaign that brought
 * the visitor in.
 */
export function nextAttribution(stored: Attribution | null, touch: Touch): Attribution {
  if (!stored) return { first: touch, last: touch };
  return isMeaningful(touch) ? { first: stored.first, last: touch } : stored;
}

function sanitizeTouch(value: unknown): Touch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const touch: Touch = {};
  for (const key of [...PARAMS, 'referrer', 'landing', 'at'] as const) {
    const v = input[key];
    if (typeof v === 'string') {
      const c = clip(v);
      if (c) touch[key] = c;
    }
  }
  if (touch.at && Number.isNaN(Date.parse(touch.at))) delete touch.at;
  return Object.keys(touch).length ? touch : null;
}

/** Known keys only, every value a clipped string. Null when nothing usable is left. */
export function sanitizeAttribution(value: unknown): Attribution | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const first = sanitizeTouch(input.first);
  const last = sanitizeTouch(input.last);
  if (!first && !last) return null;
  return { first: first ?? last!, last: last ?? first! };
}

/** The stored attribution, for the contact form's payload. Null when storage is empty or blocked. */
export function readAttribution(storage: Pick<Storage, 'getItem'> | null | undefined = safeSessionStorage()): Attribution | null {
  try {
    const raw = storage?.getItem(ATTRIBUTION_STORAGE_KEY);
    return raw ? sanitizeAttribution(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Records this page view. Never throws (private windows and blocked storage just skip it). */
export function recordAttribution(
  href: string,
  referrer: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined = safeSessionStorage(),
  now: Date = new Date(),
): Attribution | null {
  try {
    if (!storage) return null;
    const next = nextAttribution(readAttribution(storage), touchFrom(href, referrer, now));
    storage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// ── Hand-off to the database ──────────────────────────────────────────────────
// intake_site_lead (migration 034) runs the attribution through
// lead_clean_attribution, which keeps known keys only, and its key for the
// landing path is `landing_page`. Anything sent as `landing` would be dropped.

type IntakeTouch = Omit<Touch, 'landing'> & { landing_page?: string };

function intakeTouch({ landing, ...rest }: Touch): IntakeTouch {
  return landing ? { ...rest, landing_page: landing } : rest;
}

/** The sanitized attribution in the key spelling intake_site_lead keeps. */
export function attributionForIntake(value: Attribution | null): { first: IntakeTouch; last: IntakeTouch } | null {
  return value ? { first: intakeTouch(value.first), last: intakeTouch(value.last) } : null;
}

/** leads.source values intake_site_lead accepts (anything else becomes 'website'). */
export type LeadSource = 'seo' | 'referral' | 'linkedin' | 'outbound' | 'website' | 'other';

const SEARCH_ENGINE = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave|startpage|qwant)\.[a-z.]+$/;
const LINKEDIN = /(^|\.)(linkedin\.com|lnkd\.in)$/;
const OUTBOUND_MEDIUMS = new Set(['email', 'e-mail', 'outbound', 'outreach', 'cold-email', 'cold_email', 'sequence']);
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'paid_social', 'paid-social', 'display', 'cpm']);

function hostOf(referrer: string | undefined): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The channel that brought the visitor in, from the first touch, for the
 * Growth "By source" report. Campaign tags win over the referrer (they were
 * set on purpose); paid clicks are 'other', since 'seo' means organic search.
 * No tags and no outside referrer is a direct visit: 'website'.
 */
export function leadSourceOf(value: Attribution | null): LeadSource {
  const touch = value?.first;
  if (!touch) return 'website';
  const source = touch.utm_source?.toLowerCase() ?? '';
  const medium = touch.utm_medium?.toLowerCase() ?? '';
  const host = hostOf(touch.referrer);

  if (source.includes('linkedin') || LINKEDIN.test(host)) return 'linkedin';
  if (OUTBOUND_MEDIUMS.has(medium)) return 'outbound';
  if (touch.gclid || PAID_MEDIUMS.has(medium)) return 'other';
  if (medium === 'organic' || (!medium && SEARCH_ENGINE.test(host))) return 'seo';
  if (medium === 'referral' || host) return 'referral';
  if (source || medium) return 'other';
  return 'website';
}
