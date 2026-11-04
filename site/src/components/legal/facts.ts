// Facts the /privacy and /terms pages state, in one place so the owner fills
// them once and the tests can hold them against the code they describe.
//
// Pure and import-free: legal.test.ts reads it next to migration 039 and the
// google Edge Function's scope list, so a changed retention window or a new
// Google scope fails CI instead of silently making the policy untrue.

/**
 * Owner facts (PLAN Q9). `null` renders a clearly marked placeholder on the
 * page ("[Legal entity name - owner to confirm]"); fill these before the pages
 * are linked from the contact form's consent box or a Google consent screen.
 * A registered-agent or virtual office address works for `registeredAddress`.
 */
export const OWNER_FACTS: {
  entityName: string | null;
  registeredAddress: string | null;
  governingLaw: string | null;
  courts: string | null;
} = {
  entityName: null,
  registeredAddress: null,
  governingLaw: null,
  courts: null,
};

export type OwnerFact = keyof typeof OWNER_FACTS;

/** What each placeholder says while its fact is missing. */
export const OWNER_FACT_LABELS: Record<OwnerFact, string> = {
  entityName: 'Legal entity name',
  registeredAddress: 'Registered address',
  governingLaw: 'Governing law (country or state)',
  courts: 'Courts with jurisdiction',
};

export function placeholderText(fact: OwnerFact): string {
  return `[${OWNER_FACT_LABELS[fact]} - owner to confirm]`;
}

/** Owner facts still missing, in a stable order (the owner checklist). */
export function pendingOwnerFacts(facts: Record<OwnerFact, string | null> = OWNER_FACTS): OwnerFact[] {
  return (Object.keys(OWNER_FACT_LABELS) as OwnerFact[]).filter((key) => !facts[key]?.trim());
}

export const COMPANY = 'NixGen Solutions';
export const SITE_DOMAIN = 'nixgensolutions.com';
export const WORKSPACE_DOMAIN = 'workspace.nixgensolutions.com';
/** The address the Footer and the Organization JSON-LD already publish. */
export const CONTACT_EMAIL = 'nixgensolutions@gmail.com';

/** Shown as "Last updated". Change it whenever either page's substance changes. */
export const LAST_UPDATED = { iso: '2026-10-03', label: '3 October 2026' } as const;

/**
 * Retention as migration 039 enforces it. `window` must equal the value in
 * public.retention_windows() for `key` (legal.test.ts compares them).
 */
export const RETENTION_WINDOWS = {
  spam_leads: '30 days',
  lost_lead_pii: '24 months',
  notifications: '90 days',
  subscriber_attempts: '1 day',
} as const;

/** Browser storage the public site uses. Keys must match the code (legal.test.ts). */
export const BROWSER_STORAGE = {
  attributionKey: 'nx_attribution',
  themeKey: 'nixgen-theme',
} as const;

/**
 * Every Google OAuth scope the workspace can request (supabase/functions/
 * _shared/google_policy.ts PURPOSES). legal.test.ts fails when the function
 * asks for a scope this list does not disclose.
 */
export const GOOGLE_SCOPES: { scope: string; label: string; use: string }[] = [
  {
    scope: 'openid',
    label: 'Sign-in identity',
    use: 'Confirms which Google account is being connected.',
  },
  {
    scope: 'email',
    label: 'Email address',
    use: 'Shows which account is connected, so you can tell it apart from others and disconnect it.',
  },
  {
    scope: 'https://www.googleapis.com/auth/drive.file',
    label: 'Google Drive: files this app uses',
    use: 'Saves the exports and attachments you ask for into your Drive. The app can see only files it created or that you chose to open with it, never the rest of your Drive.',
  },
  {
    scope: 'https://www.googleapis.com/auth/calendar.app.created',
    label: 'Google Calendar: calendars this app creates',
    use: 'Keeps the shared team calendar the app created up to date, with events, invitations and meeting links. The app cannot read the events in your other calendars.',
  },
  {
    scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    label: 'Google Calendar: busy and free times',
    use: 'Lets the booking page offer only times when the connected company account is free. The app sees when that account is busy, never the events themselves: no titles, details or guests. Optional: without it, booking checks only the team calendar.',
  },
];

export const GOOGLE_USER_DATA_POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy';
export const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions';
