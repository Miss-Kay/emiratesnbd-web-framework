import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { PageLink } from './linkChecker';

/**
 * LINK BASELINE
 * -------------
 * The link checker proves nothing is broken. It cannot prove nothing is
 * MISSING: a page that quietly loses half its navigation still passes, because
 * every link that remains resolves perfectly.
 *
 * So we commit a snapshot of the link set and diff against it. A link present
 * at baseline and absent now is a lost journey — the customer can no longer
 * reach that page from here — and that fails the run.
 *
 * New links are reported, never failed. Marketing pages gain content all the
 * time; failing on additions would make the suite noisy, and a noisy suite
 * gets ignored. Refresh the snapshot deliberately instead:
 *
 *   npm run baseline:update
 */

export interface BaselineLink {
  /** Stable identity — see PageLink.key. */
  key: string;
  /** Link text at capture time, so a diff reads like the page. */
  text: string;
}

export interface LinkBaseline {
  page: string;
  capturedAt: string;
  linkCount: number;
  links: BaselineLink[];
}

export interface BaselineDiff {
  /** In the baseline, not on the page now — a lost journey. */
  missing: BaselineLink[];
  /** On the page now, not in the baseline — informational. */
  added: BaselineLink[];
}

/** Build a snapshot from a live collection, sorted so diffs stay readable. */
export function toBaseline(pageUrl: string, links: PageLink[]): LinkBaseline {
  const sorted = [...links]
    .map(link => ({ key: link.key, text: link.text }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    page: pageUrl,
    capturedAt: new Date().toISOString().split('T')[0],
    linkCount: sorted.length,
    links: sorted,
  };
}

export function saveBaseline(path: string, baseline: LinkBaseline): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

export function baselineExists(path: string): boolean {
  return existsSync(path);
}

export function loadBaseline(path: string): LinkBaseline {
  return JSON.parse(readFileSync(path, 'utf8')) as LinkBaseline;
}

/** True when the run was asked to rewrite the snapshot rather than check it. */
export function isUpdateRun(): boolean {
  return process.env.UPDATE_BASELINE === '1';
}

export function diffAgainstBaseline(baseline: LinkBaseline, links: PageLink[]): BaselineDiff {
  const now = new Map(links.map(link => [link.key, link.text]));
  const before = new Map(baseline.links.map(link => [link.key, link.text]));

  return {
    missing: baseline.links.filter(link => !now.has(link.key)),
    added: links
      .filter(link => !before.has(link.key))
      .map(link => ({ key: link.key, text: link.text })),
  };
}

/** A readable diff, attached to the run so the report explains itself. */
export function formatDiff(baseline: LinkBaseline, diff: BaselineDiff, currentCount: number): string {
  const lines = [
    `# Link baseline — ${baseline.page}`,
    '',
    `Baseline captured ${baseline.capturedAt}: ${baseline.linkCount} links`,
    `This run: ${currentCount} links`,
    '',
  ];

  if (diff.missing.length > 0) {
    lines.push(`## Missing since baseline (${diff.missing.length}) — these journeys are gone`, '');
    for (const link of diff.missing) {
      lines.push(`- "${link.text || '(no text)'}" → ${link.key}`);
    }
    lines.push('');
  }

  if (diff.added.length > 0) {
    lines.push(
      `## New since baseline (${diff.added.length}) — not a failure`,
      '',
      'Run `npm run baseline:update` to accept these into the snapshot.',
      '',
    );
    for (const link of diff.added) {
      lines.push(`- "${link.text || '(no text)'}" → ${link.key}`);
    }
    lines.push('');
  }

  if (diff.missing.length === 0 && diff.added.length === 0) {
    lines.push('The link set is unchanged since the baseline was captured.', '');
  }

  return lines.join('\n');
}
