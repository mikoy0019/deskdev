import { defineConfig, devices } from '@playwright/test'

// PROVE stage config — see MainFrame/System/skill/devops_and_testing/e2e_video_proof.
//
// Two deliberate deviations from that skill's template, both documented in the
// E2E report:
//   1. baseURL is 4173 (the built Worker), not 3000 (the dev server).
//   2. The webServer runs the production build in the Workers runtime
//      (`opennextjs-cloudflare preview`: workerd, with a local R2 page cache and
//      Durable Object queue), not `npm run dev`. A dev-server pass is not a
//      pass — bundling, tree-shaking and env baking all differ, and this app's
//      env baking is exactly where its real defect lives.
//
// The build runs with NEXT_PUBLIC_SUPABASE_* set to empty (webServer.env; an
// empty variable wins over .env.local), so the suite exercises DeskDev's LOCAL
// mode deterministically (demo accounts, localStorage persistence) rather than
// depending on a remote project's availability. It overwrites the regular build
// output (.open-next) — `npm run deploy` always rebuilds, so it never ships.
//
// DeskDev lives at /workspace; specs navigate to /workspace/... explicitly.

const RUN_ID = process.env.E2E_RUN_ID ?? 'local'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `./e2e-artifacts/${RUN_ID}`,
  reporter: [
    // Must live outside outputDir: Playwright clears the report folder, which
    // clashes with (and can delete) the videos in e2e-artifacts.
    ['html', { outputFolder: `./e2e-report/${RUN_ID}`, open: 'never' }],
    // Next to the HTML folder, not inside it (the HTML reporter empties its
    // own folder): what E2E_REPORT.md is written from.
    ['json', { outputFile: `./e2e-report/${RUN_ID}.json` }],
    ['list'],
  ],
  retries: 0, // a retry overwrites the video of the real failure
  fullyParallel: false,
  // Every flow is filmed and every page is rendered by the local Worker. With
  // one worker per CPU pair the pages get slow enough that a five-second
  // expectation fails on a laptop for no fault of the app, so: fewer at once,
  // and assertions that wait a little longer.
  workers: 3,
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:4173',
    video: { mode: 'on', size: { width: 1280, height: 720 } }, // always, not on-failure
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'npx opennextjs-cloudflare build && npx opennextjs-cloudflare preview --port 4173',
    // Empty Supabase pair: local mode. The case-study fixtures: portfolio.spec.ts.
    env: { NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', NEXT_PUBLIC_CASE_STUDY_FIXTURES: '1' },
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 600_000, // includes the build
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e-artifacts/state.json',
      },
      dependencies: ['setup'],
    },
  ],
})
