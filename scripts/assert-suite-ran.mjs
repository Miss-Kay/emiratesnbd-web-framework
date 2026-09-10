#!/usr/bin/env node
/**
 * Fail the job when the suite tested NOTHING.
 *
 * IDENTICAL ACROSS EVERY REPO IN THIS GROUP — fix it in one and copy it to the
 * others, the same way scripts/setup-aws-reports.sh is handled. Nothing in here
 * names a particular site; each repo's README carries its own diagnosis.
 *
 * Every suite in this group skips rather than fails when its target serves bot
 * protection, and that is the right call: a WAF or an interstitial refusing a
 * CI runner is a fact about the runner, not a defect in the site. Failing on it
 * would mean a red pipeline nobody can fix, and — worse — a link checker that
 * resolves every internal link against a 403 and reports the whole site as
 * broken.
 *
 * But a skip is a PASS as far as Playwright's exit code is concerned. So a run
 * in which every single test skipped reports success: a green tick against a
 * suite that checked nothing at all. That is worse than a red pipeline. A red
 * one gets fixed; a green one that proves nothing quietly becomes the thing
 * everybody trusts, and the next real regression sails straight through it.
 *
 * This is the same failure shape the group already knows from the other
 * direction. "Never believe a zero you did not wait for" is about a count that
 * races a fetch; this is about a pass that never measured anything. Both look
 * healthy from the outside, which is exactly what makes them expensive.
 *
 * So: if tests were collected and every one of them skipped, fail, and say why.
 */
import { readFileSync, existsSync } from 'node:fs';

const JUNIT = process.env.JUNIT_PATH || 'test-results/junit.xml';

if (!existsSync(JUNIT)) {
  console.error(`[GUARD] ${JUNIT} was not produced — the run did not get as far as reporting.`);
  console.error('[GUARD] Check that playwright.config.ts still lists the junit reporter, and that');
  console.error('[GUARD] the test command did not override it with --reporter=...');
  process.exit(1);
}

const xml = readFileSync(JUNIT, 'utf8');
const root = xml.match(/<testsuites\b[^>]*>/)?.[0] ?? '';
const attr = name => Number(root.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? 0);

const tests = attr('tests');
const skipped = attr('skipped');
const failures = attr('failures');
const errors = attr('errors');
const ran = tests - skipped;

console.log(`[GUARD] tests=${tests} ran=${ran} skipped=${skipped} failures=${failures} errors=${errors}`);

if (tests === 0) {
  console.error('[GUARD] no tests were collected at all — check testMatch/testIgnore in playwright.config.ts.');
  process.exit(1);
}

if (ran === 0) {
  // No reason is printed here on purpose. Playwright's JUnit reporter writes a
  // bare <skipped/> with no message attribute — the description passed to
  // test.skip() does not survive into the file, and it is not greppable out of
  // the HTML report either. Checked, rather than assumed. Parsing for it would
  // be dead code that implies the guard knows more than it does, so the log
  // above (which lists every skipped test) and the repo's README carry the
  // diagnosis instead.
  console.error('');
  console.error(`[GUARD] every one of the ${tests} tests skipped. The suite verified NOTHING.`);
  console.error('[GUARD] The step log above lists them; this repo\'s README explains the cause.');
  console.error('');
  console.error('The usual cause is the target refusing this runner. GitHub-hosted runners');
  console.error('egress from Azure IP space in the US, which is a different conversation from');
  console.error('a residential address near the site. Check what this runner actually gets:');
  console.error('');
  console.error('  curl -sI <the site> | head -3');
  console.error('');
  console.error('Options, in order of preference:');
  console.error('  1. Run the suite from a self-hosted runner with egress the site serves.');
  console.error('  2. Point BASE_URL at an environment that does not block automation.');
  console.error('  3. Run it locally — these suites pass from an unblocked address.');
  console.error('');
  console.error('Do NOT "fix" this by deleting the bot-block patterns. That converts a truthful');
  console.error('skip into a report full of fabricated broken links.');
  console.error('');
  console.error('This job fails on purpose. A green tick on a suite that checked nothing is');
  console.error('worse than a red one, because people believe it.');
  process.exit(1);
}

console.log('[GUARD] the suite executed real tests.');
