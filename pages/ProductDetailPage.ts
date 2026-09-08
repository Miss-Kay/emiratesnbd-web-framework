import { expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { site } from '../fixtures/siteProfile';

/**
 * Product detail page, e.g. /en/accounts/current-accounts/gold-account —
 * the HARD STOP for this suite.
 *
 * We assert the customer can see the product and can reach the application
 * entry point, and we never open it. Behind "Apply now" is a UAE account
 * application that collects an Emirates ID and sends a real SMS OTP to a
 * real phone; there is no test mode, and a submitted application is a
 * real-world event. This page object therefore exposes no method that
 * clicks it, so no future test can do so by accident.
 */
export class ProductDetailPage extends BasePage {
  /**
   * Assert-only: prove the product page is displayed, the customer arrived
   * through the intended journey, and the path onward exists. Then STOP.
   */
  async assertProductDisplayed(product: string): Promise<void> {
    await expect(
      this.page.locator('.site-main').getByText(new RegExp(product, 'i')).first(),
      `the product page does not name "${product}"`,
    ).toBeVisible({ timeout: 20_000 });

    await this.assertBreadcrumbTrail(product);
    await this.assertApplicationEntryPointReachable();

    await this.checkpointReached('05-product-detail-displayed');
    console.info('[JOURNEY] Product detail page reached. Stopping here by design.');
  }

  /**
   * The breadcrumb proves the customer arrived through the intended journey
   * and can navigate back up it — "Home / Accounts / Current Accounts /
   * Gold Account". A product reachable only by deep link is a dead end for
   * anyone browsing.
   */
  private async assertBreadcrumbTrail(product: string): Promise<void> {
    const breadcrumb = this.page.locator('[class*="breadcrumb"]').first();
    await expect(breadcrumb, 'no breadcrumb on the product page').toBeVisible({ timeout: 15_000 });
    const trail = ((await breadcrumb.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    expect(
      trail.toLowerCase(),
      `the breadcrumb does not end at "${product}" — got "${trail}"`,
    ).toContain(product.toLowerCase());
  }

  /**
   * The apply CTA is the last link in the discovery funnel. It must exist,
   * be enabled, and point at an application — a product a customer cannot
   * act on is a drop-off even though every page along the way returned 200.
   *
   * Scoped to `a.btn` inside the content region deliberately. The header
   * megamenu carries its own "Find a suitable account and apply" links on
   * every page; they are plain text links, never design-system buttons, so
   * this scoping is what keeps the assertion about THIS product rather than
   * about the nav that is present regardless.
   */
  private async assertApplicationEntryPointReachable(): Promise<void> {
    const cta = this.page
      .locator(`${site.contentRoot} a.btn, ${site.contentRoot} button.btn`)
      .filter({ hasText: /apply now|apply|open an account|open account|get started/i })
      .first();

    await expect(cta, 'no application call to action on the product page').toBeVisible({
      timeout: 15_000,
    });
    await expect(cta).toBeEnabled();

    const href = (await cta.getAttribute('href'))?.trim() ?? '';
    expect(
      site.applicationPathPattern.test(href),
      `the apply CTA does not lead to an application — href="${href}"`,
    ).toBe(true);

    // Deliberately NOT clicked — see the class comment.
    console.info(`[JOURNEY] application entry point reachable at ${href} (not opened)`);
  }
}
