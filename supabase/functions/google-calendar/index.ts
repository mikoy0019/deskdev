// DeskDev Studio — google-calendar Edge Function (Team Calendar C1, feeds C1b, booking)
//
// Three jobs, none with a user session:
//
//   POST { action: 'drain' }   Authorization: Bearer <GOOGLE_CALENDAR_WEBHOOK_SECRET>
//     Called by the database (google_calendar_kick() through pg_net, after an
//     event edit commits, and by the 2-minute 'google-calendar-retry' cron).
//     Pushes queued DeskDev events to the "NixGen Team" calendar on the
//     company Google account → { status, processed, done, retried, failed }.
//
//   POST { action: 'slots' } | { action: 'book', start, name, email, … }
//                              x-booking-secret: <BOOKING_API_SECRET>
//     The booking page's server calls (migration 048), from the site Worker
//     (nixgensolutions.com/book). `slots`: business hours minus Google busy
//     (free/busy) and DeskDev busy (the host's events, recurrences expanded).
//     `book`: re-checks the slot, records it with booking_record (048: lead,
//     meeting, guests, notification) and pushes it to Google straight away,
//     so the Meet link and the invitation exist before the page answers.
//
//   GET /google-calendar/feed/<token>.ics   (also ?token=<token>)
//     A person's personal calendar feed (Settings → Calendar feed). The token
//     is the only credential; public.calendar_feed() looks up its SHA-256
//     with the ANON key, so this path holds no privilege at all.
//
// The POST actions are server-to-server only: no CORS headers are ever sent
// and a POST carrying an Origin header is refused, so a browser can't call
// them even with a leaked secret.
//
// Deploy with --no-verify-jwt (pg_net, the site Worker and calendar apps
// carry no Supabase JWT):
//   supabase functions deploy google-calendar --no-verify-jwt
// Runbook, secrets and the Vault entries: README.md.
//
// The drain's decisions live in mapping.ts and worker.ts (tested under Node),
// the booking page's in logic.ts (tested by the site's Vitest suite); this
// file does the I/O.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  accessTokenForWorkspace,
  ConfigError,
  cryptoFromEnv,
  denoEnv,
  ReauthRequired,
} from "../_shared/google_grants.ts";
import { SCOPE } from "../_shared/google_policy.ts";
import { buildIcs, type FeedData } from "./ics.ts";
import {
  blocksBooking,
  type BookingDay,
  bookingPayload,
  bookingSettingsFromRow,
  type BookingSettings,
  bookReason,
  busyFromEvents,
  busyFromFreeBusy,
  type BusyEventRow,
  type FreeBusyResponse,
  generateSlots,
  type Interval,
  parseBookInput,
  slotOffered,
  slotWindow,
} from "./logic.ts";
import { classifyGoogleError, isMeetUrl } from "./mapping.ts";
import { drain, type OutboxRow, type Store, type WorkerDeps } from "./worker.ts";

const env = (name: string) => denoEnv(name);

