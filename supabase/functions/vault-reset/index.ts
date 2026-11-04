// DeskDev Studio — vault-reset Edge Function
//
// A vault reset (archive + start over) needs the vault owner's approval:
//
//   POST { action: 'request' }        → emails a 6-digit code to the owner
//   POST { action: 'verify', code }   → checks it, then archives the vault
//
// Why server-side: the code hash, the attempt counter and the archive itself
// must be out of reach of the browser, or the gate is decoration. The client
// never sees the hash and cannot archive on its own (migration 022 revokes
// archive_vault from authenticated).
//
// The email goes out through the same n8n instance as the rest of DeskDev's
// mail, via N8N_VAULT_RESET_WEBHOOK.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, isForeignOrigin } from "./cors.ts";

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
/** One code per minute: stops inbox flooding and back-to-back cancelling of a code in flight. */
const REQUEST_COOLDOWN_SECONDS = 60;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Six digits from the CSPRNG, evenly distributed (no modulo bias worth caring about at 1e6). */
function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** Never echo the owner's full address back to whoever asked for the code. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "the owner's address";
  const head = user.slice(0, 2);
  return `${head}${"•".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", ...headers },
    });
  /** Log the real error server-side; the browser gets a fixed sentence. */
  const fail = (message: string, err: unknown, status = 500): Response => {
    console.error("[vault-reset]", message, err);
    return json({ error: message }, status);
  };

  if (isForeignOrigin(req)) return json({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const webhook = Deno.env.get("N8N_VAULT_RESET_WEBHOOK");
  const webhookSecret = Deno.env.get("N8N_WEBHOOK_SECRET") ?? "";

  try {
    // 1. Caller must be a signed-in admin.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing Authorization header" }, 401);

    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: { user: caller }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !caller) return json({ error: "Invalid token" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile } = await admin
      .from("profiles").select("role, full_name, email").eq("id", caller.id).single();
    if (profile?.role !== "admin") return json({ error: "Admin access required" }, 403);

    let body: { action?: string; code?: string };
    try {
      body = await req.json() as { action?: string; code?: string };
    } catch {
      return json({ error: "Request body must be JSON" }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "Unknown action" }, 400);

    if (body.action === "request") {
      const { data: settings } = await admin
        .from("vault_settings").select("owner_email").limit(1).maybeSingle();
      const ownerEmail = settings?.owner_email?.trim();
      if (!ownerEmail) {
        return json({
          error: "No vault owner email is set. An admin must set it on the Vault screen before a reset can be approved.",
        }, 400);
      }
      if (!webhook) {
        return json({ error: "Email delivery is not configured (N8N_VAULT_RESET_WEBHOOK missing)." }, 500);
      }

      // Cooldown: a code that went out under a minute ago stays the live one.
      // Without this, any admin could flood the owner's inbox, and could keep
      // cancelling the code another admin is waiting on.
      const { data: latest, error: latestError } = await admin
        .from("vault_reset_codes").select("created_at").is("used_at", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latestError) return fail("Could not create the approval code.", latestError);
      if (latest) {
        const ageSeconds = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
        if (ageSeconds < REQUEST_COOLDOWN_SECONDS) {
          const retryAfter = Math.max(1, Math.ceil(REQUEST_COOLDOWN_SECONDS - ageSeconds));
          return json({
            error: `A code was sent less than a minute ago. Check the owner's inbox, or try again in ${retryAfter}s.`,
            retry_after: retryAfter,
          }, 429, { "Retry-After": String(retryAfter) });
        }
      }

      const code = newCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

      // One outstanding code at a time: asking again invalidates the last one.
      await admin.from("vault_reset_codes").delete().is("used_at", null);

      const { error: insertError } = await admin.from("vault_reset_codes").insert({
        code_hash: await sha256(code),
        requested_by: caller.id,
        sent_to: ownerEmail,
        expires_at: expiresAt,
      });
      if (insertError) return fail("Could not create the approval code.", insertError);

      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-secret": webhookSecret },
        body: JSON.stringify({
          to: ownerEmail,
          code,
          expires_minutes: CODE_TTL_MINUTES,
          requested_by: profile?.full_name ?? caller.email ?? "An admin",
          requested_by_email: profile?.email ?? caller.email ?? "",
        }),
      });
      if (!res.ok) {
        // The code is useless if it never reached anyone — drop it rather than
        // leave a valid code hanging in the table.
        await admin.from("vault_reset_codes").delete().is("used_at", null);
        return json({ error: `Could not send the approval email (n8n returned ${res.status}).` }, 502);
      }

      return json({ ok: true, sent_to: maskEmail(ownerEmail), expires_minutes: CODE_TTL_MINUTES });
    }

    if (body.action === "verify") {
      const code = (typeof body.code === "string" ? body.code : "").trim();
      if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code" }, 400);

      const { data: row, error: rowError } = await admin
        .from("vault_reset_codes").select("id, code_hash, attempts, expires_at").is("used_at", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (rowError) return fail("Could not check the code.", rowError);

      if (!row) return json({ error: "No approval code is outstanding — request one first." }, 400);
      if (new Date(row.expires_at) <= new Date()) {
        await admin.from("vault_reset_codes").delete().eq("id", row.id).is("used_at", null);
        return json({ error: "That code has expired — request a new one." }, 400);
      }
      if (row.attempts >= MAX_ATTEMPTS) {
        await admin.from("vault_reset_codes").delete().eq("id", row.id).is("used_at", null);
        // No Retry-After: waiting does not help. This code is gone, and a new
        // one can be requested straight away.
        return json({ error: "Too many wrong attempts — request a new code." }, 429);
      }

      // Spend one attempt BEFORE looking at the guess, as a compare-and-swap on
      // the counter: the UPDATE only matches while attempts still holds the
      // value we read. Postgres re-checks that WHERE after waiting on the row
      // lock, so of N concurrent guesses that all read attempts = n exactly one
      // gets n + 1; the rest match nothing and are turned away unchecked. That
      // caps every code at MAX_ATTEMPTS comparisons however many requests race.
      const { data: claimed, error: claimError } = await admin
        .from("vault_reset_codes")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id)
        .eq("attempts", row.attempts)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("attempts");
      if (claimError) return fail("Could not check the code.", claimError);
      const attempts = (claimed as { attempts: number }[] | null)?.[0]?.attempts;
      if (attempts === undefined) {
        return json({ error: "Another attempt was being checked at the same time. Try again." }, 409);
      }

      if (await sha256(code) !== row.code_hash) {
        return json({ error: "Wrong code", attempts_left: Math.max(0, MAX_ATTEMPTS - attempts) }, 400);
      }

      // Correct: burn the code first, then archive. A crash between the two
      // leaves an un-archived vault and a spent code — recoverable by asking
      // again, unlike the reverse. The burn only matches an unused code, so
      // exactly one request ever goes on to archive.
      const { data: burned, error: burnError } = await admin
        .from("vault_reset_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("used_at", null)
        .select("id");
      if (burnError) return fail("Could not check the code.", burnError);
      if (!burned || burned.length === 0) {
        return json({ error: "That code has already been used." }, 409);
      }

      const { data: archivedId, error: archiveError } = await admin.rpc("archive_vault");
      if (archiveError) return fail("The code was accepted, but archiving the vault failed. Request a new code and try again.", archiveError);

      return json({ ok: true, archived_meta_id: archivedId ?? null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return fail("Unexpected error", err);
  }
});
