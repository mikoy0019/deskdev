import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// How the Worker keeps the pages marked `revalidate = 300` (home, /portfolio,
// the sitemap) and the showcase fetch (src/lib/showcase.ts).
//
// Today: the static-assets cache. The deploy uploads what the build rendered
// as Workers static assets (under cdn-cgi/, readable only by the Worker), and
// cache interception answers those pages before Next.js loads a route's code,
// which is most of the processor time a page costs. The cache is read-only:
// nothing re-renders at runtime, so home and /portfolio show the showcase as
// it was at build time, and a portfolio edit in DeskDev reaches them with the
// next deploy. The queue is a no-op on purpose: with nowhere to store a fresh
// render, re-rendering a page once its 5 minutes are up would only burn the
// Free plan's 10 ms per request on every visit.
//
// It needs no R2, which is not switched on for the Cloudflare account. Once
// it is (dashboard → R2) and the bucket exists, go back to refreshing every
// 5 minutes without a deploy:
//   - here: incrementalCache: withRegionalCache(r2IncrementalCache, { mode: 'long-lived' })
//     (…/overrides/incremental-cache/r2-incremental-cache and …/regional-cache),
//     queue: doQueue (…/overrides/queue/do-queue)
//   - wrangler.jsonc: the r2_buckets, durable_objects, migrations and services
//     blocks its comments describe, for production and for "preview"
//   - npx wrangler r2 bucket create nixgen-site-cache (and nixgen-site-preview-cache)
// src/lib/cloudflareConfig.test.ts checks the two files agree.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  queue: { name: 'no-revalidation', send: async () => {} },
  enableCacheInterception: true,
});
