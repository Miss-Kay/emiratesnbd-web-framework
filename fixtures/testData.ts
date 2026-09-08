/** Typed test data — single source of truth, easy to extend to data-driven runs. */

export interface ProductJourney {
  /** Human label, used in the test title. */
  label: string;
  /** Product-nav item in the header, matched on its data-target attribute. */
  pillar: string;
  /** Path the pillar link must resolve to. */
  pillarPath: string;
  /** Category link on the pillar page, by visible text. */
  category: string;
  /** Path the category link must resolve to. */
  categoryPath: string;
  /** Heading that proves the category listing rendered. */
  listingHeading: string;
  /** Product on the listing whose detail page the journey opens. */
  product: string;
  /** Path the product detail page must resolve to. */
  productPath: string;
  /** Minimum cards the listing must show to be considered healthy. */
  minProductCards: number;
}

/**
 * The reference journey: a personal customer discovering a transactional
 * account — Accounts → Current Accounts → Gold Account.
 */
export const currentAccountsJourney: ProductJourney = {
  label: 'Accounts → Current Accounts → Gold Account',
  pillar: 'Accounts',
  pillarPath: '/en/accounts',
  category: 'Current Accounts',
  categoryPath: '/en/accounts/current-accounts',
  listingHeading: 'Current Account',
  product: 'Gold Account',
  productPath: '/en/accounts/current-accounts/gold-account',
  minProductCards: 5,
};

/**
 * A second category through the same page objects, proving they are driven
 * by data rather than hard-wired to one product line.
 *
 * It also exercises a different card component: Current Accounts renders
 * `.card--image-full-width` with a `.card__title`, while Savings renders
 * `.cardlist__grid-item` with a `.cc-block__title`. Same journey, two
 * markups — which is exactly what the listing page object's locator chain
 * exists to absorb.
 */
export const savingsAccountsJourney: ProductJourney = {
  label: 'Accounts → Savings Accounts → Plus Saver Account',
  pillar: 'Accounts',
  pillarPath: '/en/accounts',
  category: 'Savings Accounts',
  categoryPath: '/en/accounts/savings-accounts',
  listingHeading: 'Savings Accounts',
  product: 'Plus Saver Account',
  productPath: '/en/accounts/savings-accounts/plus-saver-account',
  minProductCards: 8,
};

/** Data-driven matrix — the spec generates one test per entry. */
export const journeyMatrix: ProductJourney[] = [currentAccountsJourney, savingsAccountsJourney];

/**
 * Client-segment tabs that must stay reachable from the header. A segment
 * silently dropping out of the bar is a whole customer population losing
 * its entry point while every page still returns 200.
 */
export const clientSegments: { label: string; path: string }[] = [
  { label: 'PRIORITY', path: '/en/priority-banking' },
  { label: 'PRIVATE', path: '/en/private-banking' },
  { label: 'EMIRATI', path: '/en/emirati' },
  { label: 'BUSINESS', path: '/en/business-banking' },
  { label: 'ISLAMIC', path: '/en/islamic-banking' },
];

/**
 * Known-broken links, quarantined so the suite still fails on NEW breakage.
 *
 * A permanently red pipeline hides the next regression, so a defect that is
 * already reported and still live is listed here with the date it was found
 * and re-reported in the run's attachments rather than failing it.
 *
 * Re-check them on demand with: npm run test:links
 */
export const knownBrokenLinks: { url: RegExp; found: string; note: string }[] = [
  {
    url: /businessonline\.emiratesnbd\.com\/demo\/index\.html/i,
    found: '2026-09-08',
    note:
      'The "businessONLINE learning guide" link in the footer 404s. Confirmed '
      + 'outside Playwright with a plain browser-shaped request, so it is the '
      + 'page that is gone, not the checker being refused.',
  },
];
