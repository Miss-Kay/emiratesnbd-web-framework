import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { healing } from '../utils/selfHealing';
import { site } from '../fixtures/siteProfile';

/**
 * Emirates NBD home page — the launch point of the journey.
 *
 * The header carries two bars:
 *   topbar  → client segment (Personal, Priority, Private, Emirati, …)
 *   navbar  → the product nav for that segment (Accounts, Cards, Loans,
 *             Foreign Exchange, Wealth & Insurance, Ways of Banking)
 *
 * Two things about this header are not obvious and both cost a run to find:
 *
 * 1. The product-nav hrefs are authored with leading whitespace —
 *    `href="     /en/accounts"`. Browsers trim it, so the link works and
 *    `a.href` resolves correctly, but any selector written as
 *    `a[href="/en/accounts"]` matches nothing. The primary locator is
 *    therefore `data-target`, which is clean, and the href fallback uses
 *    `*=` rather than `=`.
 *
 * 2. The header renders TWICE — once for desktop and once for the mobile
 *    megamenu — into the same document. A plain `.first()` frequently
 *    resolves the hidden copy, so every locator here goes through the
 *    self-healing chain, which scans for the first VISIBLE match.
 */
export class HomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * A product-nav item, e.g. "Accounts".
   *
   * The primary candidate is a union of the desktop and mobile markups on
   * purpose. Both are correct — the header simply renders a different copy
   * per breakpoint — so treating either as a "heal" would log a warning on
   * every mobile run, and a warning that always fires is one nobody reads.
   * A heal from here is then a real signal that the markup moved.
   */
  private navItem(pillar: string) {
    return healing(this.page, `${pillar} nav item`, [
      {
        name: 'main nav data-target (desktop or mobile)',
        build: p =>
          p
            .locator(`${site.header.mainNav} a[data-target="${pillar}"]`)
            .or(p.locator(`a.js-menusection-link[data-target="${pillar}"]`)),
      },
      {
        name: 'main nav title attribute',
        build: p => p.locator(`${site.header.mainNav} a[title="${pillar}"]`),
      },
      {
        // NB *= not =. See the class comment: these hrefs carry leading
        // whitespace, so an exact-match attribute selector finds nothing.
        name: 'href fragment',
        build: p => p.locator(`header a[href*="/en/${pillar.toLowerCase()}"]`),
      },
    ]);
  }

  /** A client-segment tab in the top bar, e.g. "PRIORITY". */
  private segmentTab(segment: string) {
    // The visible text is padded with a run of whitespace in the markup, so
    // match loosely rather than anchoring the pattern to the string ends.
    const name = new RegExp(segment.replace(/\s+/g, '\\s+'), 'i');
    return healing(this.page, `${segment} segment tab`, [
      {
        // Desktop renders these as .main-nav-segment links; the mobile
        // header renders unclassed anchors in the same bar. Both are the
        // segment control, so both are the primary candidate.
        name: 'topbar segment control (desktop or mobile)',
        build: p =>
          p
            .locator(`${site.header.segmentNav} a.main-nav-segment`)
            .filter({ hasText: name })
            .or(
              p
                .locator(`${site.header.mobileNav} li.js-mobile-segment-level > a`)
                .filter({ hasText: name }),
            ),
      },
      { name: 'role=link', build: p => p.getByRole('link', { name }) },
    ]);
  }

  /** Step 1 — the home page rendered and its header is usable. */
  async assertLoaded(slaMs = 30_000): Promise<void> {
    const start = Date.now();
    await expect(this.page.locator('header.site-header')).toBeVisible({ timeout: slaMs });
    await this.navItem('Accounts').resolve();
    console.info(`[PERF] home page rendered in ${Date.now() - start}ms (SLA ${slaMs}ms)`);
    await this.checkpointReached('01-home-loaded');
  }

  /**
   * Every client segment must still be reachable from the header.
   *
   * A segment quietly dropping out is a whole customer population losing
   * its entry point while every page involved still returns 200 — invisible
   * to uptime monitoring, which is exactly the class of defect this suite
   * exists to catch.
   *
   * The check has to be breakpoint-aware, and finding that out cost a run.
   * On desktop each segment tab is an ordinary link carrying its own href.
   * On mobile the visible control is `javascript:void(0);` — a toggle that
   * reveals the segment's section of the megamenu — and the real
   * destination links sit in that collapsed menu. Asserting an href against
   * the mobile control reports every segment as broken on a header that
   * works perfectly.
   *
   * So a segment counts as reachable when the control is present AND the
   * header links to its destination somewhere. This deliberately does not
   * drive the mobile reveal: the two facts it asserts — the entry point is
   * there, and the destination is still linked — are the ones that regress,
   * and checking them costs no menu state.
   */
  async assertSegmentsReachable(segments: { label: string; path: string }[]): Promise<void> {
    const missing: string[] = [];

    for (const segment of segments) {
      const control = await this.segmentTab(segment.label)
        .resolve()
        .catch(() => null);
      if (!control) {
        missing.push(`"${segment.label}" is not in the header at all`);
        continue;
      }

      const href = ((await control.getAttribute('href')) ?? '').trim();
      if (href.includes(segment.path)) continue; // desktop: the tab links straight there

      // Mobile: the control is a toggle, so look for the destination itself.
      const destination = this.page.locator(`header a[href*="${segment.path}"]`);
      if ((await destination.count()) === 0) {
        missing.push(
          `"${segment.label}" is a toggle (href=${href || 'none'}) and the header `
            + `carries no link to ${segment.path}`,
        );
      }
    }

    expect(missing, `client segments missing from the header:\n  - ${missing.join('\n  - ')}`)
      .toEqual([]);
    console.info(`[JOURNEY] all ${segments.length} client segments reachable`);
  }

  /**
   * Step 2 — open a product pillar from the nav.
   *
   * Clicked, not goto()'d: a direct navigation would skip the link itself,
   * so a nav item that renders but no longer routes would pass unnoticed.
   *
   * The two breakpoints take genuinely different routes, and treating them
   * as one cost two runs to work out:
   *
   *   desktop — the nav item IS the link. Click it and the page navigates.
   *
   *   mobile  — the nav is behind a hamburger, and the item is a SECTION
   *             TOGGLE, not a link. Tapping it expands the section and
   *             navigates nowhere; the pillar's own link ("Our accounts and
   *             deposits") is one of the things the expansion reveals.
   *             Before the hamburger is opened the item is technically
   *             "visible" to Playwright while sitting outside the viewport,
   *             so a click on it retries until the test times out rather
   *             than failing fast.
   */
  async openPillar(pillar: string, expectedPath: string): Promise<Page> {
    const onMobile = await this.openMobileNavIfPresent();
    const navItem = await this.navItem(pillar).resolve();

    if (!onMobile) {
      const landed = await this.followLink(navItem, '02-pillar-opened');
      await this.assertLandedOn(landed, expectedPath);
      return landed;
    }

    // Mobile: expand the section, then follow the pillar link inside it.
    await navItem.click();
    const pillarLink = await healing(this.page, `${pillar} pillar link (mobile menu)`, [
      {
        // Scoped to .mobile-inner — the panel the expansion opens — and NOT
        // to .menu-for-mobile as a whole. The section toggle we just clicked
        // is itself an anchor carrying href="     /en/accounts", so a looser
        // selector matches the toggle, waits for it to become clickable
        // again, and times the test out on an element that is doing exactly
        // what it should. (The stray whitespace in that href is the site's,
        // not a typo — see the class comment.)
        name: 'link inside the expanded panel',
        build: p => p.locator(`${site.header.mobileNav} .mobile-inner a[href$="${expectedPath}"]`),
      },
      {
        name: 'any link to the pillar that is not the section toggle',
        build: p => p.locator(`a[href$="${expectedPath}"]:not(.js-menusection-link)`),
      },
    ]).resolve();

    const landed = await this.followLink(pillarLink, '02-pillar-opened');
    await this.assertLandedOn(landed, expectedPath);
    return landed;
  }

  /**
   * Open the mobile menu if this breakpoint has one. Returns true when the
   * run is on the mobile header, so callers can branch on the interaction
   * model rather than on a viewport width they would have to keep in sync
   * with the site's CSS.
   */
  private async openMobileNavIfPresent(): Promise<boolean> {
    const hamburger = this.page.locator('.mobile-hamburger').first();
    if (!(await hamburger.isVisible().catch(() => false))) return false;
    await hamburger.click();
    await this.page.waitForTimeout(1000); // the menu slides in
    return true;
  }

  private async assertLandedOn(target: Page, expectedPath: string): Promise<void> {
    await expect(target).toHaveURL(
      new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      { timeout: 45_000 },
    );
  }
}
