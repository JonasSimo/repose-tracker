import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run unit tests in js/. Playwright specs in e2e/ use a different
    // test runner (@playwright/test) and have their own config and runner.
    include: ['js/**/*.{test,spec}.mjs', 'js/**/*.{test,spec}.js'],
    exclude: ['node_modules/**', 'e2e/**', 'playwright-report/**', 'test-results/**'],
  },
});
