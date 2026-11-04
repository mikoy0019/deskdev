// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

// The Worker's bindings (src/lib/platform.ts) exist only in a Worker; this test has none.
vi.mock('../../../../lib/platform', () => ({ bindings: () => ({}) }));

const SUPABASE = 'https://db.test';
const READ_URL = `${SUPABASE}/rest/v1/rpc/form_link_read`;
const SUBMIT_URL = `${SUPABASE}/rest/v1/rpc/form_link_submit`;
const TOKEN = 'Q2xhdWRlLXRlc3QtdG9rZW4tMDEyMzQ1Njc4OWFiY2RlZg';
const URL_ = `https://nixgensolutions.com/api/forms/${TOKEN}`;

/** Required on the discovery form's customer view. */
const VALID = { trigger: 'Our site is out of date', goals: 'Online ordering for pickup' };

const fetchMock = vi.fn();

type Rpc = { read?: unknown; readStatus?: number; submit?: unknown; submitStatus?: number };

function rpcs({ read, readStatus = 200, submit, submitStatus = 200 }: Rpc = {}) {
  fetchMock.mockImplementation(async (u: string) => {
    if (String(u) === READ_URL) {
      return new Response(
        JSON.stringify(read ?? { ok: true, id: 'r1', form: 'discovery', version: 1, answers: {}, submitted: false, customer_submitted_at: null, expires_at: null, context: {} }),
        { status: readStatus },
      );
    }
    return new Response(JSON.stringify(submit ?? { ok: true, id: 'r1', form: 'discovery' }), { status: submitStatus });
  });
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'nixgensolutions.com',
      origin: 'https://nixgensolutions.com',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

function submitted(): Record<string, unknown> {
  const calls = fetchMock.mock.calls.filter(([u]) => String(u) === SUBMIT_URL);
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0][1].body as string);
}

beforeEach(() => {
  fetchMock.mockReset();
  rpcs();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('LEAD_INTAKE_SECRET', 'intake-secret');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE}/`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/forms/[token]', () => {
  it('saves valid answers and answers ok, never cached', async () => {
    const res = await POST(req({ answers: VALID }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(submitted()).toEqual({
      p_secret: 'intake-secret',
      p_token: TOKEN,
      p_answers: VALID,
      p_form_title: 'discovery form',
    });
  });

  it('strips internal and unknown fields before they reach the database', async () => {
    await POST(req({ answers: { ...VALID, meeting_notes: 'overwrite', fit: 'good', next_step: 'decline', evil: 'x' } }), ctx());
    expect(submitted().p_answers).toEqual(VALID);
  });

  it('strips onboarding’s internal kickoff date', async () => {
    rpcs({ read: { ok: true, id: 'r2', form: 'onboarding', version: 1, answers: {}, submitted: false, context: {} } });
    const onboarding = {
      contact_name: 'Maya',
      contact_email: 'maya@kalyecoffee.ph',
      goals: 'Ordering',
      scope: 'Site + loyalty',
      target_launch: '2026-12-01',
      portfolio_consent: 'yes',
    };
    const res = await POST(req({ answers: { ...onboarding, kickoff_date: '2026-10-10' } }), ctx());
    expect(res.status).toBe(200);
    expect(submitted()).toMatchObject({ p_answers: onboarding, p_form_title: 'project onboarding form' });
  });

  it('refuses missing required answers with their keys, and saves nothing', async () => {
    const res = await POST(req({ answers: { goals: 'Ordering' } }), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ missing: ['trigger'] });
    expect(fetchMock.mock.calls.some(([u]) => String(u) === SUBMIT_URL)).toBe(false);
  });

  it('refuses invalid values with their keys', async () => {
    const res = await POST(req({ answers: { ...VALID, decision_by: 'next week' } }), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ invalid: ['decision_by'] });
  });

  it.each([
    [{ ok: false, reason: 'not_found' }, 404],
    [{ ok: false, reason: 'expired' }, 410],
    [{ ok: true, id: 'r1', form: 'discovery', answers: {}, submitted: true, context: {} }, 409],
  ] as const)('a link read as %j → %i, before any validation', async (read, status) => {
    rpcs({ read });
    const res = await POST(req({ answers: {} }), ctx());
    expect(res.status).toBe(status);
    expect(fetchMock.mock.calls.some(([u]) => String(u) === SUBMIT_URL)).toBe(false);
  });

  it.each([
    ['not_found', 404],
    ['expired', 410],
    ['submitted', 409],
    ['invalid', 400],
  ] as const)('submit reason %s → %i', async (reason, status) => {
    rpcs({ submit: { ok: false, reason } });
    expect((await POST(req({ answers: VALID }), ctx())).status).toBe(status);
  });

  it('answers 502 when the database refuses, 504 when it does not answer', async () => {
    rpcs({ readStatus: 500 });
    expect((await POST(req({ answers: VALID }), ctx())).status).toBe(502);
    fetchMock.mockRejectedValue(Object.assign(new Error('slow'), { name: 'TimeoutError' }));
    expect((await POST(req({ answers: VALID }), ctx())).status).toBe(504);
  });

  it('answers 503 when not configured', async () => {
    vi.stubEnv('LEAD_INTAKE_SECRET', '');
    expect((await POST(req({ answers: VALID }), ctx())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fakes success for a filled honeypot and saves nothing', async () => {
    const res = await POST(req({ answers: VALID, _honey: 'bot' }), ctx());
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls the database for a token of the wrong shape', async () => {
    const res = await POST(req({ answers: VALID }), ctx('nope'));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses cross-site posts and non-JSON', async () => {
    expect((await POST(req({ answers: VALID }, { 'sec-fetch-site': 'cross-site' }), ctx())).status).toBe(403);
    expect((await POST(req({ answers: VALID }, { 'content-type': 'text/plain' }), ctx())).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
