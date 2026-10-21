#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: fork/pr-health.sh <author> [report file]

Writes a Markdown report of the author's open pull requests on get-bb/bb:
checks, merge state, review, whether alex contains the head commit, and when
upstream's 14-day stale-PR job closes it.

Environment: FORK_UPSTREAM_REPO (get-bb/bb), FORK_ALEX_REF (origin/alex).
USAGE
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

author=$1
report=${2:-pr-health.md}
upstream=${FORK_UPSTREAM_REPO:-get-bb/bb}
alex_ref=${FORK_ALEX_REF:-origin/alex}

gh pr list --repo "$upstream" --author "$author" --state open --limit 100 \
  --json number,title,url,headRefName,headRefOid,isDraft,mergeable,reviewDecision,createdAt,additions,deletions,statusCheckRollup >"$report.json"

python3 - "$report.json" "$alex_ref" "$report" <<'PY'
import datetime
import json
import subprocess
import sys

prs = json.load(open(sys.argv[1]))
alex_ref = sys.argv[2]

now = datetime.datetime.now(datetime.timezone.utc)


def close_date(created):
    eligible = datetime.datetime.fromisoformat(created.replace("Z", "+00:00")) + datetime.timedelta(days=14)
    run = eligible.replace(hour=4, minute=0, second=0, microsecond=0)
    if run <= eligible:
        run += datetime.timedelta(days=1)
    return run


def checks(rollup):
    states = []
    for check in rollup or []:
        states.append((check.get("conclusion") or check.get("state") or check.get("status") or "").upper())
    if any(state in ("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE") for state in states):
        return "❌ failing"
    if any(state in ("PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED") for state in states):
        return "⏳ running"
    if states:
        return "✅ passing"
    return "· none"


rows = []
for pr in sorted(prs, key=lambda item: item["createdAt"]):
    closes = close_date(pr["createdAt"])
    days_left = (closes - now).days
    contained = subprocess.run(["git", "merge-base", "--is-ancestor", pr["headRefOid"], alex_ref], capture_output=True).returncode
    carried = {0: "✅ yes", 1: "· no"}.get(contained, "· unknown")
    merge = {"MERGEABLE": "✅ clean", "CONFLICTING": "❌ conflicts"}.get(pr["mergeable"], "· " + pr["mergeable"].lower())
    review = {"APPROVED": "✅ approved", "CHANGES_REQUESTED": "❌ changes requested", "REVIEW_REQUIRED": "· waiting"}.get(pr["reviewDecision"] or "", "· none")
    urgency = "⚠ " if days_left <= 3 else ""
    title = pr["title"].replace("|", "\\|")
    rows.append(
        f"| [#{pr['number']}]({pr['url']}) | {title}{' (draft)' if pr['isDraft'] else ''} | +{pr['additions']}/−{pr['deletions']} "
        f"| {checks(pr['statusCheckRollup'])} | {merge} | {review} | {carried} | {urgency}{closes:%b %d} |"
    )

with open(sys.argv[3], "w") as out:
    out.write(f"## Open pull requests on get-bb/bb\n\n{len(prs)} open, updated {now:%Y-%m-%d %H:%M} UTC. ")
    out.write("Upstream closes a pull request 14 days after it opens unless a maintainer labels it `dont-close`.\n\n")
    out.write("| PR | Title | Size | Checks | Merge | Review | In alex | Auto-close |\n")
    out.write("| --- | --- | --- | --- | --- | --- | --- | --- |\n")
    out.write("\n".join(rows) + "\n")
PY
rm -f "$report.json"
cat "$report"
