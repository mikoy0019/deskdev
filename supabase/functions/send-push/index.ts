// DeskDev Studio — send-push Edge Function
//
// Background notifications for the installed DeskDev app (and browsers that
// allow Web Push in a tab), and for the phone app on Android and iOS through
// Expo's push service (migration 050). supabase/PUSH.md is the runbook.
//
//   POST {type:'notification', record:{id}}   from the notifications INSERT trigger (migration 029)
//   POST {type:'message',      record:{id}}   from the chat messages INSERT trigger
//        Authorization: Bearer <PUSH_WEBHOOK_SECRET>
//   POST {type:'test'}                        from Settings → Notifications → "Send test push"
//        Authorization: Bearer <the signed-in user's JWT>; pushes only to that user's devices
//
// Web Push needs the VAPID keys; the phone app needs nothing here (an
// optional EXPO_ACCESS_TOKEN when Expo's enhanced push security is on). With
// the VAPID keys unset, browsers are skipped and phones still get theirs.
//
// Deploy with --no-verify-jwt: the triggers carry the shared secret, not a
// JWT, so the gateway check is off and this function authenticates every call
// itself (secret in constant time, or supabase.auth.getUser for the test).
//
// The trigger body is only a pointer. Rows are re-read here with the service
// role, so a leaked secret can at worst re-send pushes for rows that exist —
// it cannot put words in a push.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildPayload,
  chatContent,
  classifyExpoTicket,
  classifyStatus,
  constantTimeEqual,
  deliveryFor,
  type DeviceRow,
  EXPO_BATCH,
  expoMessage,
  type ExpoMessage,
  type ExpoTicket,
  isValidVapidSubject,
  messageRecipients,
  notificationContent,
  type ConversationRow,
  type MessageRow,
  type NotificationContext,
  type NotificationRow,
  type ProfileRow,
  type PushContent,
  type PushKind,
  parseTriggerBody,
  selectDevices,
  selectSubscriptions,
  shouldPushNotification,
  type SubscriptionRow,
  testContent,
  topicFor,
} from "./logic.ts";
import { importVapid, sendWebPush, type Vapid } from "./webpush.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Pushes in flight at once. Each is one HTTPS POST to a push service. */
const CONCURRENCY = 8;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

let vapidPromise: Promise<Vapid> | null = null;

/** Imported once per warm isolate; a bad key pair surfaces as a clear 500. */
function vapid(): Promise<Vapid> {
  if (!vapidPromise) {
    const pub = Deno.env.get("VAPID_PUBLIC_KEY")?.trim() ?? "";
    const priv = Deno.env.get("VAPID_PRIVATE_KEY")?.trim() ?? "";
    const subject = Deno.env.get("VAPID_SUBJECT")?.trim() ?? "";
    vapidPromise = importVapid(pub, priv, subject);
    vapidPromise.catch(() => {
      vapidPromise = null;
    });
  }
  return vapidPromise;
}

/** What the function cannot run without at all. */
function missingConfig(): string[] {
  return ["PUSH_WEBHOOK_SECRET"].filter((k) => !Deno.env.get(k)?.trim());
}

/** Why browsers can't be pushed to, or null when the VAPID keys are in place. */
function webPushProblem(): string | null {
  const missing = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]
    .filter((k) => !Deno.env.get(k)?.trim());
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (subject?.trim() && !isValidVapidSubject(subject)) {
    missing.push("VAPID_SUBJECT (must be mailto:<real address> or an https URL; Apple rejects localhost)");
  }
  return missing.length ? `not configured: ${missing.join(", ")}` : null;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Hashing first makes the comparison length-independent as well. */
async function secretMatches(given: string, expected: string): Promise<boolean> {
  if (!given || !expected) return false;
  return constantTimeEqual(await sha256(given), await sha256(expected));
}

// ---------------------------------------------------------------- delivery

interface Summary {
  type: string;
  recipients: number;
  /** Browsers / installed web apps (push_subscriptions). */
  subscriptions: number;
  /** Phones running the DeskDev app (push_devices). */
  devices: number;
  sent: number;
  gone: number;
  failed: number;
  skipped?: string;
  /** Set when browsers were left out because the VAPID keys are not in place. */
  webPush?: string;
  errors?: { status: number; reason?: string }[];
}

