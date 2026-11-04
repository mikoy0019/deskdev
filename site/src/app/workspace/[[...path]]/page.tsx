import { notFound } from 'next/navigation'
import Mount from '@/deskdev/Mount'

// Every /workspace/* URL lands here; DeskDev's own router (basename
// /workspace) picks the screen. Files in public/workspace/ are served as
// static assets before this route runs, so a path that looks like a file and
// got this far doesn't exist — keep it a 404 rather than answering with the app.
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ path?: string[] }>
}) {
  const { path = [] } = await params
  if (/\.[a-z0-9]+$/i.test(path.at(-1) ?? '')) notFound()
  return <Mount />
}
