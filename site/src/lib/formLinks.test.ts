// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCOVERY_FORM, ONBOARDING_FORM, formFields } from '../deskdev/lib/forms';
import { formTitleFor, isTokenShape, readFormLink, submitFormLink } from './formLinks';

const SUPABASE = 'https://db.test';
const READ_URL = `${SUPABASE}/rest/v1/rpc/form_link_read`;
const SUBMIT_URL = `${SUPABASE}/rest/v1/rpc/form_link_submit`;
const TOKEN = 'Q2xhdWRlLXRlc3QtdG9rZW4tMDEyMzQ1Njc4OWFiY2RlZg';

const fetchMock = vi.fn();

function answer(body: unknown, status = 200) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}

function lastCall(url: string) {
  const calls = fetchMock.mock.calls.filter(([u]) => String(u) === url);
  expect(calls).toHaveLength(1);
  return { init: calls[0][1] as RequestInit, body: JSON.parse(calls[0][1].body as string) };
}

const OPEN_DISCOVERY = {
  ok: true,
  id: '11111111-1111-1111-1111-111111111111',
  form: 'discovery',
  version: 1,
  answers: {
    company: 'Kalye Coffee Co.',
    goals: 'Online ordering',
    meeting_notes: 'Price-sensitive; mentioned a competitor quote',
    fit: 'maybe',
    next_step: 'proposal',
  },
  submitted: false,
  customer_submitted_at: null,
  expires_at: '2026-10-20T00:00:00Z',
  context: { name: 'Maya Santos', company: 'Kalye Coffee Co.', project_title: null },
};

beforeEach(() => {
  fetchMock.mockReset();
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

describe('isTokenShape', () => {
  it.each(['short', 'a'.repeat(129), 'has space'.padEnd(40, 'x'), '../../etc/passwd'.padEnd(40, 'x'), 'x'.repeat(31)])(
    'refuses %j',
    (t) => expect(isTokenShape(t)).toBe(false),
  );
  it('accepts a base64url token', () => {
    expect(isTokenShape(TOKEN)).toBe(true);
  });
});

describe('readFormLink', () => {
  it('calls form_link_read with the anon key, the intake secret and the token', async () => {
    answer(OPEN_DISCOVERY);
    await readFormLink(TOKEN);
    const { init, body } = lastCall(READ_URL);
    expect(body).toEqual({ p_secret: 'intake-secret', p_token: TOKEN });
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
  });

  it('keeps the team’s internal answers and fields on the server', async () => {
    answer(OPEN_DISCOVERY);
    const link = await readFormLink(TOKEN);
    expect(link.status).toBe('open');
    if (link.status !== 'open') return;
    expect(link.answers).toEqual({ company: 'Kalye Coffee Co.', goals: 'Online ordering' });
    const keys = formFields(link.template).map((f) => f.key);
    expect(keys).not.toContain('meeting_notes');
    expect(keys).not.toContain('fit');
    expect(keys).not.toContain('next_step');
    expect(link.template.title).toBe(DISCOVERY_FORM.customer!.title);
    expect(JSON.stringify(link)).not.toContain('Price-sensitive');
    expect(link.context).toEqual({ name: 'Maya Santos', company: 'Kalye Coffee Co.', projectTitle: null });
    expect(link.expiresAt).toBe('2026-10-20T00:00:00Z');
  });

  it('drops onboarding’s internal kickoff date too', async () => {
    answer({ ...OPEN_DISCOVERY, form: 'onboarding', answers: { contact_name: 'Maya', kickoff_date: '2026-10-10' } });
    const link = await readFormLink(TOKEN);
    if (link.status !== 'open') throw new Error(link.status);
    expect(link.answers).toEqual({ contact_name: 'Maya' });
    expect(formFields(link.template).map((f) => f.key)).not.toContain('kickoff_date');
  });

  it('reports a submitted link without its answers', async () => {
    answer({ ...OPEN_DISCOVERY, submitted: true, customer_submitted_at: '2026-10-06T08:00:00Z' });
    const link = await readFormLink(TOKEN);
    expect(link.status).toBe('submitted');
    expect(link).not.toHaveProperty('answers');
  });

  it.each([
    [{ ok: false, reason: 'not_found' }, 'not_found'],
    [{ ok: false, reason: 'expired' }, 'expired'],
    [{ ok: false, reason: 'something_new' }, 'not_found'],
    [{ ...OPEN_DISCOVERY, form: 'not_a_form' }, 'not_found'],
  ] as const)('%j → %s', async (body, status) => {
    answer(body);
    expect((await readFormLink(TOKEN)).status).toBe(status);
  });

  it('treats a refused secret or a 5xx as unavailable', async () => {
    answer({ code: '42501', message: 'forbidden' }, 401);
    expect((await readFormLink(TOKEN)).status).toBe('unavailable');
    answer({}, 503);
    expect((await readFormLink(TOKEN)).status).toBe('unavailable');
  });

  it('reports a timeout separately', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect((await readFormLink(TOKEN)).status).toBe('timeout');
  });

  it('never calls the database for a token of the wrong shape', async () => {
    expect((await readFormLink('../../not-a-token')).status).toBe('not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is not configured without the secret, URL or anon key', async () => {
    vi.stubEnv('LEAD_INTAKE_SECRET', '');
    expect((await readFormLink(TOKEN)).status).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the token', async () => {
    answer({ ok: false, reason: 'expired' });
    await readFormLink(TOKEN);
    const lines = [console.info, console.warn, console.error].flatMap((f) => vi.mocked(f).mock.calls.map(([l]) => String(l)));
    expect(lines.join('\n')).not.toContain(TOKEN);
  });
});

describe('submitFormLink', () => {
  it('sends the token, the answers and the form title with the secret', async () => {
    answer({ ok: true, id: 'x', form: 'discovery' });
    expect((await submitFormLink(TOKEN, { goals: 'More bookings' }, 'discovery form')).status).toBe('saved');
    expect(lastCall(SUBMIT_URL).body).toEqual({
      p_secret: 'intake-secret',
      p_token: TOKEN,
      p_answers: { goals: 'More bookings' },
      p_form_title: 'discovery form',
    });
  });

  it.each([
    ['not_found', 'not_found'],
    ['expired', 'expired'],
    ['submitted', 'already_submitted'],
    ['invalid', 'invalid'],
  ] as const)('reason %s → %s', async (reason, status) => {
    answer({ ok: false, reason });
    expect((await submitFormLink(TOKEN, {}, 'discovery form')).status).toBe(status);
  });
});

describe('formTitleFor', () => {
  it('names the form for the team’s notification', () => {
    expect(formTitleFor(DISCOVERY_FORM)).toBe('discovery form');
    expect(formTitleFor(ONBOARDING_FORM)).toBe('project onboarding form');
  });
});