function emptySummary(type: string, skipped?: string): Summary {
  return {
    type, recipients: 0, subscriptions: 0, devices: 0, sent: 0, gone: 0, failed: 0,
    ...(skipped ? { skipped } : {}),
  };
}

function addError(summary: Summary, status: number, reason?: string): void {
  summary.errors ??= [];
  if (summary.errors.length < 5) summary.errors.push({ status, reason });
}

async function loadSubscriptions(admin: SupabaseClient, userIds: string[]): Promise<SubscriptionRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, app_base, categories, failure_count")
    .in("user_id", userIds);
  if (error) throw new Error(`push_subscriptions: ${error.message}`);
  return (data ?? []) as SubscriptionRow[];
}

/** Before migration 050 there is no push_devices table; that only means no phones. */
async function loadDevices(admin: SupabaseClient, userIds: string[]): Promise<DeviceRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await admin
    .from("push_devices")
    .select("id, user_id, token, platform, categories, failure_count")
    .in("user_id", userIds);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(`push_devices: ${error.message}`);
  }
  return (data ?? []) as DeviceRow[];
}

/** Everyone's browsers and phones that want this kind of push. */
async function targetsFor(admin: SupabaseClient, userIds: string[], kind: PushKind) {
  const [subs, devices] = await Promise.all([loadSubscriptions(admin, userIds), loadDevices(admin, userIds)]);
  return {
    subs: selectSubscriptions(subs, userIds, kind),
    devices: selectDevices(devices, userIds, kind),
  };
}

/** Unread notifications + unread chat, the same number the app puts on its icon. */
async function badgeFor(admin: SupabaseClient, userId: string): Promise<number | null> {
  const { data, error } = await admin.rpc("push_badge_count", { p_user: userId });
  if (error || typeof data !== "number") return null;
  return data;
}

async function badgesFor(admin: SupabaseClient, userIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  await Promise.all(userIds.map(async (id) => out.set(id, await badgeFor(admin, id))));
  return out;
}

/**
 * Send `contentFor(sub)` to every browser subscription, then write back what
 * happened: success stamps last_success_at and clears the failure count,
 * 404/410 deletes the row, anything else bumps failure_count (kept for
 * diagnosis — a 403 is usually our VAPID config, not the device).
 */
async function deliverWeb(
  admin: SupabaseClient,
  summary: Summary,
  subs: SubscriptionRow[],
  kind: PushKind,
  contentFor: (userId: string) => PushContent,
  badges: Map<string, number | null>,
): Promise<void> {
  summary.subscriptions = subs.length;
  if (subs.length === 0) return;
  const problem = webPushProblem();
  if (problem) {
    summary.webPush = problem;
    console.warn(`send-push: ${subs.length} browser subscription(s) skipped, VAPID ${problem}`);
    return;
  }

  const keys = await vapid();
  const { ttl, urgency } = deliveryFor(kind);
  const sentIds: string[] = [];
  const goneIds: string[] = [];
  const failures: { sub: SubscriptionRow; status: number; reason?: string }[] = [];

  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    await Promise.all(subs.slice(i, i + CONCURRENCY).map(async (sub) => {
      const content = contentFor(sub.user_id);
      const payload = buildPayload(content, sub.app_base, badges.get(sub.user_id));
      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        JSON.stringify(payload),
        keys,
        { ttl, urgency, topic: topicFor(content.tag) },
      );
      const outcome = classifyStatus(result.status);
      if (outcome === "sent") sentIds.push(sub.id);
      else if (outcome === "gone") goneIds.push(sub.id);
      else failures.push({ sub, status: result.status, reason: result.reason });
    }));
  }

  const now = new Date().toISOString();
  if (sentIds.length) {
    await admin.from("push_subscriptions").update({ last_success_at: now, failure_count: 0 }).in("id", sentIds);
  }
  if (goneIds.length) {
    await admin.from("push_subscriptions").delete().in("id", goneIds);
  }
  for (const f of failures) {
    await admin.from("push_subscriptions")
      .update({ failure_count: (f.sub.failure_count ?? 0) + 1 })
      .eq("id", f.sub.id);
    console.warn(`send-push: ${new URL(f.sub.endpoint).host} answered ${f.status} ${f.reason ?? ""}`.trim());
    addError(summary, f.status, f.reason);
  }

  summary.sent += sentIds.length;
  summary.gone += goneIds.length;
  summary.failed += failures.length;
}

