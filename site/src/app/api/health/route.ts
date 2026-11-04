import { NextResponse } from 'next/server';
import { withRequestLog, type RequestLog } from '../../../lib/guard';
import { bindings } from '../../../lib/platform';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimited } from '../../../lib/rateLimit';

// GET or HEAD /api/health: is the Worker answering, and which version of it.
//
//   200 { ok: true, service, version, time }
//
// `version` is the id of the deployed Worker version (the CF_VERSION_METADATA
// binding), so a deploy or a rollback can be confirmed from outside; null
// where the binding does not exist. The answer names no setting, env key or
// address: it is public and says only "up" and "which build".
//
// ?deep=1 also asks the database one question, the way the site's own pages
// read it (src/lib/showcase.ts): a PostgREST GET with the public anon key for
// one showcase_items id, 2 s at most. The answer gains
//
//   checks: { database: 'ok' | 'down' | 'unconfigured' }
//
// 'down' makes ok false and the status 503. 'unconfigured' is a build without
// Supabase values (the demo build, a preview) and is not a failure. Each deep
// call costs a database round trip, so it sits behind the per-visitor limiter
// (src/lib/rateLimit.ts): past it, 429 with Retry-After.
//
// Never cached, by the framework or downstream: a monitor must see this
// moment, not the last one.
export const dynamic = 'force-dynamic';

const ROUTE = 'health';
const SERVICE = 'nixgen-site';
const DATABASE_TIMEOUT_MS = 2_000;

type DatabaseCheck = 'ok' | 'down' | 'unconfigured';

function version(): string | null {
  try {
    const id = bindings().CF_VERSION_METADATA?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

async function checkDatabase(log: RequestLog): Promise<DatabaseCheck> {
  // Literal process.env.NEXT_PUBLIC_* so the build inlines them, as in showcase.ts.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) return 'unconfigured';

  try {
    const url = new URL('/rest/v1/showcase_items', supabaseUrl.replace(/\/+$/, ''));
    // `id` is one of the columns anon is granted (037); the RLS policy decides
    // the rows. Zero rows is still an answer.
    url.searchParams.set('select', 'id');
    url.searchParams.set('limit', '1');
    const headers: Record<string, string> = { apikey: anonKey, Accept: 'application/json' };
    // Legacy anon keys are JWTs and also go in Authorization; sb_publishable_ keys must not.
    if (anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${anonKey}`;

    const res = await fetch(url.toString(), {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {});
    if (res.ok) return 'ok';
    log.log('error', 'database_down', { status: res.status });
    return 'down';
  } catch (err) {
    // The error's name only: its message can carry the URL.
    log.log('error', 'database_down', { error: err instanceof Error ? err.name : 'unknown' });
    return 'down';
  }
}

async function health(request: Request, log: RequestLog): Promise<Response> {
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };

  if (deep && (await rateLimited(request, ROUTE, log))) {
    headers['Retry-After'] = String(RATE_LIMIT_WINDOW_SECONDS);
    return NextResponse.json({ ok: false, service: SERVICE, error: 'Too many requests.' }, { status: 429, headers });
  }

  const database = deep ? await checkDatabase(log) : null;
  const ok = database !== 'down';
  return NextResponse.json(
    {
      ok,
      service: SERVICE,
      version: version(),
      time: new Date().toISOString(),
      ...(database ? { checks: { database } } : {}),
    },
    { status: ok ? 200 : 503, headers },
  );
}

export const GET = withRequestLog(ROUTE, health);

/** The same checks and headers, without the body. */
export const HEAD = withRequestLog(ROUTE, async (request, log) => {
  const res = await health(request, log);
  return new Response(null, { status: res.status, headers: res.headers });
});
