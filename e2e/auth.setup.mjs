// One-off MSAL auth setup. Opens RepNet in a headed browser, triggers
// graphSignIn() programmatically (so the user doesn't have to hunt for
// the sidebar avatar button), and waits for the MSAL popup to complete.
// Resulting cookies + localStorage + sessionStorage are saved to
// e2e/.auth/user.json for every subsequent test to consume.
//
// Re-run with:        npm run e2e:auth
// Force re-auth:      RE_AUTH=1 npm run e2e:auth
// For CI:             base64 the state file and store as TEST_MSAL_STATE secret.

import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR  = 'e2e/.auth';
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');

setup('authenticate', async ({ page, context }) => {
  if (fs.existsSync(AUTH_FILE) && !process.env.RE_AUTH) {
    console.log(`[auth] reusing existing state at ${AUTH_FILE} (set RE_AUTH=1 to force re-auth)`);
    return;
  }
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // Generous timeout — MSAL popup + MFA can take a while.
  setup.setTimeout(240_000);

  // Listen for the MSAL popup window so we can verify it opens, and so
  // Playwright keeps the context alive during the popup-based flow.
  const popupPromise = context.waitForEvent('page', { timeout: 30_000 }).catch(() => null);

  await page.goto('/');

  // Wait until RepNet's bootstrap has defined graphSignIn (it's attached
  // as a global by the inline script). This proves the app shell loaded.
  await page.waitForFunction(
    () => typeof window.graphSignIn === 'function',
    null,
    { timeout: 30_000 }
  );

  // Detect signed-in state via #auth-badge's title attribute, which becomes
  // "Signed in as {email} · Click to sign out" when graphAccount populates
  // (set by updateAuthBadge). We check the title — not visibility — because
  // the v4 skin hides the topbar in team-select view and mirrors its
  // contents into a sidebar JS pill, so the original #auth-badge element
  // is in the DOM but hidden. window.graphAccount is also unreliable
  // because it's a top-level `let` not attached to window.
  const signedInTitle = async () => {
    const t = await page.locator('#auth-badge').getAttribute('title');
    return /Signed in as/i.test(t || '');
  };
  const alreadySignedIn = await signedInTitle();
  if (alreadySignedIn) {
    console.log('[auth] already signed in — capturing state without re-auth');
  } else {
    // RepNet renders Select-Your-Team as a public guest landing — the only
    // way to trigger sign-in is to call graphSignIn() (the badge click
    // handler). Calling it directly is more reliable than clicking the
    // pill because the pill isn't found by Playwright with stable selectors.
    console.log('[auth] triggering MSAL sign-in — a popup will open; complete sign-in there.');
    await page.evaluate(() => window.graphSignIn());

    const popup = await popupPromise;
    if (popup) {
      console.log(`[auth] MSAL popup opened at ${popup.url()}`);
    } else {
      console.log('[auth] no popup detected — sign-in may use the main window (mobile path)');
    }

    // Poll the #auth-badge title attribute — flips to "Signed in as …"
    // when updateAuthBadge fires after MSAL resolves. Title-based check
    // works regardless of whether the topbar is visible (the v4 skin hides
    // it in team-select view). Long timeout allows for MFA.
    await page.waitForFunction(() => {
      const el = document.getElementById('auth-badge');
      return !!el && /Signed in as/i.test(el.getAttribute('title') || '');
    }, null, { timeout: 220_000, polling: 1000 });
  }

  // Belt-and-braces — let MSAL finish writing refresh tokens before we
  // snapshot state.
  await page.waitForTimeout(3000);
  await page.context().storageState({ path: AUTH_FILE });
  // Read the signed-in name from the auth badge's title attribute (set by
  // updateAuthBadge to "Signed in as {email} · Click to sign out").
  const title = (await page.locator('#auth-badge').getAttribute('title')) || '';
  const who = (title.match(/Signed in as (\S+)/) || [, 'unknown'])[1];
  console.log(`[auth] saved storage state for ${who} → ${AUTH_FILE}`);
});
