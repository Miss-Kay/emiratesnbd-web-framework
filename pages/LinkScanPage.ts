import { BrowserContext, expect, test } from '@playwright/test';
import { BasePage } from './BasePage';
import {
  LinkResult,
  PageLink,
  checkLinks,
  collectHrefHygiene,
  collectLinks,
  collectMalformedLinks,
  formatHygiene,
  verifyBlockedInBrowser,
} from '../utils/linkChecker';
import {
  BaselineDiff,
  baselineExists,
  diffAgainstBaseline,
  formatDiff,
  isUpdateRun,
  loadBaseline,
  saveBaseline,
  toBaseline,
} from '../utils/linkBaseline';

/**
 * Any page whose links are being checked. Deliberately not tied to one URL:
 * the home page is the first target, but the same object scans a pillar or
 * a listing page without change.
 */
export class LinkScanPage extends BasePage {
  /** Every anchor on the page, deduped and resolved to absolute URLs. */
  async links(): Promise<PageLink[]> {
    // The page lazy-loads sections as they scroll into view, so links below
    // the fold are not in the DOM until it has been scrolled.
    await this.scrollThroughPage();
    const links = await collectLinks(this.page);
    console.info(`[LINKS] collected ${links.length} unique links`);
    return links;
  }

  /** Anchors whose href cannot be resolved to a URL at all — always a defect. */
  async malformedLinks(): Promise<string[]> {
    return collectMalformedLinks(this.page);
  }

  /**
   * Authored href defects that resolve anyway. Attached to the run and
   * reported, never failed — see collectHrefHygiene for why.
   */
  async reportHrefHygiene(): Promise<{ padded: number; doubled: number; insecure: number }> {
    const hygiene = await collectHrefHygiene(this.page);
    await test.info().attach('href-hygiene.md', {
      body: formatHygiene(hygiene),
      contentType: 'text/markdown',
    });
    if (hygiene.padded.length > 0) {
      console.info(`[LINKS] ${hygiene.padded.length} href(s) authored with stray whitespace`);
    }
    if (hygiene.doubled.length > 0) {
      console.warn(`[LINKS] ${hygiene.doubled.length} href(s) contain a doubled URL`);
    }
    if (hygiene.insecure.length > 0) {
      console.warn(
        `[LINKS] ${hygiene.insecure.length} href(s) link to this site over http://`,
      );
    }
    return {
      padded: hygiene.padded.length,
      doubled: hygiene.doubled.length,
      insecure: hygiene.insecure.length,
    };
  }

  /**
   * Resolve every link, then re-check in a real browser any that a
   * third-party host refused. See utils/linkChecker.ts for the rules.
   */
  async checkAllLinks(context: BrowserContext, links: PageLink[]): Promise<LinkResult[]> {
    const apiResults = await checkLinks(this.page.request, links);
    const blocked = apiResults.filter(result => result.verdict === 'blocked').length;
    if (blocked > 0) {
      console.info(`[LINKS] re-checking ${blocked} refused link(s) in a real browser`);
    }
    return verifyBlockedInBrowser(context, apiResults);
  }

  /**
   * Diff the collected links against the committed snapshot.
   *
   * Returns an empty diff on an update run, having rewritten the snapshot.
   */
  async compareToBaseline(baselinePath: string, links: PageLink[]): Promise<BaselineDiff> {
    if (isUpdateRun()) {
      saveBaseline(baselinePath, toBaseline(this.page.url(), links));
      console.info(`[BASELINE] snapshot rewritten with ${links.length} links → ${baselinePath}`);
      return { missing: [], added: [] };
    }

    if (!baselineExists(baselinePath)) {
      test.skip(true, 'No link baseline captured yet. Run: npm run baseline:update');
      return { missing: [], added: [] };
    }

    const baseline = loadBaseline(baselinePath);
    const diff = diffAgainstBaseline(baseline, links);

    await test.info().attach('link-baseline-diff.md', {
      body: formatDiff(baseline, diff, links.length),
      contentType: 'text/markdown',
    });

    // Both directions go to the console, not only the attachment. A CI run
    // publishes its attachments to the HTML report, but the report artifact
    // does not always carry them and the Actions log elides attachment
    // bodies — so a drift that only exists in an attachment is a drift you
    // cannot diagnose without re-running. The console survives both.
    for (const link of diff.missing) {
      console.info(`[BASELINE] MISSING "${link.text || '(no text)'}" → ${link.key}`);
    }
    for (const link of diff.added) {
      console.info(`[BASELINE] ADDED   "${link.text || '(no text)'}" → ${link.key}`);
    }
    console.info(
      `[BASELINE] ${baseline.linkCount} at baseline, ${links.length} now `
        + `(missing=${diff.missing.length} added=${diff.added.length})`,
    );

    return diff;
  }

  /** The page rendered at all — a blank shell has no links to be missing. */
  async assertLoaded(): Promise<void> {
    await expect(this.page.locator('.site-main')).toBeVisible({ timeout: 30_000 });
  }
}
