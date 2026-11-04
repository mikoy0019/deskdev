'use client'

import dynamic from 'next/dynamic'

// DeskDev reads localStorage, window and the Supabase session from its first
// render, so it never renders on the server.
const Root = dynamic(() => import('./Root'), { ssr: false })

export default function Mount() {
  return (
    <div id="root">
      <Root />
    </div>
  )
}
