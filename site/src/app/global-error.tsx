'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/clientErrors';
import { SITE_ORIGIN, isWorkspaceHost } from '@/lib/hosts';
import { storedTheme } from '@/lib/theme';

// Last-resort boundary: replaces the root layout when it fails, so nothing from
// it (globals.css, fonts, Navbar) can be relied on. Styles are inline and the
// palette mirrors src/styles/nx.css. It catches DeskDev's root layout too, so
// the copy stays neutral: "home" is the current host's root, and contact
// always points at the marketing site (relative when no site origin is set).
const CSS = `
:root{--bg:#06080d;--line:rgba(226,232,255,.15);--fg:#f3f5fa;--fg-2:#b4bccd;--fg-3:#7f899e;--accent:#3566e3;--accent-hover:#3e6de5;--accent-text:#8aa8f0;--ring:#8aa8f0;color-scheme:dark}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f5f6f8;--line:rgba(12,16,28,.17);--fg:#0c0f17;--fg-2:#444c5d;--fg-3:#5f6779;--accent:#1f4ed1;--accent-hover:#1b44b6;--accent-text:#1f4ed1;--ring:#1f4ed1;color-scheme:light}}
:root[data-theme="light"]{--bg:#f5f6f8;--line:rgba(12,16,28,.17);--fg:#0c0f17;--fg-2:#444c5d;--fg-3:#5f6779;--accent:#1f4ed1;--accent-hover:#1b44b6;--accent-text:#1f4ed1;--ring:#1f4ed1;color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg)}
html{-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
body{min-height:100dvh;display:flex;align-items:center;font-family:"Space Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.ge{width:100%;max-width:calc(52rem + 2*clamp(1.25rem,4vw,3.5rem));margin:0 auto;padding:clamp(4rem,10vw,8rem) clamp(1.25rem,4vw,3.5rem)}
.ge-mark{display:inline-flex;align-items:center;min-height:2.75rem;font-weight:600;letter-spacing:.14em;font-size:1.125rem;color:var(--fg);text-decoration:none}
.ge-mark span{color:var(--accent-text)}
.ge-eyebrow{margin:clamp(3rem,8vw,5rem) 0 1.5rem;font:500 .75rem/1 "Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3)}
.ge-eyebrow b{color:var(--accent-text);font-weight:500;margin-right:.75rem}
h1{margin:0;font-weight:500;font-size:clamp(2.5rem,6vw,4.75rem);line-height:.98;letter-spacing:-.04em;text-wrap:balance}
p.ge-lede{margin:1.75rem 0 0;max-width:36rem;font-family:Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:clamp(1.05rem,1.35vw,1.25rem);line-height:1.55;color:var(--fg-2);text-wrap:pretty}
.ge-actions{margin-top:2.5rem;display:flex;flex-wrap:wrap;gap:.75rem}
.ge-btn{display:inline-flex;align-items:center;justify-content:center;min-height:3rem;padding:0 1.5rem;border-radius:999px;font-family:inherit;font-size:1rem;font-weight:500;line-height:1;text-decoration:none;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--fg);touch-action:manipulation;-webkit-user-select:none;user-select:none;transition:background-color .2s ease,border-color .2s ease,scale 140ms cubic-bezier(.23,1,.32,1)}
.ge-btn:active{scale:.97}
.ge-btn-primary{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
@media (hover:hover) and (pointer:fine){.ge-btn:hover{border-color:var(--fg-3)}.ge-btn-primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}}
.ge-btn:focus-visible,.ge-mark:focus-visible{outline:2px solid var(--ring);outline-offset:3px}
.ge-ref{margin-top:2.5rem;font:400 .875rem/1.5 "Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--fg-3)}
@media (max-width:480px){.ge-btn{width:100%}}
@media (prefers-reduced-motion:reduce){.ge-btn{transition:background-color .2s ease,border-color .2s ease}.ge-btn:active{scale:none}}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The no-flash boot script lives in the layout that just failed — apply the
  // saved theme here instead (system preference covers the first frame).
  useEffect(() => {
    const saved = storedTheme();
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    console.error(error);
    // This page stands in for both root layouts, so the report says which app
    // was open: DeskDev is its own host in production and /workspace elsewhere.
    const { host, pathname } = window.location;
    const app = isWorkspaceHost(host) || /^\/workspace(\/|$)/.test(pathname) ? 'workspace' : 'site';
    reportClientError(error, { app, kind: 'boundary', digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong | NixGen Solutions</title>
        <meta name="robots" content="noindex" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <main className="ge">
          {/* Plain anchors on purpose: the root layout broke, so a full reload is the recovery. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="ge-mark" aria-label="NixGen — home">
            NIXGEN<span>.</span>
          </a>
          <p className="ge-eyebrow">
            <b>500</b>Something went wrong
          </p>
          <h1>A wire came loose.</h1>
          <p className="ge-lede">
            Something on our side stopped this page from loading. Try again&nbsp;— and if it keeps happening, let us know
            and we&apos;ll fix it.
          </p>
          <div className="ge-actions">
            <button type="button" className="ge-btn ge-btn-primary" onClick={() => reset()}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="ge-btn">
              Back to home
            </a>
            <a href={`${SITE_ORIGIN ?? ''}/contact`} className="ge-btn">
              Contact us
            </a>
          </div>
          {error.digest && <p className="ge-ref">Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