const text = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Constant-time string comparison (the drain and booking secrets). */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** The service-role client, or null when Supabase's own secrets are missing. */
function serviceClient(): SupabaseClient | null {
  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function rpcStore(admin: SupabaseClient): Store {
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.code ?? ""} ${error.message}`);
    return data as T;
  };
  return {
    claim: async (limit) => (await rpc<OutboxRow[] | null>("google_sync_claim", { p_limit: limit })) ?? [],
    complete: async (id, result, extra = {}) => {
      await rpc("google_sync_complete", {
        p_id: id,
        p_result: result,
        p_error: extra.error ?? null,
        p_google_event_id: extra.googleEventId ?? null,
        p_etag: extra.etag ?? null,
        p_meet_url: extra.meetUrl ?? null,
      });
    },
    release: async (ids) => {
      if (ids.length) await rpc("google_sync_release", { p_ids: ids });
    },
    calendar: async () => {
      const { data, error } = await admin
        .from("google_workspace_link").select("calendar_id, calendar_time_zone").eq("id", true).maybeSingle();
      if (error) throw new Error(`google_workspace_link: ${error.message}`);
      return { calendarId: data?.calendar_id ?? null, timeZone: data?.calendar_time_zone ?? null };
    },
    setCalendar: (calendarId, timeZone) =>
      rpc<string>("google_workspace_set_calendar", { p_calendar_id: calendarId, p_time_zone: timeZone }),
    calendarLost: async (calendarId) => {
      await rpc("google_workspace_calendar_lost", { p_calendar_id: calendarId });
    },
    markRevoked: async (reason) => {
      await rpc("google_workspace_mark_revoked", { p_reason: reason });
    },
    defaultTimeZone: async () => (await rpc<string | null>("google_calendar_default_tz")) ?? "UTC",
    kick: async () => {
      await rpc("google_calendar_kick", { p_force: true });
    },
  };
}

/** The real dependencies of worker.ts's drain. Throws ConfigError when the token keys are missing. */
function drainDeps(admin: SupabaseClient): WorkerDeps {
  const crypto = cryptoFromEnv(denoEnv);
  return {
    store: rpcStore(admin),
    fetch,
    accessToken: () => accessTokenForWorkspace(admin, crypto, denoEnv),
    isReauth: (err) => err instanceof ReauthRequired,
    log: (msg, detail) => console.error(msg, detail ?? ""),
  };
}

// ---------------------------------------------------------------- drain (040's worker)

async function handleDrain(req: Request): Promise<Response> {
  const secret = env("GOOGLE_CALENDAR_WEBHOOK_SECRET");
  if (!secret || secret.length < 32) {
    console.error("google-calendar: GOOGLE_CALENDAR_WEBHOOK_SECRET is missing or shorter than 32 characters");
    return json({ error: "not configured" }, 503);
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !sameSecret(auth.slice(7).trim(), secret)) {
    return json({ error: "unauthorized" }, 401);
  }
  let body: { action?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // an empty body is a drain too
  }
  if (body.action !== undefined && body.action !== "drain") return json({ error: "unknown action" }, 400);

  const admin = serviceClient();
  if (!admin) return json({ error: "not configured" }, 503);

  try {
    const result = await drain(drainDeps(admin));
    if (result.status !== "ok") console.warn("google-calendar drain:", result.status, result);
    return json(result);
  } catch (err) {
    // ConfigError (keys / OAuth client missing) and anything unexpected:
    // logged here, never echoed. The rows stay queued for the next kick.
    console.error("google-calendar drain failed:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    return json({ error: "drain failed" }, 500);
  }
}

// ---------------------------------------------------------------- booking (048)

/** The book action's inline push: the site waits about 8 s in total. */
const BOOK_PUSH_BUDGET_MS = 4_000;
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Booking could not be served right now (Google or the database failed). */
class Unavailable extends Error {}

interface SlotsResult {
  settings: BookingSettings;
  days: BookingDay[];
  google: "checked" | "team_only" | "not_connected";
}

async function loadSettings(admin: SupabaseClient): Promise<BookingSettings> {
  const { data, error } = await admin.from("workspace_settings").select("*").eq("id", true).maybeSingle();
  if (error) throw new Unavailable(`workspace_settings read failed: ${error.message}`);
  return bookingSettingsFromRow(data as Record<string, unknown> | null);
}

/** The host: booking_host_id when active, else the first active admin (048's rule, minus the lead). */
async function resolveHost(admin: SupabaseClient, hostId: string | null): Promise<string | null> {
  if (hostId) {
    const { data } = await admin.from("profiles").select("id, deactivated_at").eq("id", hostId).maybeSingle();
    if (data && !(data as { deactivated_at: string | null }).deactivated_at) return hostId;
  }
  const { data } = await admin
    .from("profiles").select("id").eq("role", "admin").is("deactivated_at", null)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function defaultTimeZone(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.rpc("google_calendar_default_tz");
  return typeof data === "string" && data ? data : "UTC";
}

const EVENT_COLUMNS = "id, starts_at, ends_at, all_day, recurrence, recurrence_until, timezone, created_by";

/** DeskDev events that could overlap the window: one-offs near it, and repeating ones not over yet. */
async function loadDeskdevBusy(admin: SupabaseClient, hostId: string | null, window: Interval, defaultTz: string): Promise<Interval[]> {
  const fromIso = new Date(window.start - 2 * 86_400_000).toISOString();
  const toIso = new Date(window.end).toISOString();
  const fromDate = fromIso.slice(0, 10);

  const query = async (columns: string) => {
    const [single, repeating] = await Promise.all([
      admin.from("events").select(columns).eq("recurrence", "none").gte("starts_at", fromIso).lt("starts_at", toIso),
      admin.from("events").select(columns).neq("recurrence", "none").lt("starts_at", toIso)
        .or(`recurrence_until.is.null,recurrence_until.gte.${fromDate}`),
    ]);
    return { error: single.error ?? repeating.error, rows: [...(single.data ?? []), ...(repeating.data ?? [])] as unknown as BusyEventRow[] };
  };
  // booked_via is 048's; before it is applied, read without it.
  let res = await query(`${EVENT_COLUMNS}, booked_via`);
  if (res.error && /booked_via/.test(res.error.message)) res = await query(EVENT_COLUMNS);
  if (res.error) throw new Unavailable(`events read failed: ${res.error.message}`);

  let hostEvents = new Set<string>();
  if (hostId) {
    const { data, error } = await admin.from("event_attendees").select("event_id").eq("profile_id", hostId);
    if (error && !/event_attendees/.test(error.message)) throw new Unavailable(`event_attendees read failed: ${error.message}`);
    hostEvents = new Set(((data ?? []) as { event_id: string }[]).map((r) => r.event_id));
  }
  return busyFromEvents(res.rows.filter((ev) => blocksBooking(ev, hostId, hostEvents)), window, defaultTz);
}

/** Google's free/busy for the given calendars. A network failure comes back as status 0, never thrown. */
async function freeBusy(token: string, body: unknown): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch (err) {
    console.error("google-calendar: Google unreachable (freeBusy)", err instanceof Error ? err.name : err);
    return { status: 0, data: null };
  }
}

/** Busy times on Google: the account's own calendar (with free/busy granted) and the team calendar. */
async function loadGoogleBusy(admin: SupabaseClient, window: Interval, tz: string): Promise<{ state: SlotsResult["google"]; busy: Interval[] }> {
  const { data, error } = await admin
    .from("google_workspace_link").select("status, scopes, calendar_id").eq("id", true).maybeSingle();
  if (error) console.error("google-calendar: workspace link unreadable", error.code, error.message);
  const link = (error ? null : data) as { status: string; scopes: string[] | null; calendar_id: string | null } | null;
  if (!link || link.status !== "active") return { state: "not_connected", busy: [] };

  let token: string;
  try {
    // The shared module marks a dead grant revoked (040's triggers tell the admins).
    token = await accessTokenForWorkspace(admin, cryptoFromEnv(denoEnv), denoEnv);
  } catch (err) {
    if (err instanceof ReauthRequired) return { state: "not_connected", busy: [] };
    if (err instanceof ConfigError) {
      console.error("google-calendar: Google secrets missing, slots use DeskDev only", err.message);
      return { state: "not_connected", busy: [] };
    }
    throw new Unavailable(`Google token: ${err instanceof Error ? err.message : err}`);
  }

  const freebusyGranted = (link.scopes ?? []).includes(SCOPE.calendarFreebusy);
  const ids = [...(freebusyGranted ? ["primary"] : []), ...(link.calendar_id ? [link.calendar_id] : [])];
  if (ids.length === 0) return { state: "team_only", busy: [] };

  const res = await freeBusy(token, {
    timeMin: new Date(window.start).toISOString(),
    timeMax: new Date(window.end).toISOString(),
    timeZone: tz,
    items: ids.map((id) => ({ id })),
  });
  // Better no slots than a double booking: when Google can't say, booking waits.
  if (res.status !== 200) throw new Unavailable(`freebusy: ${classifyGoogleError(res.status, res.data).message}`);
  const { busy, failed } = busyFromFreeBusy(res.data as FreeBusyResponse, ids);
  if (failed.length) console.error("google-calendar: freebusy could not read", failed.map((f) => (f === "primary" ? f : "team")));
  return { state: ids.includes("primary") && !failed.includes("primary") ? "checked" : "team_only", busy };
}

/** Free slots for enabled booking (callers check settings.enabled first: no Google call when it's off). */
async function computeSlots(admin: SupabaseClient, settings: BookingSettings, now: number): Promise<SlotsResult> {
  const window = slotWindow(now, settings);
  const host = await resolveHost(admin, settings.hostId);
  const defaultTz = await defaultTimeZone(admin);
  const [deskdev, google] = await Promise.all([
    loadDeskdevBusy(admin, host, window, defaultTz),
    loadGoogleBusy(admin, window, settings.hours.tz),
  ]);
  return { settings, google: google.state, days: generateSlots({ now, settings, busy: [...deskdev, ...google.busy] }) };
}

async function slots(admin: SupabaseClient): Promise<Response> {
  const settings = await loadSettings(admin);
  if (!settings.enabled) return json({ ok: false, reason: "disabled" });
  const r = await computeSlots(admin, settings, Date.now());
  return json({
    ok: true,
    tz: r.settings.hours.tz,
    minutes: r.settings.minutes,
    title: r.settings.title,
    days: r.days,
    google: r.google,
  });
}

async function book(admin: SupabaseClient, body: unknown): Promise<Response> {
  const input = parseBookInput(body);
  if (!input) return json({ ok: false, reason: "invalid" });

  const settings = await loadSettings(admin);
  if (!settings.enabled) return json({ ok: false, reason: "disabled" });
  // Fresh: the page may have shown these slots minutes ago.
  const r = await computeSlots(admin, settings, Date.now());
  if (!slotOffered(r.days, input.start)) return json({ ok: false, reason: "slot_taken" });

  const { data, error } = await admin.rpc("booking_record", { p_payload: bookingPayload(input, r.settings.minutes) });
  if (error) throw new Unavailable(`booking_record failed: ${error.code} ${error.message}`);
  const recorded = (data ?? {}) as { ok?: boolean; reason?: unknown; event_id?: string; starts_at?: string; ends_at?: string };
  if (recorded.ok !== true || !recorded.event_id) return json({ ok: false, reason: bookReason(recorded.reason) });

  const start = new Date(input.start).toISOString();
  const end = new Date(input.start + r.settings.minutes * 60_000).toISOString();

  // Push it now, so the Meet link exists before the page answers. 040's kick
  // is on its way too; claims never overlap, so whichever run gets the row
  // pushes it once. A short budget: what is left goes on the next kick.
  let meetUrl: string | null = null;
  let synced = false;
  if (r.google !== "not_connected") {
    try {
      await drain(drainDeps(admin), { budgetMs: BOOK_PUSH_BUDGET_MS, batch: 2, timeoutMs: 3_000 });
    } catch (err) {
      console.error("google-calendar: inline push failed (the kick retries)", err instanceof Error ? err.message : err);
    }
    for (let i = 0; i < 4; i++) {
      const { data: ev } = await admin
        .from("events").select("meeting_link, google_event_id, sync_google").eq("id", recorded.event_id).maybeSingle();
      const row = ev as { meeting_link: string | null; google_event_id: string | null; sync_google: boolean } | null;
      synced = Boolean(row?.sync_google);
      if (row?.google_event_id) {
        meetUrl = isMeetUrl(row.meeting_link) ? row.meeting_link : null;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // invited: the event goes to Google with the customer as a guest
  // (sendUpdates 'all'), so Google emails the invitation — now, or on the
  // kick's retry if the inline push ran out of time.
  return json({ ok: true, start, end, title: r.settings.title, meetUrl, invited: synced });
}

async function handleBooking(req: Request): Promise<Response> {
  const secret = env("BOOKING_API_SECRET");
  if (!secret || secret.length < 32) {
    console.error("google-calendar: BOOKING_API_SECRET is missing or shorter than 32 characters");
    return json({ ok: false, reason: "unavailable" }, 503);
  }
  if (!sameSecret(req.headers.get("x-booking-secret")?.trim() ?? "", secret)) {
    return json({ error: "unauthorized" }, 401);
  }
  let body: { action?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const action = body?.action;
  if (action !== "slots" && action !== "book") return json({ error: "unknown action" }, 400);

  const admin = serviceClient();
  if (!admin) {
    console.error("google-calendar: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
    return json({ ok: false, reason: "unavailable" }, 503);
  }
  try {
    return action === "slots" ? await slots(admin) : await book(admin, body);
  } catch (err) {
    // Google, the database or a bug: logged here, never echoed. The page
    // shows "try again" rather than risk a double booking.
    console.error("google-calendar:", action, err instanceof Error ? `${err.name}: ${err.message}` : err);
    return json({ ok: false, reason: "unavailable" }, 503);
  }
}

// ---------------------------------------------------------------- feed (C1b)

const FEED_PATH = /\/feed\/([0-9a-f]{64})(?:\.ics)?\/?$/;

async function handleFeed(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const token = u.pathname.match(FEED_PATH)?.[1] ?? u.searchParams.get("token") ?? "";
  const notFound = () => text("Not found", 404, { "Cache-Control": "no-store" });
  if (!/^[0-9a-f]{64}$/.test(token)) return notFound();

  const url = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return text("Not configured", 503);
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await anon.rpc("calendar_feed", { p_token: token });
  if (error) {
    console.error("google-calendar feed:", error.code, error.message);
    return text("Feed unavailable", 503, { "Retry-After": "300" });
  }
  if (!data) return notFound(); // unknown, rotated, or the owner lost calendar access

  return new Response(req.method === "HEAD" ? null : buildIcs(data as FeedData), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      // The URL is a credential: no shared caches, no referrer leaks.
      "Cache-Control": "private, max-age=300",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------- entry

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "POST") {
      // Server-to-server only: browsers send an Origin with every POST.
      if (req.headers.get("Origin")) return json({ error: "forbidden" }, 403);
      return req.headers.has("x-booking-secret") ? await handleBooking(req) : await handleDrain(req);
    }
    if (req.method === "GET" || req.method === "HEAD") return await handleFeed(req);
    return text("Method not allowed", 405, { Allow: "GET, HEAD, POST" });
  } catch (err) {
    console.error("google-calendar:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    return text("Unexpected error", 500);
  }
});
