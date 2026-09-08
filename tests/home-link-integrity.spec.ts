import { expect, test } from '@playwright/test';
import path from 'path';
import { LinkScanPage } from '../pages/LinkScanPage';
import { formatReport, groupByVerdict } from '../utils/linkChecker';
import { site } from '../fixtures/siteProfile';
import { knownBrokenLinks } from '../fixtures/testData';

/** Committed snapshot of the home page's link set. */
const BASELINE_PATH = path.join(__dirname, '..', 'fixtures', 'home-links.baseline.json');

/**
 * HOME PAGE LINK INTEGRITY — Emirates NBD
 *
 * The home page is the widest link surface on the estate: ~1,450 anchors
 * resolving to a few hundred unique URLs across the bank's own hosts and
 * dozens of third parties.
 *
 * The run FAILS only on links proven broken. Third-party hosts that refuse
 * an automated request (403/429) are re-checked in a real browser and, if
 * they still refuse, reported as unverified rather than failed — see
 * utils/linkChecker.ts for why that distinction is the difference between a
 * useful suite and a permanently red one.
 *
 * The authenticated portal (online.emiratesnbd.com) is never fetched; see
 * SiteProfile.excludedHosts.
 */
test.describe(`${site.name} — home page link integrity`, () => {
  test('every link on the home page resolves @links @smoke', async ({ page, context }) => {
    const home = new LinkScanPage(page);

    await test.step('Step 1 — launch the site', async () => {
      await home.open(site.entryPath);
      test.skip(
        await home.isBotBlocked(),
        `${site.name} served its Cloudflare interstitial to this runner IP — skipping (not a code failure)`,
      );
      await home.assertLoaded();
    });

    await test.step('Step 2 — no anchor has an unresolvable href', async () => {
      const malformed = await home.malformedLinks();
      expect(malformed, `anchors with unparseable hrefs:\n  - ${malformed.join('\n  - ')}`)
        .toEqual([]);
    });

    await test.step('Step 3 — report authored href defects', async () => {
      // Reported, never failed: the browser forgives both classes. This is
      // the step that documents the padded-href nav rather than tripping
      // over it. See collectHrefHygiene.
      await home.reportHrefHygiene();
    });

    const links = await test.step('Step 4 — collect the link set', async () => {
      const collected = await home.links();
      expect(collected.length, 'no links were collected — the page did not render')
        .toBeGreaterThan(50);
      return collected;
    });

    await test.step('Step 5 — every link resolves', async () => {
      const results = await home.checkAllLinks(context, links);
      const grouped = groupByVerdict(results);

      await test.info().attach('link-integrity-report.md', {
        body: formatReport(page.url(), results),
        contentType: 'text/markdown',
      });

      // Unreachable internal links are broken links: the bank controls that
      // host, so a DNS/TLS/timeout failure there is a real defect.
      const internalUnreachable = grouped.unreachable.filter(result => result.internal);
      const failures = [...grouped.broken, ...internalUnreachable];

      const known = failures.filter(result => knownBrokenLinks.some(k => k.url.test(result.url)));
      const fresh = failures.filter(result => !knownBrokenLinks.some(k => k.url.test(result.url)));

      if (known.length > 0) {
        await test.info().attach('known-broken-links.md', {
          body:
            '# Known broken links still live\n\n'
            + known
              .map(result => {
                const entry = knownBrokenLinks.find(k => k.url.test(result.url));
                return `- ${result.url} (found ${entry?.found}) — ${entry?.note}`;
              })
              .join('\n')
            + '\n',
          contentType: 'text/markdown',
        });
      }

      console.info(
        `[LINKS] ok=${grouped.ok.length} broken=${grouped.broken.length} `
          + `unreachable=${grouped.unreachable.length} blocked=${grouped.blocked.length}`,
      );
      for (const result of fresh) {
        console.warn(`[LINKS] BROKEN ${result.status ?? result.detail} "${result.text}" → ${result.url}`);
      }

      expect(
        fresh,
        `${fresh.length} NEW broken link(s): `
          + fresh.map(result => `${result.status ?? result.detail} ${result.url}`).join(', '),
      ).toHaveLength(0);
    });

    await test.step('Step 6 — no link has gone missing since the baseline', async () => {
      const diff = await home.compareToBaseline(BASELINE_PATH, links);

      // Resolving every link proves nothing is broken; it cannot prove
      // nothing has gone MISSING. A page that loses half its navigation
      // still passes a pure link check, because everything left over
      // resolves perfectly. New links are reported, never failed.
      expect(
        diff.missing,
        `${diff.missing.length} link(s) present at baseline are gone from the page — `
          + 'those journeys can no longer be reached from the home page:\n'
          + diff.missing.map(link => `  - "${link.text || '(no text)'}" → ${link.key}`).join('\n'),
      ).toHaveLength(0);
    });
  });
});
