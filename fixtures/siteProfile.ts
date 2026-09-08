/**
 * SITE PROFILE — every site-specific value lives in this one object.
 *
 * Adopting the framework for another bank means writing a new profile plus
 * page objects for that site's navigation; nothing in utils/ references
 * Emirates NBD directly.
 */
export interface SiteProfile {
  /** Human name — used in logs, reports, and test titles. */
  name: string;
  /** Default base URL; the BASE_URL env var overrides it. */
  baseUrl: string;
  /** Entry path the journey launches from. */
  entryPath: string;
  /** Browser locale for the test context. */
  locale: string;
  /**
   * Query parameters that change between page loads without changing the
   * destination. Dropped when a link's identity is computed, so a rotating
   * campaign tag cannot churn the baseline snapshot.
   *
   * utm_* and gclid are the usual analytics tags. `Organic-google` arrives
   * on this site's "Open an Account" CTAs specifically.
   */
  volatileQueryParams: string[];
  /**
   * Hosts a link check must never follow, whatever a page links to.
   *
   * online.emiratesnbd.com is the authenticated banking portal: fetching it
   * from a suite is pointless (it can only answer a sign-in page) and it is
   * the one place on this estate where an automated request could touch a
   * real customer session. The suite is read-only — see the README — and
   * this list is where that guarantee is enforced for links.
   */
  excludedHosts: string[];
  /**
   * Paths that begin an application. The journey asserts it can REACH these
   * and never opens one: a UAE account application collects an Emirates ID
   * and sends a real SMS OTP.
   */
  applicationPathPattern: RegExp;
  /** Header hooks — see HomePage for why each is shaped this way. */
  header: {
    /** The product nav, e.g. Accounts / Cards / Loans. */
    mainNav: string;
    /** The client-segment bar, e.g. Personal / Priority / Private. */
    segmentNav: string;
    /** The mobile menu the hamburger opens — a separate tree, not a restyle. */
    mobileNav: string;
  };
  /**
   * The consent banner itself — NOT the wrapper it lives in. See BasePage
   * for why that distinction is the whole ballgame here.
   */
  consentBanner: string;
  /** The content region below the header — everything the customer reads. */
  contentRoot: string;
  /**
   * Signatures of the site's bot-protection interstitial — the URL it
   * redirects to, and text unique to the page. When a request is served
   * this page the test skips rather than false-failing.
   *
   * Emirates NBD sits behind Cloudflare. A residential IP is served the
   * real page, but a datacenter IP (every CI runner) is a different
   * conversation, and the interstitial is Cloudflare's standard one.
   */
  botBlockUrlPattern?: RegExp;
  botBlockPattern?: RegExp;
}

/**
 * Emirates NBD — UAE. The public marketing site (segment bar → product nav →
 * category listing → product detail) serves an automated browser normally,
 * so the discovery journey runs live against production.
 *
 * robots.txt disallows only /sitecore and publishes a sitemap, so the pages
 * this suite reads are ones the bank invites crawlers into.
 *
 * The suite is read-only: it never signs in, never enters personal data, and
 * never opens an application.
 */
export const emiratesNbdUAE: SiteProfile = {
  name: 'Emirates NBD',
  baseUrl: 'https://www.emiratesnbd.com',
  entryPath: '/en',
  locale: 'en-AE',
  volatileQueryParams: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'icid'],
  excludedHosts: ['online.emiratesnbd.com'],
  // Three distinct entry points, all reached from product pages:
  //   /en/campaigns/account-opening  — most "Apply now" CTAs
  //   /en/campaigns/open-account     — the "Open Account" CTAs on savings
  //   /ENBD/Applications/...         — the digital account-opening app
  applicationPathPattern: /\/en\/campaigns\/(account-opening|open-account)|\/ENBD\/Applications\//i,
  header: {
    mainNav: 'nav.main-menu-wrapper ul.main-menu',
    segmentNav: '.topbar-nav',
    mobileNav: '.menu-for-mobile',
  },
  // #cmpbox, not #cmpwrapper: the wrapper renders 1440x0 and hosts a shadow
  // root, so a visibility check against it always answers "no banner".
  consentBanner: '#cmpbox',
  contentRoot: '.site-main',
  botBlockUrlPattern: /\/cdn-cgi\/|challenges\.cloudflare\.com/i,
  botBlockPattern: /attention required|checking your browser|verify you are human|cf-error/i,
};

/** The profile the suite runs against. */
export const site: SiteProfile = emiratesNbdUAE;
