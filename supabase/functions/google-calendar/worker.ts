// DeskDev Studio — the Team Calendar outbox worker (C1).
//
// Drains public.google_sync_outbox: claims due rows, pushes each event's
// CURRENT state to the "NixGen Team" calendar, and reports back through
// google_sync_complete (which is also the loop guard: its write-back never
// queues another push). Everything outside this file is injected (Store,
// fetch, the access token), so worker.test.ts runs it against a fake Google
// under Node; index.ts wires the real ones.

import {
  classifyGoogleError,
  googleEventId,
  type EventRow,
  type GoogleEvent,
  meetUrl,
  mergeForUpdate,
  sendUpdatesFor,
  sendUpdatesForInsert,
  TEAM_CALENDAR_NAME,
  toGoogleEvent,
} from "./mapping.ts";

export interface OutboxRow {
  id: number;
  event_id: string;
  op: "upsert" | "delete";
  google_event_id: string | null;
  attempts: number;
  event: EventRow | null;
}

export interface CompleteExtra {
  error?: string | null;
  googleEventId?: string | null;
  etag?: string | null;
  meetUrl?: string | null;
}

/** The database side, all through service-role RPCs from migration 040. */
export interface Store {
  claim(limit: number): Promise<OutboxRow[]>;
  complete(id: number, result: "done" | "retry" | "failed", extra?: CompleteExtra): Promise<void>;
  release(ids: number[]): Promise<void>;
  calendar(): Promise<{ calendarId: string | null; timeZone: string | null }>;
  setCalendar(calendarId: string, timeZone: string | null): Promise<string>;
  calendarLost(calendarId: string): Promise<void>;
  markRevoked(reason: string): Promise<void>;
  defaultTimeZone(): Promise<string>;
  /** Wake the worker again (google_calendar_kick(true)) when the budget ran out. */
  kick(): Promise<void>;
}

export interface WorkerDeps {
  store: Store;
  fetch: typeof fetch;
  /** A fresh access token for the company grant; throws when the grant is dead. */
  accessToken(): Promise<string>;
  /** Is this error "the grant is dead, reconnect" (the shared module's ReauthRequired)? */
  isReauth(err: unknown): boolean;
  now?: () => number;
  log?: (msg: string, detail?: unknown) => void;
}

export interface DrainOptions {
  batch?: number;
  /** Stop claiming after this long; the rest goes on the next kick. Edge functions have ~150 s. */
  budgetMs?: number;
  /** Per Google request. */
  timeoutMs?: number;
}

export interface DrainResult {
  status: "ok" | "revoked" | "calendar_lost" | "budget";
  processed: number;
  done: number;
  retried: number;
  failed: number;
  calendarId: string | null;
}

const API = "https://www.googleapis.com/calendar/v3";

interface Resp {
  status: number;
  data: unknown;
}

/** A tiny Calendar API client: JSON in/out, one token refresh on 401, network errors as status 0. */
class Google {
  private token: string | null = null;
  private deps: WorkerDeps;
  private timeoutMs: number;

  constructor(deps: WorkerDeps, timeoutMs: number) {
    this.deps = deps;
    this.timeoutMs = timeoutMs;
  }

  async init(): Promise<void> {
    this.token = await this.deps.accessToken();
  }

