import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// What a deploy would create: wrangler.jsonc's top level is the production
// Worker, its "preview" environment the pull-request previews. An environment
// inherits none of the bindings, so both are checked.
// .github/workflows/site-deploy.yml reads the file the same way before a
// preview goes out.

type Worker = {
  name: string;
  account_id?: string;
  main?: string;
  routes?: unknown[];
  workers_dev?: boolean;
  preview_urls?: boolean;
  observability?: { enabled?: boolean };
  assets?: { directory?: string; binding?: string };
  ratelimits?: Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }>;
  version_metadata?: { binding?: string };
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  durable_objects?: { bindings?: Array<{ name: string; class_name: string }> };
  services?: Array<{ binding: string; service: string }>;
  secrets?: { required?: string[] };
  env?: Record<string, Partial<Worker>>;
};

/** wrangler.jsonc parsed the way TypeScript reads tsconfig.json: comments and trailing commas allowed. */
function readConfig(): Worker {
  const file = resolve(__dirname, '../../wrangler.jsonc');
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  return config as Worker;
}

const config = readConfig();
const production = config;
const preview = { ...config.env?.preview } as Worker;

/** Which page cache open-next.config.ts picks: R2 (needs bindings) or static assets (needs none). */
const usesR2Cache = readFileSync(resolve(__dirname, '../../open-next.config.ts'), 'utf8').includes(
  "from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'",
);

const SECRETS = ['FORM_TOKEN_SECRET', 'LEAD_INTAKE_SECRET', 'LEAD_IP_SALT'];

describe('wrangler.jsonc', () => {
  it('deploys the production Worker to the pinned account, with the three intake secrets required', () => {
    expect(production.name).toBe('nixgen-site');
    expect(production.account_id).toBe('5c6cabb0e7c2e306c3dd792599736a46');
    expect(production.main).toBe('.open-next/worker.js');
    expect([...(production.secrets?.required ?? [])].sort()).toEqual(SECRETS);
  });

  it('keeps the production Worker on workers.dev until the domains are switched on', () => {
    // One or the other, never both and never neither: with the domains listed
    // the workers.dev address goes away, without them it is the only address.
    const routes = production.routes ?? [];
    if (routes.length === 0) {
      expect(production.workers_dev).toBe(true);
    } else {
      expect(routes).toEqual([
        { pattern: 'nixgensolutions.com', custom_domain: true },
        { pattern: 'workspace.nixgensolutions.com', custom_domain: true },
      ]);
      expect(production.workers_dev).toBe(false);
    }
    // One address, not one more per uploaded version.
    expect(production.preview_urls).toBe(false);
  });

  it('sends a preview to its own Worker, with no domain and no secret', () => {
    expect(preview.name).toBe('nixgen-site-preview');
    expect(preview.name).not.toBe(production.name);
    expect(preview.routes ?? []).toEqual([]);
    expect(preview.workers_dev).toBe(true);
    expect(preview.preview_urls).toBe(false);
    // A preview must never hold production's LEAD_INTAKE_SECRET.
    expect(preview.secrets?.required ?? []).toEqual([]);
  });

  it('declares the limiter, the version and the logs for both Workers', () => {
    expect(production.assets).toMatchObject({ directory: '.open-next/assets', binding: 'ASSETS' });
    for (const [label, worker] of [['production', production], ['preview', preview]] as const) {
      expect(worker.ratelimits, label).toEqual([
        { name: 'API_LIMITER', namespace_id: '1001', simple: { limit: 20, period: 60 } },
      ]);
      expect(worker.version_metadata?.binding, label).toBe('CF_VERSION_METADATA');
      expect(worker.observability?.enabled, label).toBe(true);
    }
  });

  it('binds exactly what the page cache in open-next.config.ts needs', () => {
    for (const [label, worker] of [['production', production], ['preview', preview]] as const) {
      if (usesR2Cache) {
        // Each Worker its own page cache, and a queue that calls that same Worker back.
        expect(worker.r2_buckets?.map((b) => b.binding), label).toEqual(['NEXT_INC_CACHE_R2_BUCKET']);
        expect(worker.durable_objects?.bindings, label).toEqual([
          { name: 'NEXT_CACHE_DO_QUEUE', class_name: 'DOQueueHandler' },
        ]);
        // The queue re-renders through this binding: pointing it at the other
        // Worker would fill one Worker's cache with the other's pages.
        expect(worker.services, label).toEqual([{ binding: 'WORKER_SELF_REFERENCE', service: worker.name }]);
      } else {
        // The static-assets cache rides on ASSETS. A leftover R2 binding would
        // stop the deploy on an account without R2.
        expect(worker.r2_buckets ?? [], label).toEqual([]);
        expect(worker.durable_objects?.bindings ?? [], label).toEqual([]);
        expect(worker.services ?? [], label).toEqual([]);
      }
    }
    if (usesR2Cache) expect(preview.r2_buckets?.[0].bucket_name).not.toBe(production.r2_buckets?.[0].bucket_name);
  });
});
