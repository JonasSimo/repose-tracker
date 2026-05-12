// One-off MSAL auth setup. Opens RepNet in a headed browser; you sign in
// manually with the test account; Playwright captures the resulting
// storage state (cookies + localStorage + sessionStorage including MSAL
// refresh tokens) into e2e/.auth/user.json.
//
// Re-run this whenever the saved state expires or you want to re-auth:
//
//   npm run e2e:auth
//
// The saved state file is git-ignored. For CI, base64 the file and store
// as TEST_MSAL_STATE repo secret — the workflow decodes it on the fly.

import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR  = 'e2e/.auth';
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');

setup('authenticate', async ({ page }) => {
  // Skip re-auth if we already have a state file. Re-running cheap.
  if (fs.existsSync(AUTH_FILE) && !process.env.RE_AUTH) {
    console.log(`[auth] reusing existing state at ${AUTH_FILE} (set RE_AUTH=1 to force re-auth)`);
    return;
  }
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // Generous timeout — MSAL popups + 2FA can take a while.
  setup.setTimeout(180_000);

  await page.goto('/');

  // Wait for the user to complete sign-in. Heuristic: the top-bar pill shows
  // the signed-in email; the auth flow is done once it appears in the DOM.
  // If the selector ever changes, swap to a more stable assertion (e.g.
  // a button only signed-in users see).
  console.log('[auth] complete MSAL sign-in in the browser window — capture happens automatically once the top bar shows your email.');
  await page.waitForSelector('text=@reposefurniture.co.uk', { timeout: 170_000 });

  // Give the app a beat to finish caching tokens before we capture state.
  await page.waitForTimeout(2000);
  await page.context().storageState({ path: AUTH_FILE });
  console.log(`[auth] saved storage state to ${AUTH_FILE}`);
});
