import { Locator, Page, expect, test } from '@playwright/test';
import { site } from '../fixtures/siteProfile';

/**
 * BasePage: shared plumbing for every page object.
 * Keep this thin — if it grows past ~90 lines, something belongs elsewhere.
 */
export abstract class BasePage {
  constructor(protected page: Page) {}

  async open(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.dismissConsentBanner();
    await this.dismissLanguageModal();
  }

  /**
   * Consent banner.
   *
   * This site does NOT use OneTrust like the other suites in this group —
   * it runs consentmanager.net, whose controls are named `cmp*` rather than
   * `onetrust-*`, and which renders its banner INTO A SHADOW ROOT.
   *
   * Wait on #cmpbox, NOT the #cmpwrapper that hosts it. The wrapper renders
   * 1440x0 — full width, zero height — and holds nothing in the light DOM,
   * so Playwright correctly reports it as not visible and a check against it
   * concludes "no banner was served" while the banner is plainly on screen.
   * The real banner is a `position: fixed` box at z-index 9999999 inside the
   * shadow root, and it takes every click meant for the nav underneath: the
   * first live run failed 203 retries deep with "<div id="cmpwrapper">
   * intercepts pointer events".
   *
   * This is the same trap the OneTrust handlers in the sibling frameworks
   * carry a comment about — different vendor, identical shape. Playwright
   * pierces an open shadow root for CSS selectors, so the controls below
   * need no special treatment once the right element is being waited on.
   *
   * We dismiss with the least-permissive control the banner offers
   * ("Reject Non-essentials") and only fall back to accept if it offers
   * nothing else, so the run does not opt into more tracking than a
   * privacy-conscious customer would.
   *
   * The early return matters: the banner is shown once per browser profile,
   * so most pages in a run are served none at all, and without it every
   * candidate below would burn its timeout in turn on every page open.
   */
  protected async dismissConsentBanner(): Promise<void> {
    const banner = this.page.locator(site.consentBanner);

    const shown = await banner
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!shown) return; // no banner served — nothing to dismiss

    const candidates = [
      // consentmanager's own classes, least-permissive first.
      this.page.locator('.cmpboxbtnno'),   // Reject Non-essentials
      this.page.locator('.cmpboxbtnsave'), // Save + Exit (keeps defaults)
      // Then by what the control actually says, which survives a CMP upgrade.
      this.page.getByRole('link', { name: /reject non-?essential|reject all|decline/i }),
      this.page.getByRole('button', { name: /reject non-?essential|reject all|decline/i }),
      this.page.locator('.cmpboxbtnyes'),  // Accept All — last resort
    ];

    for (const candidate of candidates) {
      try {
        await candidate.first().click({ timeout: 3000 });
        await banner.waitFor({ state: 'hidden', timeout: 8000 });
        return;
      } catch {
        /* try the next control */
      }
    }

    console.warn('[CONSENT] banner was shown but could not be dismissed');
  }

  /**
   * A language chooser ("Choose your language") is present in the markup of
   * every page as a hidden Bootstrap modal and is shown on a first visit.
   * Left up, it takes the click that was meant for the nav.
   */
  protected async dismissLanguageModal(): Promise<void> {
    const modal = this.page.locator('#lang-modal');
    if (!(await modal.isVisible().catch(() => false))) return;
    await modal
      .getByRole('button', { name: /close|english/i })
      .first()
      .click({ timeout: 3000 })
      .catch(() => this.page.keyboard.press('Escape'));
    await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
      console.warn('[CONSENT] language modal would not close');
    });
  }

  /**
   * Drop-off instrumentation: screenshot at each journey step, attached to
   * the test so it appears in the HTML report (and therefore on the S3
   * report site) instead of dying on the CI runner's disk.
   *
   * Takes the page to shoot, because a step that opened a new tab must
   * capture the tab the customer is now looking at, not the one they left.
   */
  async checkpointReached(stepName: string, target: Page = this.page): Promise<void> {
    // Instrumentation must never fail the run it is instrumenting.
    //
    // A checkpoint records where the customer got to; it asserts nothing. On
    // a CI runner the capture can lose its race with the page — a step that
    // opens a new tab is navigating while the screenshot is taken, and
    // Chrome answers "Protocol error (Page.captureScreenshot): Unable to
    // capture screenshot". That failed a journey that had worked, and the
    // retry then passed, which is worse than either outcome: it turns a
    // green suite into a flaky one and trains people to re-run it.
    try {
      const screenshot = await target.screenshot({ fullPage: false });
      await test.info().attach(stepName, { body: screenshot, contentType: 'image/png' });
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.warn(`[JOURNEY] checkpoint "${stepName}" could not be captured: ${detail}`);
    }
    console.info(`[JOURNEY] checkpoint reached: ${stepName}`);
  }

  /**
   * Follow a link and return the page the journey continues on.
   *
   * This is not the one-liner it looks like. Links on this site do not all
   * behave the same way: the product nav routes in the same tab, while the
   * category links on a pillar page carry target="_blank" and open a NEW
   * TAB. Clicking one of those and then asserting on the original page
   * silently tests the page you were already on — the assertion waits out
   * its timeout against a URL that was never going to change, and a journey
   * that actually works reports as broken. (That is exactly how this method
   * came to exist: "View all Savings Accounts" clicked cleanly, no error,
   * and the URL sat on /en/accounts until the 45s timeout expired.)
   *
   * The sibling Standard Bank framework hit the same trap on its Wealth
   * segment tab. Any link this suite clicks goes through here.
   */
  protected async followLink(link: Locator, stepName: string): Promise<Page> {
    const opensNewTab = (await link.getAttribute('target')) === '_blank';

    if (!opensNewTab) {
      await link.click();
      await this.checkpointReached(stepName);
      return this.page;
    }

    const [popup] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 45_000 }),
      link.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    console.info(`[JOURNEY] link opened in a new tab: ${popup.url()}`);
    await this.checkpointReached(stepName, popup);
    return popup;
  }

  /**
   * Dismiss whatever a freshly opened tab puts in front of the customer.
   * open() does this for a navigation; a popup never went through open().
   */
  async settle(): Promise<void> {
    await this.dismissConsentBanner();
    await this.dismissLanguageModal();
  }

  /**
   * Deliberately toHaveURL and not waitForURL. waitForURL waits on the
   * navigation lifecycle, and these pages pull in enough third-party
   * tracking that "load" may never settle on a CI runner. toHaveURL polls
   * page.url(), which is what we actually mean by "we are on this step".
   */
  async expectUrlContains(fragment: string | RegExp): Promise<void> {
    const pattern =
      typeof fragment === 'string'
        ? new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        : fragment;
    await expect(this.page).toHaveURL(pattern, { timeout: 45_000 });
  }

  /**
   * True when Cloudflare served its interstitial instead of the real page.
   * A residential IP is served the site normally; a datacenter IP (every CI
   * runner) is a different conversation, and a challenge page is not a code
   * failure — the suite skips rather than reporting a false regression.
   */
  async isBotBlocked(): Promise<boolean> {
    if (site.botBlockUrlPattern?.test(this.page.url())) return true;
    if (!site.botBlockPattern) return false;
    return this.page
      .getByText(site.botBlockPattern)
      .first()
      .isVisible()
      .catch(() => false);
  }

  /**
   * Scroll the full height of the page so lazy-loaded sections mount and
   * their content enters the DOM. Without this a check silently covers only
   * the part of the page that happened to be above the fold.
   */
  protected async scrollThroughPage(): Promise<void> {
    await this.page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      window.scrollTo(0, 0);
    });
    await this.page.waitForTimeout(1500);
  }
}
