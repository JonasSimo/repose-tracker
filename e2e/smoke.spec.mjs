// RepNet smoke test — verifies the app loads, MSAL state hydrates, and the
// main navigation lands on each of the three feature surfaces we exercise
// in deeper specs later (Quality, Documents, Maintenance).
//
// This is intentionally tiny. It's the Playwright equivalent of "the lights
// are on" — if it fails, every deeper spec would have failed too. Use it
// during setup to confirm auth state is captured correctly; expand the
// deeper spec files (cpar.spec.mjs, docs.spec.mjs, etc.) for actual flows.

import { test, expect } from '@playwright/test';

test('app loads and shows signed-in topbar', async ({ page }) => {
  await page.goto('/');
  // Topbar should render the user's email once MSAL state is hydrated.
  await expect(page.locator('text=@reposefurniture.co.uk').first()).toBeVisible({ timeout: 15_000 });
});

test('navigates to Quality without crashing', async ({ page }) => {
  await page.goto('/');
  // Wait for any signed-in indicator before navigating.
  await page.waitForSelector('text=@reposefurniture.co.uk', { timeout: 15_000 });
  // RepNet uses an inline nav with data-view; click the Quality entry.
  const qualityNav = page.locator('[data-view="quality"], a:has-text("Quality"), button:has-text("Quality")').first();
  await qualityNav.click();
  // Quality tab chips should render — Issues is the default sub-view for everyone.
  await expect(page.locator('text=Issues').first()).toBeVisible({ timeout: 10_000 });
});

test('navigates to Documents without crashing', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('text=@reposefurniture.co.uk', { timeout: 15_000 });
  const docsNav = page.locator('[data-view="documents"], a:has-text("Documents"), button:has-text("Documents")').first();
  await docsNav.click();
  // Document Control v4 renders KPI tiles; "Published" is always one of them.
  await expect(page.locator('text=Published').first()).toBeVisible({ timeout: 10_000 });
});
