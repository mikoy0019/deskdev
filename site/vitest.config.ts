import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The `@/` of tsconfig.json's "paths". Pages and components import through
  // it, so without this a test cannot load one (src/app/errorPages.test.ts
  // renders the site's error pages). Only `@/…` matches: a scoped package
  // such as @phosphor-icons/react is left alone.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
