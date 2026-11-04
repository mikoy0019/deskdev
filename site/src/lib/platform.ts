// The one module that reads the Worker's bindings.
//
// Object bindings (the rate limiter, version metadata) are not on process.env;
// the OpenNext adapter hands them out per request through
// getCloudflareContext(). In the Worker that is always there; under `next dev`
// next.config.ts sets it up from wrangler.jsonc; anywhere else (a build
// prerendering a page, a script) there is none, and this returns no bindings
// instead of throwing. A test of anything that imports this file replaces it
// with `vi.mock('<path>/platform', () => ({ bindings: () => ({ … }) }))`,
// which is also where the test says which bindings exist. Keeping the lookup
// in a file with nothing else in it means that mock never hides real logic.
import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * The bindings wrangler.jsonc declares, each optional: a caller must work
 * without one (a config that lost the line, a runtime that is not a Worker)
 * rather than trust a generated Env type.
 */
export interface Bindings {
  API_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
}

/** Looked up when called (per request), never at module load. */
export function bindings(): Bindings {
  try {
    return getCloudflareContext().env as unknown as Bindings;
  } catch {
    return {};
  }
}
