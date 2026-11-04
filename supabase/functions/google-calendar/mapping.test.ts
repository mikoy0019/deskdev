// node --test supabase/functions/google-calendar/  (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attendeesFor,
  classifyGoogleError,
  descriptionFor,
  eventTimes,
  eventTimeZone,
  type EventRow,
  googleEventId,
  googleTemplateUrl,
  hasMeet,
  isMaterialChange,
  meetUrl,
  mergeForUpdate,
  retryDelayMinutes,
  rrule,
  sendUpdatesFor,
  sendUpdatesForInsert,
  toGoogleEvent,
  webUrl,
} from "./mapping.ts";
import { addDays, localDate, offsetMinutes, transitions, zonedToUtc } from "./time.ts";

const ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const base = (over: Partial<EventRow> = {}): EventRow => ({
  id: ID,
  kind: "meeting",
  title: "Kickoff",
  starts_at: "2026-11-02T01:00:00.000Z", // 09:00 Manila
  ends_at: "2026-11-02T02:00:00.000Z",
  all_day: false,
  recurrence: "none",
  timezone: "Asia/Manila",
  sync_google: true,
  attendees: [],
  ...over,
});

test("googleEventId matches the SQL twin and Google's base32hex alphabet", () => {
  const id = googleEventId(ID);
  assert.equal(id, "dd0f1e2d3c4b5a69788796a5b4c3d2e1f0");
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(googleEventId(ID.toUpperCase()), id);
});

test("time zone: own, else default, else UTC; POSIX-ish junk refused", () => {
  assert.equal(eventTimeZone({ timezone: "America/New_York", default_time_zone: "Asia/Manila" }), "America/New_York");
  assert.equal(eventTimeZone({ timezone: null, default_time_zone: "Asia/Manila" }), "Asia/Manila");
  assert.equal(eventTimeZone({ timezone: "Mars/Olympus", default_time_zone: null }), "UTC");
});

