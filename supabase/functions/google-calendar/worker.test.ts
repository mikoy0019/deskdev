// node --test "supabase/functions/google-calendar/*.test.ts"   (Node 22.6+ strips the types)
//
// The outbox worker against an in-memory Google Calendar and an in-memory
// store: what is sent, when guests are notified, and what each failure does
// to the outbox row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { googleEventId, type EventRow, type GoogleEvent } from "./mapping.ts";
import { drain, type CompleteExtra, type OutboxRow, type Store, type WorkerDeps } from "./worker.ts";

const ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const GID = googleEventId(ID);

const event = (over: Partial<EventRow> = {}): EventRow => ({
  id: ID,
  kind: "meeting",
  title: "Kickoff",
  starts_at: "2026-11-02T01:00:00.000Z",
  ends_at: "2026-11-02T02:00:00.000Z",
  all_day: false,
  recurrence: "none",
  timezone: "Asia/Manila",
  sync_google: true,
  add_meet: false,
  google_event_id: null,
  default_time_zone: "Asia/Manila",
  attendees: [],
  ...over,
});

// ---------------------------------------------------------------- fake Google

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

class FakeGoogle {
  calendars = new Map<string, { summary: string; timeZone: string }>();
  events = new Map<string, GoogleEvent>(); // key: calendarId/eventId
  calls: Call[] = [];
  /** Queued forced answers: the first matching one is used once. */
  forced: { method: string; match: RegExp; status: number; body?: unknown }[] = [];
  token = "t1";
  private seq = 0;

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const path = url.pathname.replace("/calendar/v3", "");
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path, query: url.searchParams, body, headers });
    const reply = (status: number, data?: unknown) =>
      new Response(data === undefined || status === 204 ? null : JSON.stringify(data), { status });

    const i = this.forced.findIndex((f) => f.method === method && f.match.test(path));
    if (i >= 0) {
      const [f] = this.forced.splice(i, 1);
      return reply(f.status, f.body ?? { error: { code: f.status, message: `forced ${f.status}` } });
    }
    if (headers.Authorization !== `Bearer ${this.token}`) return reply(401, { error: { code: 401, message: "Invalid Credentials" } });

    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/calendars") {
      const id = `cal${++this.seq}@group.calendar.google.com`;
      this.calendars.set(id, body as { summary: string; timeZone: string });
      return reply(200, { id, ...(body as object) });
    }
    if ((m = path.match(/^\/calendars\/([^/]+)$/))) {
      const cal = decodeURIComponent(m[1]);
      if (method === "DELETE") return reply(this.calendars.delete(cal) ? 204 : 404);
      return this.calendars.has(cal) ? reply(200, { id: cal }) : reply(404, { error: { code: 404, message: "Not Found" } });
    }
    if ((m = path.match(/^\/calendars\/([^/]+)\/events$/)) && method === "POST") {
      const cal = decodeURIComponent(m[1]);
      if (!this.calendars.has(cal)) return reply(404, { error: { code: 404, message: "Not Found" } });
      const ev = body as GoogleEvent;
      const key = `${cal}/${ev.id}`;
      if (this.events.has(key)) return reply(409, { error: { code: 409, message: "The requested identifier already exists." } });
      return reply(200, this.store(key, ev));
    }
    if ((m = path.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
      const cal = decodeURIComponent(m[1]);
      const key = `${cal}/${decodeURIComponent(m[2])}`;
      if (!this.calendars.has(cal)) return reply(404, { error: { code: 404, message: "Not Found" } });
      const cur = this.events.get(key);
      if (method === "GET") return cur ? reply(200, cur) : reply(404, { error: { code: 404, message: "Not Found" } });
      if (method === "DELETE") {
        if (!cur || cur.status === "cancelled") return reply(410, { error: { code: 410, message: "Resource has been deleted" } });
        cur.status = "cancelled";
        return reply(204);
      }
      if (method === "PUT") {
        if (!cur) return reply(404, { error: { code: 404, message: "Not Found" } });
        if (headers["If-Match"] && headers["If-Match"] !== cur.etag) return reply(412, { error: { code: 412, message: "Precondition Failed" } });
        return reply(200, this.store(key, { ...(body as GoogleEvent), id: cur.id }));
      }
    }
    return reply(400, { error: { code: 400, message: `unhandled ${method} ${path}` } });
  };

  /** Store like Google: new etag, a Meet for a createRequest, organizer added. */
  private store(key: string, ev: GoogleEvent): GoogleEvent {
    const saved: GoogleEvent = { ...ev, etag: `"e${++this.seq}"`, status: ev.status ?? "confirmed" };
    if (ev.conferenceData?.createRequest) {
      saved.conferenceData = {
        conferenceId: `meet-${this.seq}`,
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", uri: `https://meet.google.com/aaa-bbbb-${this.seq}` }],
      };
      saved.hangoutLink = `https://meet.google.com/aaa-bbbb-${this.seq}`;
    }
    this.events.set(key, saved);
    return saved;
  }

  only(method: string, re: RegExp) {
    return this.calls.filter((c) => c.method === method && re.test(c.path));
  }
}

