# Emirates NBD — web journey & link integrity framework

Playwright + TypeScript suite against **https://www.emiratesnbd.com/en**.
Same architecture as the Standard Bank, FlySafair and Vodacom frameworks in
this workspace: a single site profile, page objects over a shared `BasePage`,
self-healing locators, and CI publishing reports to S3 over OIDC.

```bash
npm ci && npx playwright install --with-deps chromium && npm test
```

## What it covers

| Suite | File | What it proves |
|---|---|---|
| Product discovery | `tests/products-journey.spec.ts` | A customer can get from the home page to a product detail page and reach an application — home → product nav → category listing → product detail |
| Link integrity | `tests/home-link-integrity.spec.ts` | Every one of the ~339 unique links on the home page still resolves, and none has silently disappeared |

Both run on two projects: `chromium` (1440×900) and `mobile` (Pixel 7). The
mobile project is not decoration — the header is a different markup tree at
that breakpoint, and the journey takes a different route through it.

## Read-only, by construction

The suite never signs in, never enters personal data, and never opens an
application. Behind every "Apply now" is an Emirates ID capture and a real
SMS OTP; there is no test mode, so a submitted application is a real-world
event.

That guarantee is enforced in three places rather than trusted:

- `ProductDetailPage` exposes **no method that clicks the apply CTA**. It
  asserts the CTA exists, is enabled, and points at an application path —
  then stops. No future test can open one by accident.
- The journey asserts, at the end, that the page it finished on is *not* an
  application URL.
- `SiteProfile.excludedHosts` keeps the link checker away from
  `online.emiratesnbd.com` entirely — the authenticated portal is the one
  host where an automated request could touch a real customer session.

`robots.txt` disallows only `/sitecore` and publishes a sitemap, so the pages
this suite reads are ones the bank invites crawlers into.

## Things this site does that cost a run to discover

Each of these is commented at the code that handles it. They are recorded
here because they are the reason the page objects are shaped the way they
are, and because at least two of them are worth porting to the sibling
frameworks.

**The consent banner lives in a shadow root.** This site runs
consentmanager.net, not OneTrust. It renders into `#cmpwrapper`, which is
1440×0 and holds nothing in the light DOM, so a visibility check against it
always answers "no banner was served" — while the real banner, a fixed box at
z-index 9999999 inside the shadow root, takes every click meant for the nav.
The first live run failed 203 retries deep with `<div id="cmpwrapper">
intercepts pointer events`. Wait on `#cmpbox`, not the wrapper. Playwright
pierces an open shadow root for CSS selectors, so nothing else is special.

**Category links open in a new tab.** The links on a pillar page carry
`target="_blank"`. Clicking one and then asserting on the original page tests
the page you were already on: the assertion waits out its full timeout
against a URL that was never going to change, and a journey that works
reports as broken. `BasePage.followLink()` returns the page the journey
continues on, and every click in the suite goes through it. The Standard Bank
framework hit the identical trap on its Wealth segment tab.

**The main nav is authored with padded hrefs.** 88 of them, including the
entire product nav: `href="     /en/accounts"`. The browser trims it, so the
links work and the link check passes — but `a[href="/en/accounts"]` matches
nothing, and a selector scoped loosely enough to match the *toggle* instead
of the link will hang. Reported by the hygiene step, never failed.

**Mobile is a different interaction model, not a restyle.** Desktop nav items
are links. On mobile they are section toggles inside `.menu-for-mobile` (a
separate tree from the desktop `.megamenu`), reached through a hamburger, and
tapping one expands a panel rather than navigating. Before the hamburger is
opened those items are "visible" to Playwright while sitting outside the
viewport, so clicking one retries until the test times out instead of failing
fast. Segment tabs are `javascript:void(0);` toggles at this breakpoint, so
the segment check asserts the control is present *and* the header links to
the destination, rather than asserting an href that only exists on desktop.

**The same destination is authored under two schemes.** The fraud-awareness
banner links `http://www.emiratesnbd.com/fraud` on some renders and `https://`
on others — the first CI run reported one journey lost and one gained, on a
page where nothing had changed. The scheme is therefore not part of a link's
identity in the baseline. The `http://` authoring is a genuine defect in its
own right — a bank sending the customer through one unencrypted request
before the redirect — so it is reported by the hygiene step rather than
normalised away in silence.

**The same act has three labels and two destinations.** "Apply Now",
"Apply now" and "Open Account" all mean apply, and the last routes to
`/en/campaigns/open-account` while the others go to
`/en/campaigns/account-opening`. A third entry point,
`/ENBD/Applications/...`, appears on some detail pages.