  async call(
    method: string,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown; ifMatch?: string } = {},
  ): Promise<Resp> {
    const url = `${API}${path}${opts.query ? `?${new URLSearchParams(opts.query)}` : ""}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
      let res: Response;
      try {
        res = await this.deps.fetch(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        return { status: 0, data: { error: { message: err instanceof Error ? err.name : "network error" } } };
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (res.status === 401 && attempt === 0) {
        this.token = await this.deps.accessToken(); // throws ReauthRequired when the grant is dead
        continue;
      }
      return { status: res.status, data };
    }
    return { status: 401, data: null };
  }
}

/** Thrown inside a row to stop the whole drain. */
class Stop extends Error {
  status: "revoked" | "calendar_lost";
  reason: string;
  constructor(status: "revoked" | "calendar_lost", reason: string) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

type RowOutcome =
  | { result: "done"; extra?: CompleteExtra }
  | { result: "retry" | "failed"; error: string };

const enc = (s: string) => encodeURIComponent(s);
const ok = (s: number) => s >= 200 && s < 300;

async function ensureCalendar(g: Google, store: Store): Promise<string> {
  const current = await store.calendar();
  if (current.calendarId) return current.calendarId;

  const timeZone = await store.defaultTimeZone();
  const res = await g.call("POST", "/calendars", {
    body: { summary: TEAM_CALENDAR_NAME, description: "Team schedule", timeZone },
  });
  if (!ok(res.status)) {
    const c = classifyGoogleError(res.status, res.data);
    if (c.kind === "revoked") throw new Stop("revoked", "calendar scope missing");
    throw new Error(`could not create the team calendar: ${c.message}`);
  }
  const created = String((res.data as { id?: string }).id ?? "");
  if (!created) throw new Error("Google created a calendar without an id");
  const winner = await store.setCalendar(created, timeZone);
  if (winner !== created) {
    // Another run created one first; ours is an empty duplicate.
    await g.call("DELETE", `/calendars/${enc(created)}`);
  }
  return winner;
}

/** A 404 on an event call: is the calendar itself gone (deleted in Google)? */
async function calendarGone(g: Google, calendarId: string): Promise<boolean> {
  const res = await g.call("GET", `/calendars/${enc(calendarId)}`);
  return res.status === 404 || res.status === 410;
}

function fail(status: number, data: unknown): RowOutcome {
  const c = classifyGoogleError(status, data);
  if (c.kind === "revoked") throw new Stop("revoked", "calendar scope missing");
  return { result: c.kind === "failed" ? "failed" : "retry", error: c.message };
}

function doneWith(data: unknown): RowOutcome {
  const g = (data ?? {}) as GoogleEvent;
  return { result: "done", extra: { googleEventId: g.id ?? null, etag: g.etag ?? null, meetUrl: meetUrl(g) } };
}

async function pushDelete(g: Google, calendarId: string, row: OutboxRow): Promise<RowOutcome> {
  const id = row.google_event_id || googleEventId(row.event_id);
  // 'all': guests get a cancellation (Google sends nothing when there are none).
  const res = await g.call("DELETE", `/calendars/${enc(calendarId)}/events/${enc(id)}`, { query: { sendUpdates: "all" } });
  if (ok(res.status) || res.status === 404 || res.status === 410) return { result: "done" };
  return fail(res.status, res.data);
}

async function insert(g: Google, calendarId: string, ev: EventRow): Promise<Resp> {
  const body = toGoogleEvent(ev, { meetRequestId: `${googleEventId(ev.id)}-meet` });
  return g.call("POST", `/calendars/${enc(calendarId)}/events`, {
    query: { conferenceDataVersion: "1", sendUpdates: sendUpdatesForInsert(body) },
    body,
  });
}

async function pushUpsert(g: Google, calendarId: string, row: OutboxRow, now: number): Promise<RowOutcome> {
  const ev = row.event;
  // Gone, or switched off: a delete row for it is queued (or already ran).
  if (!ev || !ev.sync_google) return { result: "done" };

  const id = ev.google_event_id || googleEventId(ev.id);
  const path = `/calendars/${enc(calendarId)}/events/${enc(id)}`;

  if (!ev.google_event_id) {
    const res = await insert(g, calendarId, ev);
    if (ok(res.status)) return doneWith(res.data);
    if (res.status === 404 && (await calendarGone(g, calendarId))) throw new Stop("calendar_lost", "calendar deleted in Google");
    // 409: the deterministic id exists (a lost response, or an event that was
    // deleted and is now back): fall through and update it.
    if (res.status !== 409) return fail(res.status, res.data);
  }

  const cur = await g.call("GET", path);
  if (cur.status === 404) {
    if (await calendarGone(g, calendarId)) throw new Stop("calendar_lost", "calendar deleted in Google");
    // Our stored id is unknown to Google (e.g. purged): create it again.
    const res = await insert(g, calendarId, ev);
    return ok(res.status) ? doneWith(res.data) : fail(res.status, res.data);
  }
  if (!ok(cur.status)) return fail(cur.status, cur.data);

  const prev = (cur.data ?? {}) as GoogleEvent;
  const wantMeet = Boolean(ev.add_meet);
  const next = toGoogleEvent(ev);
  const body = mergeForUpdate(next, prev, wantMeet, `${id}-meet-${now.toString(36)}`);
  const res = await g.call("PUT", path, {
    query: { conferenceDataVersion: "1", sendUpdates: sendUpdatesFor(prev, next, wantMeet) },
    body,
    // Someone edited it in Google between our read and write: 412, retried
    // with the fresh copy (DeskDev owns the content; C2 brings edits back).
    ifMatch: prev.etag,
  });
  return ok(res.status) ? doneWith(res.data) : fail(res.status, res.data);
}

/** Drain the outbox until it is empty, the budget runs out, or the grant/calendar is lost. */
export async function drain(deps: WorkerDeps, opts: DrainOptions = {}): Promise<DrainResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const started = now();
  const budget = opts.budgetMs ?? 45_000;
  const batch = opts.batch ?? 10;
  const out: DrainResult = { status: "ok", processed: 0, done: 0, retried: 0, failed: 0, calendarId: null };

  const g = new Google(deps, opts.timeoutMs ?? 15_000);
  try {
    await g.init();
    out.calendarId = await ensureCalendar(g, deps.store);
  } catch (err) {
    if (deps.isReauth(err)) return { ...out, status: "revoked" }; // the shared module marked the link revoked
    if (err instanceof Stop) {
      await deps.store.markRevoked(err.reason);
      return { ...out, status: err.status };
    }
    throw err;
  }
  const calendarId = out.calendarId;

  while (true) {
    if (now() - started > budget) {
      out.status = "budget";
      await deps.store.kick();
      return out;
    }
    const rows = await deps.store.claim(batch);
    if (rows.length === 0) return out;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let outcome: RowOutcome;
      try {
        outcome = row.op === "delete" ? await pushDelete(g, calendarId, row) : await pushUpsert(g, calendarId, row, now());
      } catch (err) {
        const rest = rows.slice(i).map((r) => r.id);
        if (deps.isReauth(err)) {
          await deps.store.release(rest);
          return { ...out, status: "revoked" };
        }
        if (err instanceof Stop) {
          await deps.store.release(rest);
          if (err.status === "revoked") await deps.store.markRevoked(err.reason);
          else await deps.store.calendarLost(calendarId); // forgets it and re-queues every synced event
          return { ...out, status: err.status };
        }
        // A bug or a bad row: retry it later, keep going with the others.
        log("google-calendar: row failed", { id: row.id, error: err instanceof Error ? err.message : String(err) });
        outcome = { result: "retry", error: "Unexpected sync error" };
      }

      out.processed++;
      if (outcome.result === "done") {
        out.done++;
        await deps.store.complete(row.id, "done", outcome.extra);
      } else {
        if (outcome.result === "failed") out.failed++;
        else out.retried++;
        await deps.store.complete(row.id, outcome.result, { error: outcome.error });
      }
    }
  }
}