// ---------------------------------------------------------------- fake store

class FakeStore implements Store {
  rows: OutboxRow[] = [];
  completed: { id: number; result: string; extra?: CompleteExtra }[] = [];
  released: number[] = [];
  calendarId: string | null = null;
  revoked: string[] = [];
  lost: string[] = [];
  kicks = 0;
  /** Simulates another run having stored a calendar first. */
  raceWinner: string | null = null;

  add(row: Partial<OutboxRow> & { event: EventRow | null }): OutboxRow {
    const r: OutboxRow = { id: this.rows.length + 1, event_id: ID, op: "upsert", google_event_id: null, attempts: 1, ...row };
    this.rows.push(r);
    return r;
  }
  async claim(limit: number) {
    return this.rows.splice(0, limit);
  }
  async complete(id: number, result: "done" | "retry" | "failed", extra?: CompleteExtra) {
    this.completed.push({ id, result, extra });
  }
  async release(ids: number[]) {
    this.released.push(...ids);
  }
  async calendar() {
    return { calendarId: this.calendarId, timeZone: null };
  }
  async setCalendar(id: string) {
    if (this.raceWinner) return (this.calendarId = this.raceWinner);
    return (this.calendarId = this.calendarId ?? id);
  }
  async calendarLost(id: string) {
    this.lost.push(id);
    this.calendarId = null;
  }
  async markRevoked(reason: string) {
    this.revoked.push(reason);
  }
  async defaultTimeZone() {
    return "Asia/Manila";
  }
  async kick() {
    this.kicks++;
  }
}

class Reauth extends Error {}

function setup(over: Partial<WorkerDeps> = {}) {
  const google = new FakeGoogle();
  const store = new FakeStore();
  let tokenCalls = 0;
  const deps: WorkerDeps = {
    store,
    fetch: google.fetch as typeof fetch,
    accessToken: async () => {
      tokenCalls++;
      return google.token;
    },
    isReauth: (err) => err instanceof Reauth,
    now: () => 1_700_000_000_000,
    ...over,
  };
  return { google, store, deps, tokenCalls: () => tokenCalls };
}

// ---------------------------------------------------------------- tests

test("first run creates the NixGen Team calendar once, then inserts with the deterministic id", async () => {
  const { google, store, deps } = setup();
  store.add({ event: event() });
  const r = await drain(deps);
  assert.equal(r.status, "ok");
  assert.equal(r.done, 1);
  assert.equal(google.calendars.size, 1);
  const [cal] = [...google.calendars.values()];
  assert.deepEqual(cal, { summary: "NixGen Team", description: "Team schedule", timeZone: "Asia/Manila" });
  const ins = google.only("POST", /\/events$/);
  assert.equal(ins.length, 1);
  assert.equal((ins[0].body as GoogleEvent).id, GID);
  assert.equal(ins[0].query.get("conferenceDataVersion"), "1");
  assert.equal(ins[0].query.get("sendUpdates"), "none"); // nobody to invite
  assert.equal(store.completed[0].result, "done");
  assert.equal(store.completed[0].extra?.googleEventId, GID);
  assert.match(store.completed[0].extra?.etag ?? "", /^"e\d+"$/);

  // A second run reuses the stored calendar.
  store.add({ event: event({ google_event_id: GID }) });
  await drain(deps);
  assert.equal(google.only("POST", /^\/calendars$/).length, 1);
});