/**
 * POST one batch to Expo. A request-level error (a bad access token, tokens
 * from two Expo projects in one batch) fails every message in it, so a batch
 * of several is retried one message at a time to keep the rest going.
 */
async function sendExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const token = Deno.env.get("EXPO_ACCESS_TOKEN")?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  let status = 0;
  let reason = "";
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    const body = await res.json().catch(() => null) as { data?: unknown; errors?: { code?: string; message?: string }[] } | null;
    if (res.ok && Array.isArray(body?.data) && body.data.length === messages.length) return body.data as ExpoTicket[];
    reason = body?.errors?.[0]?.code ?? body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
  } catch (err) {
    reason = err instanceof Error ? err.message : "request failed";
  }

  if (messages.length > 1 && status >= 400 && status < 500) {
    const one: ExpoTicket[] = [];
    for (const m of messages) one.push(...await sendExpo([m]));
    return one;
  }
  return messages.map(() => ({ status: "error", message: reason, details: { error: reason } }));
}

/**
 * The same push to the phone app, through Expo (which hands it to FCM or
 * APNs). Write-back mirrors deliverWeb: DeviceNotRegistered deletes the row.
 */
async function deliverExpo(
  admin: SupabaseClient,
  summary: Summary,
  devices: DeviceRow[],
  contentFor: (userId: string) => PushContent,
  badges: Map<string, number | null>,
): Promise<void> {
  summary.devices = devices.length;
  if (devices.length === 0) return;

  const sentIds: string[] = [];
  const goneIds: string[] = [];
  const failures: { device: DeviceRow; reason?: string }[] = [];

  for (let i = 0; i < devices.length; i += EXPO_BATCH) {
    const batch = devices.slice(i, i + EXPO_BATCH);
    const tickets = await sendExpo(batch.map((d) => expoMessage(contentFor(d.user_id), d.token, badges.get(d.user_id))));
    batch.forEach((device, j) => {
      const { outcome, reason } = classifyExpoTicket(tickets[j]);
      if (outcome === "sent") sentIds.push(device.id);
      else if (outcome === "gone") goneIds.push(device.id);
      else failures.push({ device, reason });
    });
  }

  const now = new Date().toISOString();
  if (sentIds.length) {
    await admin.from("push_devices").update({ last_success_at: now, failure_count: 0 }).in("id", sentIds);
  }
  if (goneIds.length) {
    await admin.from("push_devices").delete().in("id", goneIds);
  }
  for (const f of failures) {
    await admin.from("push_devices")
      .update({ failure_count: (f.device.failure_count ?? 0) + 1 })
      .eq("id", f.device.id);
    console.warn(`send-push: Expo refused a push to an ${f.device.platform} device: ${f.reason ?? ""}`.trim());
    addError(summary, 0, `expo: ${f.reason ?? "unknown"}`);
  }

  summary.sent += sentIds.length;
  summary.gone += goneIds.length;
  summary.failed += failures.length;
}

async function deliver(
  admin: SupabaseClient,
  summary: Summary,
  targets: { subs: SubscriptionRow[]; devices: DeviceRow[] },
  kind: PushKind,
  contentFor: (userId: string) => PushContent,
  badges: Map<string, number | null>,
): Promise<Summary> {
  await deliverWeb(admin, summary, targets.subs, kind, contentFor, badges);
  await deliverExpo(admin, summary, targets.devices, contentFor, badges);
  return summary;
}

function hasTargets(t: { subs: unknown[]; devices: unknown[] }): boolean {
  return t.subs.length > 0 || t.devices.length > 0;
}

// ---------------------------------------------------------------- the three kinds

