import { expect, test } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { PillarPage } from '../pages/PillarPage';
import { ProductListingPage } from '../pages/ProductListingPage';
import { ProductDetailPage } from '../pages/ProductDetailPage';
import { site } from '../fixtures/siteProfile';
import { clientSegments, journeyMatrix } from '../fixtures/testData';

/**
 * PRODUCT DISCOVERY JOURNEY — Emirates NBD
 *
 * Walks the route a personal customer actually takes to find a product:
 *   home → product nav → category listing → product detail
 *
 * Every step is CLICKED, never goto()'d. A direct navigation would skip the
 * links themselves, so a nav item that renders but no longer routes would
 * pass unnoticed — which is the whole class of defect this suite exists to
 * catch, because the page still returns 200 either way.
 *
 * The journey is READ-ONLY and stops at the product detail page. It never
 * signs in, never enters personal data, and never opens an application:
 * behind "Apply now" is an Emirates ID capture and a real SMS OTP.
 */
test.describe(`${site.name} — product discovery`, () => {
  for (const journey of journeyMatrix) {
    test(`customer can discover a product — ${journey.label} @journey @smoke`, async ({ page }) => {
      const home = new HomePage(page);
      // The journey hops tabs: category links carry target="_blank", so each
      // step's page object is built on the page the previous step actually
      // landed on, not on the one the test started with. See
      // BasePage.followLink.
      let pillar!: PillarPage;
      let listing!: ProductListingPage;
      let detail!: ProductDetailPage;
      let finalUrl = page.url();

      await test.step('Step 1 — launch the site', async () => {
        await home.open(site.entryPath);
        test.skip(
          await home.isBotBlocked(),
          `${site.name} served its Cloudflare interstitial to this runner IP — skipping (not a code failure)`,
        );
        await home.assertLoaded();
      });

      await test.step('Step 2 — every client segment is still reachable', async () => {
        await home.assertSegmentsReachable(clientSegments);
      });

      await test.step(`Step 3 — open the ${journey.pillar} nav item`, async () => {
        const pillarTab = await home.openPillar(journey.pillar, journey.pillarPath);
        pillar = new PillarPage(pillarTab);
        await pillar.settle();
        await pillar.assertLoaded();
      });

      await test.step(`Step 4 — open the ${journey.category} category`, async () => {
        const listingTab = await pillar.openCategory(journey.category, journey.categoryPath);
        listing = new ProductListingPage(listingTab);
        await listing.settle();
      });

      await test.step('Step 5 — the listing renders a shoppable catalogue', async () => {
        await listing.assertLoaded(journey.listingHeading);
        await listing.assertMinimumProductsListed(journey.minProductCards);
        await listing.assertEveryCardIsShoppable();
      });

      await test.step(`Step 6 — open ${journey.product} and stop there`, async () => {
        const detailTab = await listing.openProduct(journey.product, journey.productPath);
        detail = new ProductDetailPage(detailTab);
        await detail.settle();
        await detail.assertProductDisplayed(journey.product);
        finalUrl = detailTab.url();
      });

      // The read-only guarantee, asserted rather than assumed: whatever the
      // steps above did, the run must not have left the marketing site for
      // an application form. Checked on the tab the journey ended on.
      expect(
        site.applicationPathPattern.test(finalUrl),
        `the journey ended inside an application at ${finalUrl} — it must stop before one`,
      ).toBe(false);
    });
  }
});