test("guests are invited on insert; Meet is requested when add_meet is on and its link reported back", async () => {
  const { google, store, deps } = setup();
  store.add({ event: event({ add_meet: true, attendees: [{ email: "client@example.com", display_name: "Client" }] }) });
  await drain(deps);
  const [ins] = google.only("POST", /\/events$/);
  assert.equal(ins.query.get("sendUpdates"), "all");
  assert.deepEqual((ins.body as GoogleEvent).conferenceData?.createRequest?.conferenceSolutionKey, { type: "hangoutsMeet" });
  assert.equal((ins.body as GoogleEvent).conferenceData?.createRequest?.requestId, `${GID}-meet`);
  assert.match(store.completed[0].extra?.meetUrl ?? "", /^https:\/\/meet\.google\.com\//);
});

test("a retried insert after a lost response updates the existing event: no duplicate, no second invite", async () => {
  const { google, store, deps } = setup();
  const ev = event({ attendees: [{ email: "client@example.com" }] });
  store.add({ event: ev });
  await drain(deps);
  // Google stored it, but DeskDev never heard back (google_event_id still null).
  store.add({ event: ev });
  const r = await drain(deps);
  assert.equal(r.done, 1);
  assert.equal(google.events.size, 1);
  const puts = google.only("PUT", /\/events\//);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].query.get("sendUpdates"), "none"); // nothing guests care about changed
  assert.ok(puts[0].headers["If-Match"], "the update is conditional on the etag just read");
});

test("updates: description-only edits stay quiet, time changes notify, RSVPs survive", async () => {
  const { google, store, deps } = setup();
  const ev = event({ attendees: [{ email: "client@example.com" }] });
  store.add({ event: ev });
  await drain(deps);
  const key = [...google.events.keys()][0];
  google.events.get(key)!.attendees = [{ email: "client@example.com", responseStatus: "accepted" }];

  store.add({ event: { ...ev, google_event_id: GID, description: "Agenda v2" } });
  await drain(deps);
  let put = google.only("PUT", /\/events\//).at(-1)!;
  assert.equal(put.query.get("sendUpdates"), "none");
  assert.deepEqual((put.body as GoogleEvent).attendees, [{ email: "client@example.com", responseStatus: "accepted" }]);

  store.add({ event: { ...ev, google_event_id: GID, starts_at: "2026-11-02T03:00:00.000Z", ends_at: "2026-11-02T04:00:00.000Z" } });
  await drain(deps);
  put = google.only("PUT", /\/events\//).at(-1)!;
  assert.equal(put.query.get("sendUpdates"), "all");
  assert.equal(google.events.get(key)!.attendees![0].responseStatus, "accepted");
});

test("Meet switched on later is created; switched off is removed", async () => {
  const { google, store, deps } = setup();
  store.add({ event: event() });
  await drain(deps);
  store.add({ event: event({ google_event_id: GID, add_meet: true }) });
  await drain(deps);
  const key = [...google.events.keys()][0];
  assert.ok(google.events.get(key)!.hangoutLink);
  assert.match(store.completed.at(-1)!.extra?.meetUrl ?? "", /^https:\/\/meet\.google\.com\//);
  store.add({ event: event({ google_event_id: GID, add_meet: false }) });
  await drain(deps);
  const put = google.only("PUT", /\/events\//).at(-1)!;
  assert.equal("conferenceData" in (put.body as object), false);
});

test("delete: cancellation sent to guests; already gone counts as done", async () => {
  const { google, store, deps } = setup();
  store.add({ event: event() });
  await drain(deps);
  store.add({ op: "delete", google_event_id: GID, event: null });
  await drain(deps);
  const del = google.only("DELETE", /\/events\//);
  assert.equal(del.length, 1);
  assert.equal(del[0].query.get("sendUpdates"), "all");
  assert.equal(store.completed.at(-1)!.result, "done");
  store.add({ op: "delete", google_event_id: GID, event: null });
  await drain(deps); // 410 from Google
  assert.equal(store.completed.at(-1)!.result, "done");
});

test("a deleted event switched back on is restored through the update path", async () => {
  const { google, store, deps } = setup();
  store.add({ event: event({ attendees: [{ email: "client@example.com" }] }) });
  await drain(deps);
  store.add({ op: "delete", google_event_id: GID, event: null });
  await drain(deps);
  store.add({ event: event({ attendees: [{ email: "client@example.com" }] }) }); // google_event_id was cleared
  await drain(deps);
  const ev = [...google.events.values()][0];
  assert.equal(ev.status, "confirmed");
  assert.equal(google.only("PUT", /\/events\//).at(-1)!.query.get("sendUpdates"), "all"); // guests learn it is back
});

test("upsert for an event that is gone or switched off is a no-op", async () => {
  const { google, store, deps } = setup();
  store.add({ event: null });
  store.add({ event: event({ sync_google: false }) });
  const r = await drain(deps);
  assert.equal(r.done, 2);
  assert.equal(google.only("POST", /\/events$/).length, 0);
});

test("transient errors retry, content errors fail for good", async () => {
  const { google, store, deps } = setup();
  google.calendars.set("c1", { summary: "NixGen Team", timeZone: "UTC" });
  store.calendarId = "c1";
  google.forced.push({ method: "POST", match: /\/events$/, status: 429, body: { error: { code: 429, message: "Rate Limit Exceeded" } } });
  google.forced.push({ method: "POST", match: /\/events$/, status: 400, body: { error: { code: 400, message: "Invalid recurrence rule" } } });
  google.forced.push({ method: "POST", match: /\/events$/, status: 503 });
  store.add({ event: event() });
  store.add({ event: event({ id: "11111111-1111-1111-1111-111111111111" }) });
  store.add({ event: event({ id: "22222222-2222-2222-2222-222222222222" }) });
  const r = await drain(deps);
  assert.deepEqual(store.completed.map((c) => c.result), ["retry", "failed", "retry"]);
  assert.equal(store.completed[1].extra?.error, "Google Calendar 400: Invalid recurrence rule");
  assert.deepEqual([r.retried, r.failed], [2, 1]);
});

test("an expired access token is refreshed once and the push goes through", async () => {
  const { google, store, deps } = setup();
  google.calendars.set("c1", { summary: "NixGen Team", timeZone: "UTC" });
  store.calendarId = "c1";
  let calls = 0;
  deps.accessToken = async () => (calls++ === 0 ? "stale" : google.token);
  store.add({ event: event() });
  const r = await drain(deps);
  assert.equal(r.done, 1);
  assert.equal(calls, 2);
  assert.equal(google.only("POST", /\/events$/).length, 2); // 401, then the retry with the fresh token
});

test("a dead grant at start: nothing is claimed (the shared module already marked it revoked)", async () => {
  const { store, deps } = setup({ accessToken: async () => { throw new Reauth("invalid_grant"); } });
  store.add({ event: event() });
  const r = await drain(deps);
  assert.equal(r.status, "revoked");
  assert.equal(store.rows.length, 1); // still queued for after the reconnect
  assert.deepEqual(store.completed, []);
});

test("the grant dies mid-run: the rest is released untouched", async () => {
  const { google, store, deps } = setup();
  google.calendars.set("c1", { summary: "NixGen Team", timeZone: "UTC" });
  store.calendarId = "c1";
  let n = 0;
  deps.accessToken = async () => {
    if (n++ === 0) return "stale"; // first call: a token Google refuses → refresh → dead
    throw new Reauth("invalid_grant");
  };
  store.add({ event: event() });
  store.add({ event: event({ id: "11111111-1111-1111-1111-111111111111" }) });
  const r = await drain(deps);
  assert.equal(r.status, "revoked");
  assert.deepEqual(store.released, [1, 2]);
  assert.deepEqual(store.completed, []);
});

test("calendar scope missing: link marked revoked (admins are told by the database), rows released", async () => {
  const { google, store, deps } = setup();
  google.calendars.set("c1", { summary: "NixGen Team", timeZone: "UTC" });
  store.calendarId = "c1";
  google.forced.push({ method: "POST", match: /\/events$/, status: 403, body: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } } });
  store.add({ event: event() });
  store.add({ event: event({ id: "11111111-1111-1111-1111-111111111111" }) });
  const r = await drain(deps);
  assert.equal(r.status, "revoked");
  assert.deepEqual(store.revoked, ["calendar scope missing"]);
  assert.deepEqual(store.released, [1, 2]);

  // Same when the calendar cannot even be created.
  const s2 = setup();
  s2.google.forced.push({ method: "POST", match: /^\/calendars$/, status: 403, body: { error: { code: 403, details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } });
  s2.store.add({ event: event() });
  assert.equal((await drain(s2.deps)).status, "revoked");
  assert.deepEqual(s2.store.revoked, ["calendar scope missing"]);
});

test("the team calendar was deleted in Google: forgotten (everything re-queued), rows released", async () => {
  const { store, deps } = setup();
  store.calendarId = "deleted@group.calendar.google.com"; // unknown to the fake Google
  store.add({ event: event() });
  const r = await drain(deps);
  assert.equal(r.status, "calendar_lost");
  assert.deepEqual(store.lost, ["deleted@group.calendar.google.com"]);
  assert.deepEqual(store.released, [1]);
});

test("two runs raced to create the calendar: the loser deletes its empty copy", async () => {
  const { google, store, deps } = setup();
  google.calendars.set("winner@group.calendar.google.com", { summary: "NixGen Team", timeZone: "UTC" });
  store.raceWinner = "winner@group.calendar.google.com";
  store.add({ event: event() });
  const r = await drain(deps);
  assert.equal(r.calendarId, "winner@group.calendar.google.com");
  assert.equal(google.calendars.size, 1);
  assert.equal(google.only("DELETE", /^\/calendars\/[^/]+$/).length, 1);
  assert.equal(google.only("POST", /\/events$/)[0].path.includes(encodeURIComponent("winner@group.calendar.google.com")), true);
});

test("someone edited the event in Google between read and write: 412 → retry", async () => {
  const { google, store, deps } = setup();
  store.add({ event: event() });
  await drain(deps);
  google.forced.push({ method: "PUT", match: /\/events\//, status: 412 });
  store.add({ event: event({ google_event_id: GID, title: "Renamed" }) });
  await drain(deps);
  assert.equal(store.completed.at(-1)!.result, "retry");
});

test("a bug on one row does not stop the others; the budget hands over to the next kick", async () => {
  const { google, store, deps } = setup();
  google.calendars.set("c1", { summary: "NixGen Team", timeZone: "UTC" });
  store.calendarId = "c1";
  store.add({ event: event({ starts_at: "not a date" }) });
  store.add({ event: event({ id: "11111111-1111-1111-1111-111111111111" }) });
  const r = await drain(deps);
  assert.deepEqual(store.completed.map((c) => c.result), ["retry", "done"]);
  assert.equal(store.completed[0].extra?.error, "Unexpected sync error");
  assert.equal(r.status, "ok");

  let t = 0;
  const s2 = setup({ now: () => (t += 30_000) });
  s2.google.calendars.set("c1", { summary: "NixGen Team", timeZone: "UTC" });
  s2.store.calendarId = "c1";
  for (let i = 0; i < 3; i++) s2.store.add({ event: event() });
  const r2 = await drain(s2.deps, { batch: 1, budgetMs: 45_000 });
  assert.equal(r2.status, "budget");
  assert.equal(s2.store.kicks, 1);
  assert.ok(s2.store.rows.length > 0, "the rest stays queued");
});
