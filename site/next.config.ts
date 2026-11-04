import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { INDEXABLE, WORKSPACE_HOSTNAME, WORKSPACE_REWRITE_SOURCE } from "./src/lib/hosts";

/** A hostname as a `has: host` value — matched as an anchored regex. */
const hostPattern = (hostname: string) => hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One id per build (a fresh one per dev-server start), baked into the bundles
 * as process.env.APP_BUILD_ID: the service worker's cache name
 * (src/app/workspace/sw.js) and the client error reports
 * (src/lib/clientErrors.ts) tell one deploy from the next with it. Next.js
 * evaluates this file in more than one process during a build; the first one
 * sets the variable and the workers it starts inherit it, so every bundle
 * gets the same id.
 */
process.env.APP_BUILD_ID ||= `${process.env.GITHUB_SHA?.slice(0, 7) ?? "local"}-${Date.now().toString(36)}`;
const BUILD_ID = process.env.APP_BUILD_ID;

/**
 * Security headers on every worker-rendered response: pages, route handlers,
 * redirects, on both hosts. NOT on files the Workers asset layer serves before
 * the worker runs (/_next/static/*, public/*) — those take headers only from
 * public/_headers, which also gives /_next/static/* its immutable-cache rule.
 *
 * Permissions-Policy only turns off what nothing here uses. Clipboard writes
 * (Vault, EOD report), desktop notifications and the SOP video embeds'
 * autoplay / encrypted-media / picture-in-picture / fullscreen stay on.
 *
 * No script-src CSP yet: the inline theme boot script, GSAP, Supabase and the
 * font loader would all need allowances first. frame-ancestors is the part
 * that matters for /workspace (Vault, user admin) — nothing may frame it.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // Browsers ignore HSTS over plain http, but keep it out of dev anyway so a
  // local https setup never pins localhost. `next build` sets NODE_ENV before
  // it reads this file, so a build bakes it in and `next dev` leaves it out.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
  // Search engines index the production domain only (src/lib/hosts.ts). On the
  // workers.dev address before the cutover, on previews and locally, every
  // worker-rendered response says so; robots.ts turns crawlers away as well.
  ...(INDEXABLE ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
];

/** No one frames us (clickjacking) — X-Frame-Options for older browsers. */
const denyFraming = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

/**
 * /templates frames our own gallery.html, so that one file allows same-origin
 * framing. It is a public/ file, so today the asset layer serves it without
 * these headers; this keeps it working if the worker ever runs first.
 */
const sameOriginFraming = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  // Pin the Turbopack root to this app so Next stops inferring the
  // monorepo root from stray lockfiles higher up the tree.
  turbopack: {
    root: __dirname,
    // The Whiteboard's Excalidraw would pull all of Mermaid into the build for
    // a dialog it doesn't use (src/deskdev/whiteboard/mermaidStub.ts).
    resolveAlias: {
      '@excalidraw/mermaid-to-excalidraw': './src/deskdev/whiteboard/mermaidStub.ts',
    },
  },

  generateBuildId: () => BUILD_ID,
  env: { APP_BUILD_ID: BUILD_ID },

  experimental: {
    // src/app/global-not-found.tsx: the designed 404 for a path no route
    // matches (two root layouts, none above them).
    globalNotFound: true,
  },

  // DeskDev on its own subdomain (src/lib/hosts.ts) — only when
  // NEXT_PUBLIC_APP_URL is an absolute URL, so dev and previews keep
  // /workspace. The site host's /workspace/* redirect is in src/proxy.ts.
  async rewrites() {
    if (!WORKSPACE_HOSTNAME) return { beforeFiles: [] };
    return {
      beforeFiles: [
        {
          // Every page on the subdomain is DeskDev. /_next/*, /workspace/*
          // and /api/* are already real paths, so they pass through (the
          // pattern and its reasons live in src/lib/hosts.ts, with tests).
          source: WORKSPACE_REWRITE_SOURCE,
          has: [{ type: "host", value: hostPattern(WORKSPACE_HOSTNAME) }],
          // `(.*)`, not a bare `:path`: OpenNext compiles the destination with
          // validation on, and a bare param only takes one segment, so `/`
          // and `/growth/leads` threw there (a 500) while `next start` was fine.
          destination: "/workspace/:path(.*)",
        },
      ],
    };
  },

  // When two rules set the same header the later one wins, so the gallery
  // rule overrides the catch-all framing rule.
  async headers() {
    return [
      { source: "/(.*)", headers: [...securityHeaders, ...denyFraming] },
      { source: "/templates/gallery.html", headers: sameOriginFraming },
    ];
  },
};

/**
 * `next dev` runs the routes in Node, not in the Worker, so two things the
 * Worker gets from Wrangler are brought in here, for the dev server only:
 * the bindings (getCloudflareContext() in src/lib/platform.ts), and the
 * secrets in site/.dev.vars, which the routes read from process.env. A value
 * already in the environment or in a .env file wins.
 */
function loadDevVars(): void {
  let text: string;
  try {
    text = readFileSync(join(__dirname, ".dev.vars"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    loadDevVars();
    void initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
