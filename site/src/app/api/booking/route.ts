import { NextResponse } from 'next/server';
import { createBooking, validTimeZone } from '../../../lib/booking';
import { cleanText, guardJsonPost, honeypotFilled, ipHash, isEmail, withRequestLog } from '../../../lib/guard';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimited } from '../../../lib/rateLimit';

// /book's "Confirm booking" (src/lib/booking.ts → the google-calendar
// function → booking_record, migration 048). The function re-checks that the
// time is still free against Google and DeskDev and the database guards the
// race, so this route only shapes and bounds the input.
//
// Response (always no-store):
//   200 { ok: true, start, end, title, meetUrl, invited }
//   400 invalid input · 403 booking switched off · 409 the time was just taken
//   429 too many bookings · 503 not configured · 502 unavailable
//   504 no answer in time (the booking may still have gone through)
// The usual guard (src/lib/guard.ts) runs first: JSON only, same origin, 8 KB.

const ROUTE = 'booking';
const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const LIMITS = { name: 120, email: 254, company: 160, phone: 40, notes: 2000 } as const;

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const REFUSED = {
  invalid: [400, 'Some details need a second look.'],
  disabled: [403, 'Online booking is not open right now.'],
  slot_taken: [409, 'That time was just taken. Please pick another.'],
  throttled: [429, 'Too many bookings from this connection today. Please email nixgensolutions@gmail.com.'],
  not_configured: [503, 'Booking is not available right now. Please try again later.'],
  unavailable: [502, 'We could not book that time. Please try again in a moment.'],
  timeout: [
    504,
    'We could not confirm your booking in time. It may still have gone through: check your email for a calendar invite before booking again.',
  ],
} as const;

function refuse(reason: keyof typeof REFUSED, extra: Record<string, unknown> = {}) {
  const [status, error] = REFUSED[reason];
  return reply(status, { ok: false, reason, error, ...extra });
}

/** A future ISO instant, normalised; null otherwise. */
function startOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms <= Date.now()) return null;
  return new Date(ms).toISOString();
}

export const POST = withRequestLog(ROUTE, async (request, log) => {
  // The Worker's per-network ceiling (src/lib/rateLimit.ts), before the body
  // is read. booking_record keeps its own daily count per connection.
  if (await rateLimited(request, ROUTE, log)) {
    return NextResponse.json(
      { ok: false, reason: 'throttled', error: 'Too many tries from this connection. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) } },
    );
  }

  const guarded = await guardJsonPost(request, log, MAX_BODY_BYTES);
  if (!guarded.ok) return reply(guarded.status, { ok: false, error: guarded.error });
  const input = guarded.input;

  // A filled honeypot is a bot: answer as if it worked so it learns nothing.
  if (honeypotFilled(input)) return reply(200, { ok: true });

  const name = cleanText(input.name, LIMITS.name).replace(/\s+/g, ' ');
  const email = cleanText(input.email, LIMITS.email);
  const start = startOf(input.start);
  const fields: string[] = [];
  if (!name) fields.push('name');
  if (!isEmail(email)) fields.push('email');
  if (!start) fields.push('start');
  if (fields.length) return refuse('invalid', { fields });

  const result = await createBooking({
    start: start!,
    name,
    email,
    company: cleanText(input.company, LIMITS.company) || undefined,
    phone: cleanText(input.phone, LIMITS.phone) || undefined,
    notes: cleanText(input.notes, LIMITS.notes) || undefined,
    customerTz: validTimeZone(input.customerTz) ?? undefined,
    ipHash: await ipHash(request),
  });

  if (result.status === 'booked') {
    const { start: s, end, title, meetUrl, invited } = result;
    return reply(200, { ok: true, start: s, end, title, meetUrl, invited });
  }
  return refuse(result.status);
});
