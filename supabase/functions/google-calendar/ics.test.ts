// node --test "supabase/functions/google-calendar/*.test.ts"   (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, escapeText, foldLine, vtimezone, type FeedData, type FeedEvent } from "./ics.ts";

const NOW = Date.parse("2026-10-03T00:00:00Z");
const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  kind: "meeting",
  title: "Kickoff",
  starts_at: "2026-11-02T01:00:00.000Z",
  ends_at: "2026-11-02T02:00:00.000Z",
  all_day: false,
  recurrence: "none",
  timezone: "Asia/Manila",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-02T00:00:00.000Z",
  ...over,
});
const feed = (events: FeedEvent[]): FeedData => ({ owner: "Member", scope: "mine", default_time_zone: "Asia/Manila", events });
/** Unfolded content lines. */
const lines = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

test("text escaping and 75-octet folding (UTF-8 safe)", () => {
  assert.equal(escapeText("a, b; c\\d\nnext"), "a\\, b\\; c\\\\d\\nnext");
  assert.equal(foldLine("short"), "short");
  const long = "DESCRIPTION:" + "é".repeat(80);
  const folded = foldLine(long);
  for (const part of folded.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(folded.replace(/\r\n /g, ""), long);
});

test("document shape: CRLF, calendar name, no secrets or notes", () => {
  const ics = buildIcs(feed([ev({ description: "Agenda" })]), NOW);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.doesNotMatch(ics.replace(/\r\n/g, ""), /[^\r]\n/);
  const l = lines(ics);
  assert.ok(l.includes("X-WR-CALNAME:DeskDev · Member"));
  assert.ok(l.includes("X-WR-TIMEZONE:Asia/Manila"));
  assert.ok(l.includes("UID:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0@deskdev"));
  assert.ok(l.includes("DESCRIPTION:Agenda"));
  assert.ok(l.includes("DTSTAMP:20261002T000000Z"));
  assert.ok(l.includes("CREATED:20261001T000000Z"));
});

test("one-off timed events are UTC; no VTIMEZONE needed", () => {
  const l = lines(buildIcs(feed([ev()]), NOW));
  assert.ok(l.includes("DTSTART:20261102T010000Z"));
  assert.ok(l.includes("DTEND:20261102T020000Z"));
  assert.ok(!l.includes("BEGIN:VTIMEZONE"));
});

test("recurring timed events keep their wall-clock time across DST (TZID + VTIMEZONE)", () => {
  const weekly = ev({
    timezone: "America/New_York",
    recurrence: "weekly",
    recurrence_until: "2027-06-30",
    starts_at: "2026-10-05T13:00:00.000Z", // Monday 09:00 EDT
    ends_at: "2026-10-05T14:00:00.000Z",
  });
  const l = lines(buildIcs(feed([weekly]), NOW));
  assert.ok(l.includes("DTSTART;TZID=America/New_York:20261005T090000"));
  assert.ok(l.includes("DTEND;TZID=America/New_York:20261005T100000"));
  assert.ok(l.includes("RRULE:FREQ=WEEKLY;UNTIL=20270701T035959Z"));
  assert.ok(l.includes("BEGIN:VTIMEZONE") && l.includes("TZID:America/New_York"));
  // the November fall-back and the March spring-forward are both described
  assert.ok(l.includes("DTSTART:20261101T020000") && l.includes("TZOFFSETTO:-0500"));
  assert.ok(l.includes("DTSTART:20270314T020000") && l.includes("TZOFFSETTO:-0400"));
});

test("VTIMEZONE observances: STANDARD/DAYLIGHT with the right offsets; a zone without DST is one block", () => {
  const ny = vtimezone("America/New_York", Date.parse("2026-01-01T00:00:00Z"), Date.parse("2027-01-01T00:00:00Z"));
  const text = ny.join("\n");
  assert.match(text, /BEGIN:DAYLIGHT\nDTSTART:20260308T020000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400\nEND:DAYLIGHT/);
  assert.match(text, /BEGIN:STANDARD\nDTSTART:20261101T020000\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500\nEND:STANDARD/);
  const mnl = vtimezone("Asia/Manila", Date.parse("2026-01-01T00:00:00Z"), Date.parse("2027-01-01T00:00:00Z"));
  assert.equal(mnl.filter((x) => x.startsWith("BEGIN:STANDARD")).length, 1);
  assert.ok(mnl.includes("TZOFFSETTO:+0800"));
});

test("all-day events are DATE values with an exclusive end", () => {
  const l = lines(buildIcs(feed([ev({ all_day: true, starts_at: "2026-11-01T16:00:00.000Z", ends_at: "2026-11-03T15:59:00.000Z" })]), NOW));
  assert.ok(l.includes("DTSTART;VALUE=DATE:20261102"));
  assert.ok(l.includes("DTEND;VALUE=DATE:20261104"));
});

test("links: http(s) only as URL; a bad row is skipped, not fatal", () => {
  const l = lines(buildIcs(feed([
    ev({ meeting_link: "https://zoom.us/j/1" }),
    ev({ id: "11111111-1111-1111-1111-111111111111", meeting_link: "javascript:alert(1)" }),
    ev({ id: "22222222-2222-2222-2222-222222222222", starts_at: "nope" }),
  ]), NOW));
  assert.ok(l.includes("URL:https://zoom.us/j/1"));
  assert.ok(!l.some((x) => x.includes("javascript:")));
  assert.equal(l.filter((x) => x === "BEGIN:VEVENT").length, 2);
});

test("an empty feed is still a valid calendar", () => {
  const ics = buildIcs({ owner: "", scope: "all", default_time_zone: "", events: [] }, NOW);
  const l = lines(ics);
  assert.ok(l.includes("X-WR-CALNAME:DeskDev · Calendar"));
  assert.ok(l.includes("X-WR-TIMEZONE:UTC"));
  assert.ok(!l.includes("BEGIN:VEVENT"));
});