async function pushNotification(admin: SupabaseClient, id: string): Promise<Summary> {
  const { data: n } = await admin
    .from("notifications")
    .select("id, user_id, actor_id, type, title, body, entity, entity_id, read, created_at")
    .eq("id", id)
    .maybeSingle<NotificationRow>();
  if (!n) return emptySummary("notification", "row not found");
  if (!shouldPushNotification(n)) return emptySummary("notification", "not push-worthy");

  const kind = notificationContent(n).kind;
  const targets = await targetsFor(admin, [n.user_id], kind);
  const summary = emptySummary("notification");
  summary.recipients = 1;
  if (!hasTargets(targets)) return { ...summary, skipped: "no subscriptions want it" };

  // Two entity kinds link through another row; look it up like the app does.
  const ctx: NotificationContext = {};
  if (n.entity_id && (n.entity === "crm_row" || n.entity === "crm_column")) {
    const { data } = await admin
      .from(n.entity === "crm_row" ? "crm_rows" : "crm_columns")
      .select("table_id").eq("id", n.entity_id).maybeSingle<{ table_id: string }>();
    ctx.crmTableId = data?.table_id ?? null;
  } else if (n.entity_id && n.entity === "event") {
    const { data } = await admin.from("events").select("kind").eq("id", n.entity_id).maybeSingle<{ kind: string }>();
    ctx.eventKind = data?.kind ?? null;
  }

  const content = notificationContent(n, ctx);
  return deliver(admin, summary, targets, kind, () => content, await badgesFor(admin, [n.user_id]));
}

async function pushMessage(admin: SupabaseClient, id: string): Promise<Summary> {
  const { data: msg } = await admin
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at")
    .eq("id", id)
    .maybeSingle<MessageRow>();
  if (!msg) return emptySummary("message", "row not found");

  const { data: conv } = await admin
    .from("conversations")
    .select("id, title, is_group, participant_ids")
    .eq("id", msg.conversation_id)
    .maybeSingle<ConversationRow>();
  if (!conv) return emptySummary("message", "conversation not found");

  const recipients = messageRecipients(conv, msg.sender_id);
  const summary = emptySummary("message");
  summary.recipients = recipients.length;
  const targets = await targetsFor(admin, recipients, "messages");
  if (!hasTargets(targets)) return { ...summary, skipped: "no subscriptions want it" };

  const { data: profiles } = await admin
    .from("profiles").select("id, full_name").in("id", conv.participant_ids);
  const people = (profiles ?? []) as ProfileRow[];

  // The thread name depends on who is reading ("Ana, Ben" vs "Ana, Cy").
  const perRecipient = new Map<string, PushContent>();
  const readers = new Set([...targets.subs.map((s) => s.user_id), ...targets.devices.map((d) => d.user_id)]);
  for (const r of readers) perRecipient.set(r, chatContent(msg, conv, people, r));

  return deliver(
    admin,
    summary,
    targets,
    "messages",
    (userId) => perRecipient.get(userId)!,
    await badgesFor(admin, [...perRecipient.keys()]),
  );
}

async function pushTest(admin: SupabaseClient, userId: string): Promise<Summary> {
  const targets = await targetsFor(admin, [userId], "test");
  const summary = emptySummary("test");
  summary.recipients = 1;
  if (!hasTargets(targets)) return { ...summary, skipped: "no subscriptions for this user" };
  const content = testContent();
  return deliver(admin, summary, targets, "test", () => content, await badgesFor(admin, [userId]));
}

// ---------------------------------------------------------------- entry

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Names of unset secrets go to the function log only: this runs before any
  // authentication (the function is deployed with --no-verify-jwt), so the
  // caller gets a fixed sentence.
  const missing = missingConfig();
  if (missing.length) {
    console.error(`send-push is not configured: ${missing.join(", ")}`);
    return json({ error: "Push is not configured." }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey;
  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET")!.trim();

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Missing Authorization header" }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Database triggers: the shared secret.
    if (await secretMatches(token, secret)) {
      const call = parseTriggerBody(body);
      if (!call) return json({ error: "Expected {type:'notification'|'message', record:{id}}" }, 400);
      const summary = call.type === "notification"
        ? await pushNotification(admin, call.id)
        : await pushMessage(admin, call.id);
      return json(summary);
    }

    // 2. A signed-in user: only the test push, only to their own devices.
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error: authError } = await anon.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid token" }, 401);
    if ((body as { type?: unknown })?.type !== "test") return json({ error: "Only {type:'test'} is allowed" }, 403);

    return json(await pushTest(admin, user.id));
  } catch (err) {
    // Database and push-service messages can name tables, endpoints or keys:
    // logged, never returned.
    console.error("send-push:", err);
    return json({ error: "Unexpected error" }, 500);
  }
});
