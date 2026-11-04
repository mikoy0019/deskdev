// DeskDev's service worker, served from a route rather than public/ so it can
// carry its own headers (Cloudflare serves public files without running the
// Worker, so headers() and the proxy never reach them):
// - Service-Worker-Allowed: / lets the script control '/' on DeskDev's own
//   host, beyond the /workspace/ directory it's served from;
// - no-cache makes every update check revalidate, whatever HTTP caches sit in
//   between (the app also registers with updateViaCache 'none').
//
// The source stays one plain file, src/deskdev/pwa/sw/sw.js (unit-tested on
// its own); scripts/sw-source.mjs copies its text into swSource.ts before
// every dev start and build. Stamping the build id in changes the script's
// bytes on every deploy, which is what makes browsers install the new worker.
import { SW_SOURCE } from '@/deskdev/pwa/sw/swSource'

// next.config.ts bakes APP_BUILD_ID into every bundle at build time (a fresh
// id per dev-server start too); 'dev' covers anything else.
const BUILD_ID = (process.env.APP_BUILD_ID || 'dev').replace(/[^\w.-]/g, '')
const SCRIPT = SW_SOURCE.replaceAll('__DESKDEV_BUILD_ID__', BUILD_ID)

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
