#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# One-time AWS bootstrap for CI report publishing.
#
# Creates:
#   1. An S3 bucket with static-website hosting + public read (reports only)
#   2. The GitHub OIDC identity provider (skipped if it already exists)
#   3. An IAM role GitHub Actions can assume, scoped to one repo, with
#      write access to the report bucket only
#
# Requires: aws CLI v2, credentials with IAM + S3 admin rights.
#
# Usage:
#   ./scripts/setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>
# Example:
#   ./scripts/setup-aws-reports.sh standardbank-suite-reports eu-west-1 Miss-Kay/standardbank-web-framework
# ---------------------------------------------------------------------------

BUCKET=${1:?usage: setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>}
REGION=${2:?usage: setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>}
REPO=${3:?usage: setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>}
# Derive the role name from the repo so two projects in the same AWS account
# never share one role. They used to: a shared "playwright-report-publisher"
# meant running this script for a second repo silently repointed the first
# repo's trust policy and bucket grant at the new project, breaking its CI.
ROLE_NAME=${ROLE_NAME:-$(basename "$REPO")-report-publisher}

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account: $ACCOUNT_ID | Bucket: $BUCKET | Region: $REGION | Repo: $REPO"

# --- 1. Report bucket with static website hosting --------------------------
# Idempotent: the script is meant to be safe to re-run, and it will be re-run,
# because a later step can fail (a missing GitHub repo stops the role step) and
# leave the bucket already made. Under `set -e` an unconditional create-bucket
# aborts the whole script with BucketAlreadyOwnedByYou on the second attempt —
# so the retry fails before reaching the step that failed last time.
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "Bucket $BUCKET already exists — skipping creation"
elif [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

aws s3 website "s3://$BUCKET" --index-document index.html

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadReports",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/*"
  }]
}
JSON
)"

# --- 2. GitHub OIDC identity provider (idempotent) --------------------------
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com >/dev/null 2>&1 \
  && echo "OIDC provider created" \
  || echo "OIDC provider already exists — skipping"

# --- 3. IAM role assumable only by Actions runs of this repo ----------------
# GitHub can issue OIDC tokens with an "immutable" subject that embeds the
# numeric owner and repo IDs:
#   repo:owner@86423962/repo@1358460147:ref:refs/heads/main
# instead of the classic:
#   repo:owner/repo:ref:refs/heads/main
# The setting is account-wide and can be switched on after a role is created,
# which silently breaks every trust policy that only matches the classic form
# — the failure is an opaque "Not authorized to perform
# sts:AssumeRoleWithWebIdentity". We trust BOTH forms so either setting works.
# Read a numeric ID from the GitHub API, or fail.
#
# The validation is not paranoia. `gh api` writes its error BODY to stdout and
# exits non-zero, so on a repo that does not exist yet this returns
#   {"message":"Not Found","documentation_url":"...","status":"404"}
# and `$(gh api ... 2>/dev/null || echo "")` captures that JSON as the "ID" —
# 2>/dev/null only hides stderr, and the || branch appends to the output rather
# than replacing it. Splicing that into the trust policy produced an opaque
#   MalformedPolicyDocument: This policy contains invalid Json
# from CreateRole. Requiring digits makes the failure impossible.
lookup_numeric_id() {
  local out
  out=$(gh api "repos/$1" --jq "$2" 2>/dev/null) || return 1
  case "$out" in
    '' | *[!0-9]*) return 1 ;;
  esac
  printf '%s' "$out"
}

SUBS="\"repo:$REPO:*\""
if ! command -v gh >/dev/null 2>&1; then
  echo "WARNING: gh not found — trusting only the classic OIDC subject form." >&2
  echo "If this account uses immutable OIDC subject IDs, CI will fail to assume" >&2
  echo "the role. Install gh and re-run, or add the numeric form by hand." >&2
elif REPO_ID=$(lookup_numeric_id "$REPO" .id) \
  && OWNER_ID=$(lookup_numeric_id "$REPO" .owner.id); then
  OWNER=${REPO%%/*}
  NAME=${REPO##*/}
  SUBS="$SUBS, \"repo:$OWNER@$OWNER_ID/$NAME@$REPO_ID:*\""
  echo "Trusting both classic and immutable OIDC subjects for $REPO"
  echo "  owner id $OWNER_ID, repo id $REPO_ID"
else
  echo "ERROR: could not read numeric IDs for $REPO." >&2
  echo "" >&2
  echo "Most often this means the repository does not exist on GitHub yet —" >&2
  echo "create and push it first, then re-run this script:" >&2
  echo "  gh repo create $REPO --public --source=. --push" >&2
  echo "" >&2
  echo "It can also mean gh is not authenticated (check: gh auth status)." >&2
  echo "" >&2
  echo "Refusing to continue: this account sends immutable OIDC subject IDs, so" >&2
  echo "a role trusting only the classic form would fail at assume time with an" >&2
  echo "opaque 'Not authorized to perform sts:AssumeRoleWithWebIdentity'." >&2
  echo "Set ALLOW_CLASSIC_SUBJECT_ONLY=1 to proceed anyway." >&2
  [ "${ALLOW_CLASSIC_SUBJECT_ONLY:-}" = "1" ] || exit 1
  echo "ALLOW_CLASSIC_SUBJECT_ONLY=1 set — continuing with the classic form only." >&2
fi

TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": [ $SUBS ] }
    }
  }]
}
JSON
)

# Validate before handing it to AWS. CreateRole reports only
# "This policy contains invalid Json" with no indication of what or where.
if command -v python3 >/dev/null 2>&1; then
  if ! printf '%s' "$TRUST" | python3 -m json.tool >/dev/null 2>&1; then
    echo "ERROR: the generated trust policy is not valid JSON:" >&2
    printf '%s\n' "$TRUST" >&2
    exit 1
  fi
fi

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  # Refuse to repoint a role that belongs to a different repository.
  EXISTING_SUB=$(aws iam get-role --role-name "$ROLE_NAME" \
    --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringLike."token.actions.githubusercontent.com:sub"' \
    --output text 2>/dev/null || echo "")
  if [ -n "$EXISTING_SUB" ] && [ "$EXISTING_SUB" != "None" ] && ! echo "$EXISTING_SUB" | grep -q "repo:$REPO:\*"; then
    echo "ERROR: role $ROLE_NAME is already trusted by $EXISTING_SUB, not repo:$REPO:*." >&2
    echo "Refusing to repoint it — that would break the other repo's CI." >&2
    echo "Re-run with a different name, e.g. ROLE_NAME=my-role $0 $BUCKET $REGION $REPO" >&2
    exit 1
  fi
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST"
  echo "Role $ROLE_NAME already existed for this repo — trust policy refreshed"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST" >/dev/null
  echo "Role $ROLE_NAME created"
fi

aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name s3-report-sync \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::$BUCKET/reports/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::$BUCKET"
    }
  ]
}
JSON
)"

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)

cat <<EOF

Done. Now wire GitHub to AWS (from the repo directory):

  gh secret set AWS_ROLE_ARN  --body "$ROLE_ARN"
  gh variable set AWS_REGION    --body "$REGION"
  gh variable set REPORT_BUCKET --body "$BUCKET"

Reports will publish to:
  http://$BUCKET.s3-website.$REGION.amazonaws.com/reports/<run-number>/index.html
EOF
