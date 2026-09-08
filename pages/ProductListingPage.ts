import { Locator, Page, expect, test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * A category listing page, e.g. /en/accounts/current-accounts.
 *
 * Renders one card per product: a title, an "Apply Now" / "Open an Account"
 * call to action, and a "Know more" link into the product detail page.
 *
 * The site uses two different card components for the same job, and a
 * listing page object hard-wired to either one silently reports an empty
 * catalogue on the other:
 *
 *   Current Accounts  → .card--image-full-width, title in .card__title
 *   Savings Accounts  → .cardlist__grid-item,    title in .cc-block__title
 *
 * So a card is defined by an ordered chain rather than one class, and a
 * card's title is read through the same fallback.
 *
 * This is where silent drop-off shows up: the page still returns 200 when a
 * card loses its "Know more" href, so uptime monitoring stays green while
 * the customer hits a dead end.
 */
export class ProductListingPage extends BasePage {
  private static readonly CARD_SELECTORS = ['.card--image-full-width', '.cardlist__grid-item'];
  private static readonly TITLE_SELECTORS = '.card__title, .cc-block__title';

  /** The card component this page happens to use, resolved once per page. */
  private async cardSelector(timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const selector of ProductListingPage.CARD_SELECTORS) {
        const scoped = `.site-main ${selector}`;
        if ((await this.page.locator(scoped).count()) > 0) return scoped;
      }
      await this.page.waitForTimeout(500);
    } while (Date.now() < deadline);

    throw new Error(
      `[LISTING] no product cards found — tried ${ProductListingPage.CARD_SELECTORS.join(', ')}. `
        + 'Either the listing rendered empty or the shop has changed its card component.',
    );
  }

  private async cards(): Promise<Locator> {
    return this.page.locator(await this.cardSelector());
  }

  /** SLA assertion: the listing must render products, not an empty shell. */
  async assertLoaded(heading: string, slaMs = 20_000): Promise<void> {
    const start = Date.now();
    await expect(
      this.page.locator('.site-main').getByText(new RegExp(heading, 'i')).first(),
    ).toBeVisible({ timeout: slaMs });
    const cards = await this.cards();
    await cards.first().waitFor({ state: 'visible', timeout: slaMs });
    console.info(`[PERF] product listing rendered in ${Date.now() - start}ms (SLA ${slaMs}ms)`);
    await this.checkpointReached('04a-product-listing-loaded');
  }

  /** The catalogue must not silently shrink. */
  async assertMinimumProductsListed(minimum: number): Promise<number> {
    const count = await (await this.cards()).count();
    expect(count, `only ${count} product cards rendered, expected at least ${minimum}`)
      .toBeGreaterThanOrEqual(minimum);
    console.info(`[JOURNEY] ${count} products listed`);
    return count;
  }

  /**
   * Every card must carry what a customer needs to act: a product name and
   * a "Know more" link that actually goes somewhere.
   *
   * An apply CTA on the card is NOT required, and finding out why is worth
   * recording. Five of the fifteen savings cards carry no apply button, and
   * the obvious reading — "these products cannot be applied for" — is
   * wrong: every one of their detail pages returns 200 and offers an apply
   * CTA. The listing is inconsistent, not broken, and the customer reaches
   * an application in one more click. Failing on it would have reported a
   * defect that does not exist, so a card without one is counted and
   * attached to the run instead.
   *
   * Note also that the label varies — "Apply Now", "Apply now" and
   * "Open Account" all appear on the same page for the same act, and the
   * two spellings route to DIFFERENT application paths.
   *
   * All cards are inspected and every defect reported together — a run that
   * stopped at the first bad card would hide the rest of the drop-off.
   */
  async assertEveryCardIsShoppable(): Promise<void> {
    const cards = await (await this.cards()).all();
    const broken: string[] = [];
    const noApplyCta: string[] = [];

    for (const [index, card] of cards.entries()) {
      const titleEl = card.locator(ProductListingPage.TITLE_SELECTORS).first();
      const title = ((await titleEl.textContent().catch(() => '')) ?? '').trim();

      if (!title) {
        broken.push(`card #${index + 1} rendered with no product name`);
        continue;
      }

      const knowMore = card.getByRole('link', { name: /know more/i }).first();
      if ((await knowMore.count()) === 0) {
        broken.push(`"${title}" has no "Know more" link at all`);
      } else {
        const href = await this.settledHref(knowMore);
        if (!href || href.trim() === '' || href.trim() === '#') {
          broken.push(`"${title}" has a dead-end "Know more" link (href=${href ?? 'missing'})`);
        }
      }

      const apply = card
        .getByRole('link', { name: /apply now|apply|open an account|open account|get started/i })
        .first();
      if ((await apply.count()) === 0) noApplyCta.push(title);
    }

    if (noApplyCta.length > 0) {
      await test.info().attach('cards-without-an-apply-cta.md', {
        body:
          '# Product cards with no apply CTA\n\n'
          + 'Reported, not failed: each of these is still reachable and applyable\n'
          + 'through its "Know more" detail page. It is a listing inconsistency.\n\n'
          + noApplyCta.map(title => `- ${title}`).join('\n')
          + '\n',
        contentType: 'text/markdown',
      });
      console.info(
        `[JOURNEY] ${noApplyCta.length} card(s) offer no apply CTA on the listing `
          + '(reachable via "Know more" — reported, not failed)',
      );
    }

    expect(broken, `product cards with drop-off defects:\n  - ${broken.join('\n  - ')}`).toEqual([]);
    console.info(`[JOURNEY] all ${cards.length} product cards are shoppable`);
  }

  /**
   * Poll an anchor's href briefly before judging it. These listings hydrate
   * progressively, and a card read too early reports a healthy link as
   * dead; a link that is still empty once the page has settled is genuine.
   */
  private async settledHref(link: Locator, attempts = 5): Promise<string | null> {
    let href: string | null = null;
    for (let i = 0; i < attempts; i += 1) {
      href = await link.getAttribute('href').catch(() => null);
      if (href && href.trim() !== '' && href.trim() !== '#') return href;
      await this.page.waitForTimeout(500);
    }
    return href;
  }

  /**
   * Open a product's detail page via its "Know more" call to action, and
   * return the page it rendered on — these links may open a new tab too.
   */
  async openProduct(product: string, expectedPath: string): Promise<Page> {
    const cards = await this.cards();
    const card = cards.filter({ hasText: new RegExp(product, 'i') }).first();
    await expect(card, `no product card matching "${product}"`).toBeVisible({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();
    const link = card.getByRole('link', { name: /know more/i }).first();
    const landed = await this.followLink(link, '04b-product-opened');
    await expect(landed).toHaveURL(
      new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      { timeout: 45_000 },
    );
    return landed;
  }
}
