// DeskDev's web app manifest, per host: at the root of its own subdomain,
// at /workspace everywhere else (local dev, previews). See pwa/manifest.ts.
import { buildManifest } from '@/deskdev/pwa/manifest'
import { isWorkspaceHost } from '@/lib/hosts'

export function GET(request: Request) {
  const base = isWorkspaceHost(request.headers.get('host')) ? '' : '/workspace'
  const manifest = buildManifest(base, new URL(request.url).origin)
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      // Revalidated on every check, so an icon or name change reaches
      // installed apps on their next update pass.
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