test("time helpers: offsets, DST gaps and overlaps, day arithmetic", () => {
  assert.equal(offsetMinutes(Date.parse("2026-07-01T12:00:00Z"), "America/New_York"), -240);
  assert.equal(offsetMinutes(Date.parse("2026-12-01T12:00:00Z"), "America/New_York"), -300);
  assert.equal(offsetMinutes(Date.parse("2026-07-01T12:00:00Z"), "Asia/Manila"), 480);
  // 2026-03-08 02:30 does not exist in New York → after the jump (03:30 EDT = 07:30Z)
  assert.equal(new Date(zonedToUtc({ y: 2026, m: 3, d: 8, h: 2, mi: 30, s: 0 }, "America/New_York")).toISOString(), "2026-03-08T07:30:00.000Z");
  // 2026-11-01 01:30 happens twice → the first (EDT, 05:30Z)
  assert.equal(new Date(zonedToUtc({ y: 2026, m: 11, d: 1, h: 1, mi: 30, s: 0 }, "America/New_York")).toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(localDate(Date.parse("2026-11-01T17:00:00Z"), "Asia/Manila"), "2026-11-02");
  const t = transitions("America/New_York", Date.parse("2026-01-01T00:00:00Z"), Date.parse("2027-01-01T00:00:00Z"));
  assert.deepEqual(t.map((x) => [new Date(x.at).toISOString(), x.from, x.to]), [
    ["2026-03-08T07:00:00.000Z", -300, -240],
    ["2026-11-01T06:00:00.000Z", -240, -300],
  ]);
  assert.deepEqual(transitions("Asia/Manila", Date.parse("2026-01-01T00:00:00Z"), Date.parse("2027-01-01T00:00:00Z")), []);
});

test("timed event: instant + IANA zone (Google expands repeats in that zone)", () => {
  const g = toGoogleEvent(base({ timezone: "America/New_York" }));
  assert.deepEqual(g.start, { dateTime: "2026-11-02T01:00:00.000Z", timeZone: "America/New_York" });
  assert.deepEqual(g.end, { dateTime: "2026-11-02T02:00:00.000Z", timeZone: "America/New_York" });
  assert.equal(g.id, googleEventId(ID));
  assert.equal(g.status, "confirmed");
  assert.deepEqual(g.recurrence, []);
  assert.deepEqual(g.extendedProperties, { private: { deskdevId: ID, deskdevKind: "meeting" } });
});

test("timed event without an end (or a backwards end) lasts an hour", () => {
  const { end } = eventTimes({ starts_at: "2026-11-02T01:00:00Z", ends_at: null, all_day: false }, "UTC");
  assert.equal(end.dateTime, "2026-11-02T02:00:00.000Z");
  const back = eventTimes({ starts_at: "2026-11-02T01:00:00Z", ends_at: "2026-11-01T01:00:00Z", all_day: false }, "UTC");
  assert.equal(back.end.dateTime, "2026-11-02T02:00:00.000Z");
  assert.throws(() => eventTimes({ starts_at: "nope", all_day: false }, "UTC"));
});

test("all-day: local dates in the event zone, end exclusive", () => {
  // DeskDev saves all-day as local 00:00 → 23:59 of the last day (Manila here)
  const one = eventTimes({ starts_at: "2026-11-01T16:00:00.000Z", ends_at: "2026-11-02T15:59:00.000Z", all_day: true }, "Asia/Manila");
  assert.deepEqual(one, { start: { date: "2026-11-02" }, end: { date: "2026-11-03" } });
  const three = eventTimes({ starts_at: "2026-11-01T16:00:00.000Z", ends_at: "2026-11-04T15:59:00.000Z", all_day: true }, "Asia/Manila");
  assert.deepEqual(three, { start: { date: "2026-11-02" }, end: { date: "2026-11-05" } });
  const noEnd = eventTimes({ starts_at: "2026-12-31T16:00:00.000Z", ends_at: null, all_day: true }, "Asia/Manila");
  assert.deepEqual(noEnd, { start: { date: "2027-01-01" }, end: { date: "2027-01-02" } });
});

test("RRULE: frequency, inclusive UNTIL at the end of that local day", () => {
  assert.equal(rrule({ recurrence: "none" }, "UTC"), null);
  assert.equal(rrule({ recurrence: "daily" }, "UTC"), "RRULE:FREQ=DAILY");
  // 2026-12-31 23:59:59 in Manila = 15:59:59Z
  assert.equal(rrule({ recurrence: "weekly", recurrence_until: "2026-12-31" }, "Asia/Manila"), "RRULE:FREQ=WEEKLY;UNTIL=20261231T155959Z");
  // New York in winter: 23:59:59 EST = 04:59:59Z next day
  assert.equal(rrule({ recurrence: "monthly", recurrence_until: "2026-12-31" }, "America/New_York"), "RRULE:FREQ=MONTHLY;UNTIL=20270101T045959Z");
  assert.equal(rrule({ recurrence: "weekly", recurrence_until: "2026-12-31", all_day: true }, "Asia/Manila"), "RRULE:FREQ=WEEKLY;UNTIL=20261231");
  assert.equal(rrule({ recurrence: "weekly", recurrence_until: "garbage" }, "UTC"), "RRULE:FREQ=WEEKLY");
});

test("guests: lower-cased, deduplicated, invalid dropped, optional kept", () => {
  assert.deepEqual(attendeesFor([
    { email: " Client@Example.com ", display_name: "Client" },
    { email: "client@example.com", display_name: "Dup" },
    { email: "not-an-email" },
    { email: "pm@nixgen.example", optional: true, display_name: "  " },
  ]), [
    { email: "client@example.com", displayName: "Client" },
    { email: "pm@nixgen.example", optional: true },
  ]);
});

test("links: http(s) only; a typed join link goes in description + location; Google's Meet does not", () => {
  assert.equal(webUrl("javascript:alert(1)"), null);
  assert.equal(webUrl("meet.google.com/abc"), null);
  assert.equal(webUrl(" https://zoom.us/j/1 "), "https://zoom.us/j/1");
  const zoom = toGoogleEvent(base({ meeting_link: "https://zoom.us/j/1", description: "Agenda" }));
  assert.equal(zoom.description, "Agenda\n\nJoin: https://zoom.us/j/1");
  assert.equal(zoom.location, "https://zoom.us/j/1");
  const meet = toGoogleEvent(base({ add_meet: true, meeting_link: "https://meet.google.com/abc-defg-hij" }));
  assert.equal(meet.description, "");
  assert.equal(meet.location, "");
  assert.equal(descriptionFor({ description: null, meeting_link: "ftp://x" }), "");
});

test("no DeskDev branding in anything guests see", () => {
  const g = toGoogleEvent(base({ description: "Hello", meeting_link: "https://zoom.us/j/1", attendees: [{ email: "c@x.io" }] }));
  const visible = JSON.stringify({ ...g, extendedProperties: undefined });
  assert.doesNotMatch(visible, /deskdev/i);
});

test("Meet: createRequest only when asked; meetUrl reads hangoutLink or the video entry point", () => {
  assert.equal(toGoogleEvent(base({ add_meet: true })).conferenceData, undefined);
  const g = toGoogleEvent(base({ add_meet: true }), { meetRequestId: "r1" });
  assert.deepEqual(g.conferenceData, { createRequest: { requestId: "r1", conferenceSolutionKey: { type: "hangoutsMeet" } } });
  assert.equal(toGoogleEvent(base({ add_meet: false }), { meetRequestId: "r1" }).conferenceData, undefined);
  assert.equal(meetUrl({ hangoutLink: "https://meet.google.com/abc-defg-hij" }), "https://meet.google.com/abc-defg-hij");
  assert.equal(meetUrl({ conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://meet.google.com/xyz" }] } }), "https://meet.google.com/xyz");
  assert.equal(meetUrl({ hangoutLink: "https://evil.example/meet" }), null);
});

test("update merge: RSVPs kept, existing Meet kept, Meet removed when switched off", () => {
  const prev = {
    etag: '"1"',
    attendees: [{ email: "client@example.com", responseStatus: "accepted" }],
    hangoutLink: "https://meet.google.com/abc",
    conferenceData: { conferenceSolution: { key: { type: "hangoutsMeet" } }, conferenceId: "abc" },
  };
  const next = toGoogleEvent(base({ add_meet: true, attendees: [{ email: "Client@example.com" }, { email: "new@example.com" }] }));
  const on = mergeForUpdate(next, prev, true, "new-req");
  assert.deepEqual(on.attendees, [{ email: "client@example.com", responseStatus: "accepted" }, { email: "new@example.com" }]);
  assert.deepEqual(on.conferenceData, prev.conferenceData);
  const off = mergeForUpdate(next, prev, false, "new-req");
  assert.equal("conferenceData" in off, false);
  const added = mergeForUpdate(next, { attendees: [] }, true, "new-req");
  assert.equal(added.conferenceData?.createRequest?.requestId, "new-req");
  assert.equal(hasMeet(prev), true);
});

test("material changes notify guests; description edits and RSVP-only states do not", () => {
  const ev = base({ attendees: [{ email: "client@example.com" }] });
  const next = toGoogleEvent(ev);
  // What Google hands back: same instants, offset form, an organizer entry, an RSVP
  const prev = {
    ...next,
    start: { dateTime: "2026-11-02T09:00:00+08:00", timeZone: "Asia/Manila" },
    end: { dateTime: "2026-11-02T10:00:00+08:00", timeZone: "Asia/Manila" },
    attendees: [{ email: "client@example.com", responseStatus: "accepted" }, { email: "cal@group.calendar.google.com", organizer: true }],
  };
  assert.equal(isMaterialChange(prev, next, false), false);
  assert.equal(sendUpdatesFor(prev, { ...next, description: "typo fixed" }, false), "none");
  assert.equal(sendUpdatesFor(prev, toGoogleEvent({ ...ev, starts_at: "2026-11-02T02:00:00.000Z", ends_at: "2026-11-02T03:00:00.000Z" }), false), "all");
  assert.equal(sendUpdatesFor(prev, { ...next, summary: "Kickoff (moved)" }, false), "all");
  assert.equal(sendUpdatesFor(prev, { ...next, location: "Office" }, false), "all");
  assert.equal(sendUpdatesFor(prev, { ...next, attendees: [...next.attendees!, { email: "b@x.io" }] }, false), "all");
  assert.equal(sendUpdatesFor(prev, next, true), "all"); // Meet added
  assert.equal(sendUpdatesFor({ ...prev, status: "cancelled" }, next, false), "all"); // restored
  // no guests at all → never notify
  const solo = toGoogleEvent(base());
  assert.equal(sendUpdatesFor({ ...solo, summary: "x" }, solo, false), "none");
  // a one-off event changing zone label only is not material; a recurring one is
  assert.equal(isMaterialChange({ ...prev, start: { ...prev.start, timeZone: "UTC" } }, next, false), false);
  const weekly = toGoogleEvent({ ...ev, recurrence: "weekly" });
  assert.equal(isMaterialChange({ ...weekly, start: { ...weekly.start, timeZone: "UTC" } }, weekly, false), true);
  assert.equal(sendUpdatesForInsert(next), "all");
  assert.equal(sendUpdatesForInsert(solo), "none");
});

test("error classification drives retry / final / revoke", () => {
  assert.equal(classifyGoogleError(409, {}).kind, "conflict");
  assert.equal(classifyGoogleError(404, {}).kind, "not_found");
  assert.equal(classifyGoogleError(401, {}).kind, "unauthorized");
  assert.equal(classifyGoogleError(429, {}).kind, "retry");
  assert.equal(classifyGoogleError(503, {}).kind, "retry");
  assert.equal(classifyGoogleError(0, {}).kind, "retry");
  assert.equal(classifyGoogleError(412, {}).kind, "retry");
  assert.equal(classifyGoogleError(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }).kind, "retry");
  assert.equal(classifyGoogleError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }).kind, "revoked");
  assert.equal(classifyGoogleError(403, { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }).kind, "revoked");
  assert.equal(classifyGoogleError(403, { error: { errors: [{ reason: "forbiddenForNonOrganizer" }] } }).kind, "failed");
  const bad = classifyGoogleError(400, { error: { message: "Invalid\n  recurrence rule." } });
  assert.deepEqual(bad, { kind: "failed", message: "Google Calendar 400: Invalid recurrence rule." });
});

test("backoff mirrors google_sync_backoff(): 1, 2, 4 … capped at 6 h", () => {
  assert.deepEqual([1, 2, 3, 4, 9, 10, 20].map(retryDelayMinutes), [1, 2, 4, 8, 256, 360, 360]);
});

test("Add to Google Calendar link (C1b)", () => {
  const u = new URL(googleTemplateUrl(base({ recurrence: "weekly", recurrence_until: "2026-12-31", location: "Office", description: "Agenda" })));
  assert.equal(u.origin + u.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(u.searchParams.get("action"), "TEMPLATE");
  assert.equal(u.searchParams.get("text"), "Kickoff");
  assert.equal(u.searchParams.get("dates"), "20261102T010000Z/20261102T020000Z");
  assert.equal(u.searchParams.get("ctz"), "Asia/Manila");
  assert.equal(u.searchParams.get("recur"), "RRULE:FREQ=WEEKLY;UNTIL=20261231T155959Z");
  assert.equal(u.searchParams.get("location"), "Office");
  const allDay = new URL(googleTemplateUrl(base({ all_day: true, starts_at: "2026-11-01T16:00:00.000Z", ends_at: "2026-11-02T15:59:00.000Z" })));
  assert.equal(allDay.searchParams.get("dates"), "20261102/20261103");
});
