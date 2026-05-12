// RepNet smoke test — verifies storageState hydrates and the app reaches
// a signed-in state. Deliberately minimal: this is the "lights are on"
// check, not a flow test. Deeper specs (CPAR, Docs, Maintenance, NCR)
// land in follow-up commits.

import { test, expect } from '@playwright/test';

// We check the #auth-badge title attribute rather than visibility, because:
// (1) graphAccount is a top-level `let` not exposed on window;
// (2) the v4 skin hides the topbar in team-select view and mirrors its
//     contents to a sidebar pill, so the original element is in the DOM
//     but not visible.
const signedIn = async (page) => {
  await page.waitForFunction(() => {
    const el = document.getElementById('auth-badge');
    return !!el && /Signed in as/i.test(el.getAttribute('title') || '');
  }, null, { timeout: 20_000 });
};

test('app loads and reaches signed-in state', async ({ page }) => {
  await page.goto('/');
  await signedIn(page);
});

test('signed-in user is a Repose account', async ({ page }) => {
  await page.goto('/');
  await signedIn(page);
  const title = await page.locator('#auth-badge').getAttribute('title');
  expect(title).toMatch(/@reposefurniture\.co\.uk/i);
});

test('auth-badge dot reflects signed-in state', async ({ page }) => {
  await page.goto('/');
  await signedIn(page);
  // updateAuthBadge replaces #auth-badge innerHTML with `.auth-dot.on`.
  // Check via DOM (not visibility) because the v4 skin may hide the topbar.
  const dotOnExists = await page.locator('#auth-badge .auth-dot.on').count();
  expect(dotOnExists).toBeGreaterThan(0);
});
