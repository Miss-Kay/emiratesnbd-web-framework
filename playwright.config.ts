import { defineConfig, devices } from '@playwright/test';
import { site } from './fixtures/siteProfile';

/**
 * BASE_URL is env-driven so the same framework runs against:
 *  - the site profile's production URL (local, headed, exploratory runs)
 *  - a staging environment                (CI — if production ever blocks bots)
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }], // Jira/Xray-importable
  ],
  use: {
    baseURL: process.env.BASE_URL || site.baseUrl, // empty/unset → site profile
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    locale: site.locale,
  },
  /**
   * Two projects, not one. Below ~992px this header collapses into a
   * hamburger that renders a SECOND copy of the whole nav into the same
   * document, and the desktop copy stays in the DOM while hidden. That is
   * precisely the condition that makes `.first()` resolve an invisible
   * element, so the mobile breakpoint is worth running rather than assuming.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Pixel 7, not an iPhone: iPhone descriptors run on WebKit, and CI
      // installs chromium only. Same breakpoint, one browser download.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
