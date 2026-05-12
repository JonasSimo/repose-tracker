// Playwright config for RepNet E2E.
//
// Strategy: MSAL auth is captured ONCE by e2e/auth.setup.mjs (user signs in
// manually in headed mode) and saved to e2e/.auth/user.json — every subsequent
// test loads that state and is already signed in.
//
// Base URL is the live Azure Static Web App by default, overridable via
// REPNET_URL env var so the same suite can run against a local serve or a
// staging slot later.

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.REPNET_URL || 'https://brave-island-06ef03810.1.azurestaticapps.net';

export default defineConfig({
  testDir: './e2e',
  // Each spec gets its own browser context so storage state is shared but
  // cookies/localStorage mutations don't leak between specs.
  fullyParallel: false, // RepNet writes to a single SharePoint tenant — serial avoids races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // single worker for the same reason as fullyParallel:false
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // RepNet's MSAL flow needs a real browser; headless is fine for everything
    // except the one-time auth.setup step which auto-promotes itself to headed.
    headless: true,
  },
  projects: [
    {
      // The auth.setup project signs in once and saves storage state for the
      // signed-in projects to consume. It's the only project that runs headed
      // by default (so the user can complete MSAL interactively).
      name: 'auth-setup',
      testMatch: /auth\.setup\.mjs/,
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
      },
    },
    {
      name: 'signed-in',
      testMatch: /.*\.spec\.mjs/,
      dependencies: ['auth-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
    },
  ],
});