## Known live findings

**A 404 in the footer, quarantined.** The "businessONLINE learning guide"
link → `https://businessonline.emiratesnbd.com/demo/index.html` returns 404.
Confirmed outside Playwright with a plain browser-shaped request, so the page
is genuinely gone. It is listed in `knownBrokenLinks` (`fixtures/testData.ts`)
so the suite still fails on *new* breakage rather than sitting permanently
red. Re-check with `npm run test:links`.

**Five savings cards carry no apply CTA.** Tiered Savings, Currency Passport
Savings, Shake N Save, Smart S@ver and Manchester United Savings show only
"Know more" on the listing. This is **reported, not failed**: every one of
those detail pages returns 200 and offers an apply CTA, so the customer
reaches an application in one more click. It is a listing inconsistency, not
a dead end — failing on it would report a defect that does not exist.

**An `http://` self-link on the home page.** See the scheme note above. It
resolves, because the host redirects to https, so it is reported rather than
failed — but on a bank site it is worth fixing at the source.

## The link baseline

Resolving every link proves nothing is broken. It cannot prove nothing has
gone *missing*: a page that loses half its navigation still passes a pure
link check, because everything left over resolves perfectly. So
`fixtures/home-links.baseline.json` holds a committed snapshot of the link
set, and a link present at baseline and absent now fails the run. New links
are reported, never failed.

Accept new links deliberately:

```bash
npm run baseline:update
```

Note that an update run **short-circuits the assertions** — its green result
is not a validation. Always follow it with a normal `npm test`.

One baseline serves both projects: the header renders its desktop and mobile
markup into the same document, so the anchor set does not depend on viewport.

## CI and AWS

`.github/workflows/playwright.yml` runs on push, PR, a 3-day schedule, and
manual dispatch, then publishes the HTML report to S3 over OIDC.

**This repo needs its own IAM role.** Sharing one across repos means
bootstrapping the second repo silently repoints the first repo's trust policy
and breaks its CI. `scripts/setup-aws-reports.sh` derives the role name from
the repo (`emiratesnbd-web-framework-report-publisher`) so this cannot happen
by accident.

```bash
# create and push the repo FIRST — the script reads its numeric IDs from
# the GitHub API and refuses to continue without them
gh repo create Miss-Kay/emiratesnbd-web-framework --public --source=. --push

./scripts/setup-aws-reports.sh emiratesnbd-suite-reports eu-west-1 Miss-Kay/emiratesnbd-web-framework
```

Then wire the outputs it prints (`AWS_ROLE_ARN` secret, `AWS_REGION` and
`REPORT_BUCKET` variables) into the repo.

**Done, 2026-09-10.** Bucket `emiratesnbd-suite-reports` in `eu-west-1`, role
`emiratesnbd-web-framework-report-publisher`, all three repo settings in place.
Verified end to end: a `workflow_dispatch` run executed 6 tests in 3.1m and
published its report, so the OIDC assume-role works. Reports are at

    http://emiratesnbd-suite-reports.s3-website.eu-west-1.amazonaws.com/reports/latest/index.html

Note that `miss-kay-emirates-funnel-reports` is **FlySafair's** bucket despite
the name — nothing here writes to it.

The script trusts **both** OIDC subject forms — the classic
`repo:owner/name:*` and this account's immutable
`repo:owner@<id>/name@<id>:*` — because a policy matching only the classic
form fails with an opaque `sts:AssumeRoleWithWebIdentity` error.

## Cloudflare

The site sits behind Cloudflare. A residential IP is served the real page; a
datacenter IP (every CI runner) is a different conversation. `BasePage`
detects the interstitial and **skips** rather than reporting a false
regression, so a challenged run is visibly skipped instead of quietly red.
If CI is challenged persistently, point `BASE_URL` at a staging environment.

## Layout

```
fixtures/siteProfile.ts   every site-specific value; nothing in utils/ names this bank
fixtures/testData.ts      journey matrix, client segments, quarantined links
pages/BasePage.ts         consent, language modal, checkpoints, followLink, bot-block
pages/HomePage.ts         segment bar + product nav, both breakpoints
pages/PillarPage.ts       category links on a pillar page
pages/ProductListingPage.ts  product cards (two different card components)
pages/ProductDetailPage.ts   the hard stop before an application
pages/LinkScanPage.ts     link collection, baseline diff, hygiene
utils/linkChecker.ts      verdict rules — why "not 200" is not "broken"
utils/linkBaseline.ts     snapshot, diff, report
utils/selfHealing.ts      ordered locator fallbacks; a heal is logged as a warning
```
