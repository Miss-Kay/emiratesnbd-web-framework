import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { healing } from '../utils/selfHealing';

/**
 * A product pillar page, e.g. /en/accounts — "Our accounts and deposits".
 * Lists the categories inside that pillar (Current Accounts, Savings
 * Accounts, Deposits), each linking to its product listing.
 */
export class PillarPage extends BasePage {
  async assertLoaded(slaMs = 20_000): Promise<void> {
    const start = Date.now();
    await expect(this.page.locator('.site-main')).toBeVisible({ timeout: slaMs });
    console.info(`[PERF] pillar page rendered in ${Date.now() - start}ms (SLA ${slaMs}ms)`);
    await this.checkpointReached('03a-pillar-loaded');
  }

  /**
   * Every category in the pillar must still be linked.
   *
   * The categories live in the page's own content, not only in the header
   * megamenu, so this is scoped to `.site-main` — a category that survives
   * in the nav but has vanished from the page it belongs to is still a lost
   * journey for anyone who navigated here rather than hovering the menu.
   */
  async assertCategoriesPresent(categories: string[]): Promise<void> {
    const missing: string[] = [];
    for (const category of categories) {
      const link = this.page
        .locator('.site-main a')
        .filter({ hasText: new RegExp(`^\\s*${category}\\s*$`, 'i') })
        .first();
      if ((await link.count()) === 0) missing.push(category);
    }
    expect(missing, `category links missing from the pillar page: ${missing.join(', ')}`)
      .toEqual([]);
  }

  /**
   * Open a category and return the page its listing rendered on.
   *
   * These links carry target="_blank" — see BasePage.followLink for what
   * that costs if you assume otherwise.
   */
  async openCategory(category: string, expectedPath: string): Promise<Page> {
    const link = healing(this.page, `${category} category link`, [
      {
        name: 'content link by href',
        build: p => p.locator(`.site-main a[href*="${expectedPath}"]`),
      },
      {
        name: 'content link by text',
        build: p =>
          p.locator('.site-main a').filter({ hasText: new RegExp(`^\\s*${category}\\s*$`, 'i') }),
      },
      {
        name: 'anywhere by href',
        build: p => p.locator(`a[href*="${expectedPath}"]`),
      },
    ]);

    const resolved = await link.resolve();
    await resolved.scrollIntoViewIfNeeded();
    const landed = await this.followLink(resolved, '03b-category-opened');
    await expect(landed).toHaveURL(
      new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      { timeout: 45_000 },
    );
    return landed;
  }
}
