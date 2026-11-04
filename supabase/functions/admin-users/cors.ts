// CORS for DeskDev's browser-called Edge Functions.
//
// Allowed origins come from the APP_ORIGINS secret (comma-separated origins, no
// paths — the same secret the `google` function reads). When it is unset, the
// production hostnames below are used. Loopback origins (http://localhost:<port>,
// 127.0.0.1, [::1]) are always allowed so `npm run dev` against this project
// keeps working.
//
// This is hardening, not the auth boundary: every action still requires the
// caller's `Authorization: Bearer <access token>`, which a foreign page cannot
// attach on a victim's behalf.
//
// Kept byte-identical in admin-users/ and vault-reset/ (each function deploys
// on its own, so neither can import from the other).

export const DEFAULT_APP_ORIGINS = [
  "https://nixgensolutions.com",
  "https://www.nixgensolutions.com",
  "https://workspace.nixgensolutions.com",
];

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};

function normalize(origin: string): string | null {
  try {
    const u = new URL(origin.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The configured allow-list (APP_ORIGINS, or the production defaults when unset/empty). */
export function allowedOrigins(raw: string | undefined = Deno.env.get("APP_ORIGINS")): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => normalize(s))
    .filter((s): s is string => !!s);
  return list.length > 0 ? list : DEFAULT_APP_ORIGINS;
}

function isLoopback(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string, allowed: string[] = allowedOrigins()): boolean {
  // A browser's Origin header is exactly scheme://host[:port]; anything else
  // (a path, "null", odd casing) is not something we echo back.
  const o = normalize(origin);
  if (!o || o !== origin) return false;
  return isLoopback(o) || allowed.includes(o);
}

/**
 * CORS headers for this request. A request with no Origin header (curl,
 * server-to-server) needs none; a browser request gets Allow-Origin only when
 * its origin is on the list.
 */
export function corsHeaders(req: Request, allowed: string[] = allowedOrigins()): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (origin && isAllowedOrigin(origin, allowed)) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  return { ...BASE_HEADERS };
}

/** True when a browser sent this request from an origin that is not allowed. */
export function isForeignOrigin(req: Request, allowed: string[] = allowedOrigins()): boolean {
  const origin = req.headers.get("Origin");
  return origin !== null && !isAllowedOrigin(origin, allowed);
}
