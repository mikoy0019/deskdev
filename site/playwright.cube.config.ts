import { defineConfig, devices } from '@playwright/test'

/** Separate port and artifacts keep this focused proof away from other preview sessions. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'cube.spec.ts',
  outputDir: './e2e-artifacts/cube',
  reporter: [['list'], ['html', { outputFolder: './e2e-report/cube', open: 'never' }]],
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    ...devices['Desktop Chrome'], baseURL: 'http://localhost:4185',
    video: 'on', trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx opennextjs-cloudflare build && npx opennextjs-cloudflare preview --port 4185',
    env: { NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' },
    url: 'http://localhost:4185', reuseExistingServer: false, timeout: 600000,
  },
})
