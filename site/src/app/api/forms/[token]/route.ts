import { NextResponse } from 'next/server';
import { FORM_TEMPLATES, customerAnswers, fieldError, formFields, missingRequired, type Answers } from '../../../../deskdev/lib/forms';
import { formTitleFor, isTokenShape, readFormLink, submitFormLink } from '../../../../lib/formLinks';
import { guardJsonPost, honeypotFilled, withRequestLog } from '../../../../lib/guard';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimited } from '../../../../lib/rateLimit';

// A customer sends back a quick form (/f/<token>, migration 047). The link is
// read first, so the template, its state and its expiry come from the
// database, never from the request. Only the template's customer fields are
// accepted (customerAnswers): anything else in the body, internal fields
// included, is dropped before form_link_submit merges the answers.
//
// Response: { ok: true } (200), or { error, missing?, invalid? } with
//   400 missing required answers / invalid values · 404 unknown link ·
//   409 already sent · 410 expired · 503 not configured ·
//   502 the database refused or is unreachable · 504 it did not answer in time.
// The usual guard (src/lib/guard.ts) runs first: JSON only, same origin, 64 KB.

const ROUTE = 'forms';
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

type Ctx = { params: Promise<{ token: string }> };

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const GONE = {
  not_found: [404, 'This form link is not valid. Ask us for a new one.'],
  expired: [410, 'This form link has expired. Ask us for a new one.'],
  already_submitted: [409, 'We already have your answers. Thank you!'],
  not_configured: [503, 'Forms are not available right now. Please try again later.'],
  unavailable: [502, 'We could not save your answers. Please try again in a moment.'],
  timeout: [504, 'Saving took too long. Please try again in a moment.'],
  invalid: [400, 'Some answers could not be saved. Check the form and try again.'],
} as const;

function fail(reason: keyof typeof GONE) {
  const [status, error] = GONE[reason];
  return reply(status, { error });
}

export const POST = withRequestLog(ROUTE, async (request, log, ctx: Ctx) => {
  // The Worker's per-network ceiling (src/lib/rateLimit.ts), before the body is read.
  if (await rateLimited(request, ROUTE, log)) {
    return NextResponse.json(
      { error: 'Too many tries from this connection. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) } },
    );
  }

  const { token } = await ctx.params;

  const guarded = await guardJsonPost(request, log);
  if (!guarded.ok) return reply(guarded.status, { error: guarded.error });
  const input = guarded.input;

  // A filled honeypot is a bot. Answer as if it worked so it learns nothing.
  if (honeypotFilled(input)) return reply(200, { ok: true });

  if (!isTokenShape(token)) return fail('not_found');

  const link = await readFormLink(token);
  if (link.status === 'submitted') return fail('already_submitted');
  if (link.status !== 'open') return fail(link.status);

  const template = FORM_TEMPLATES[link.form];
  const raw = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) ? (input.answers as Answers) : {};
  // The customer's fields only: internal keys and unknown keys never get through.
  const answers = customerAnswers(template, raw);

  const missing = missingRequired(link.template, answers).map((f) => f.key);
  if (missing.length) return reply(400, { error: 'Please answer the required questions.', missing });
  const invalid = formFields(link.template)
    .filter((f) => fieldError(f, answers[f.key]))
    .map((f) => f.key);
  if (invalid.length) return reply(400, { error: 'Some answers need a second look.', invalid });

  const saved = await submitFormLink(token, answers, formTitleFor(template));
  if (saved.status !== 'saved') return fail(saved.status);
  return reply(200, { ok: true });
});
