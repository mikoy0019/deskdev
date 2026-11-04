import { NextResponse } from 'next/server';
import { getBookingSlots } from '../../../../lib/booking';
import { crossSiteReason, withRequestLog } from '../../../../lib/guard';

// Open times for /book (src/lib/booking.ts → the google-calendar function).
// Read fresh on every visit: a time someone else just booked must not linger
// in a cache.
//
// Response (always no-store):
//   200 { ok: true, tz, minutes, title, days: [{ date, slots: [iso] }], daysAhead, google }
//   200 { ok: false, reason: 'disabled' }   online booking is switched off in DeskDev
//   403 cross-site · 503 not configured · 502 unavailable · 504 timed out

const ROUTE = 'booking-slots';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const dynamic = 'force-dynamic';

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export const GET = withRequestLog(ROUTE, async (request, log) => {
  const crossSite = crossSiteReason(request);
  if (crossSite) {
    log.log('warn', 'cross_site_refused', { reason: crossSite });
    return reply(403, { ok: false, error: 'Forbidden.' });
  }

  const slots = await getBookingSlots();
  switch (slots.status) {
    case 'open': {
      const { tz, minutes, title, days, daysAhead, google } = slots;
      return reply(200, { ok: true, tz, minutes, title, days, daysAhead, google });
    }
    case 'disabled':
      return reply(200, { ok: false, reason: 'disabled' });
    case 'not_configured':
      return reply(503, { ok: false, reason: 'not_configured', error: 'Booking is not available right now.' });
    case 'timeout':
      return reply(504, { ok: false, reason: 'timeout', error: 'Loading open times took too long.' });
    default:
      return reply(502, { ok: false, reason: 'unavailable', error: 'We could not load open times.' });
  }
});
