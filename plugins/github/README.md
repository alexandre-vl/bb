# bb-plugin-github

GitHub issues and pull requests inside BB, with one-click agent dispatch.

Install it from the BB Official catalog:

```sh
bb plugin install github
```

## What it does

- **Sidebar panel** (GitHub logo, full width): Issues and Pull requests tabs
  across every tracked repo, with a repo filter (persisted in localStorage)
  and a New issue form.
- **Pull request inbox**: pull requests are grouped by what each needs next —
  Your move (your review is requested, or changes were requested on yours),
  Ready to merge, Needs fixing (conflicts, failing checks, changes requested),
  In progress (checks running, merge queue), Waiting for review, Open, Drafts —
  with one status glyph and the reason on a second line, such as
  `#12 · 2 checks failing · draft` or `#14 · 3 checks passed · stacked on #12`.
- **Pull request header**: the status pill is a menu. It offers Draft, Open
  (ready for review), and Closed only where GitHub's `viewerCanUpdate`,
  `viewerCanClose`, and `viewerCanReopen` allow it, read with one extra
  GraphQL request when the detail opens. A closed draft reopens as a draft;
  marking it ready as well needs `viewerCanUpdate`. Closing takes a second
  press. The pill spins while GitHub answers and stays focused, the success
  toast offers Undo when undoing restores the exact state, and a failure says
  why and reloads the pull request. Merged pull requests, and those you cannot
  change, keep a plain pill. The diff stat uses core's
  `text-diff-added`/`text-diff-removed` colours and its five-block size bar,
  splits the change into code, tests, docs, and generated files on hover and
  above the file list (files GitHub does not list count as Not listed), and
  scrolls to the files on click. The head branch is a copy chip.
- **Issue detail**: markdown body, comments, comment box, status,
  assignee, and label editing, plus "Send agent".
  Deep-linkable via the URL hash: `#/issues/<owner>/<repo>/<number>`.
- **Send agent / Review with agent**: spawns a BB worker thread on the issue
  (or a review thread on the PR) in the repo's BB project. The issue/PR then
  shows a ⚡ pill linking to the thread.
- **Homepage section**: recent open issues with the same Send agent buttons.
- **Mentions**: `@` or `#` in any composer completes GitHub issues and PRs; the
  selected item's title/body/state is attached as agent context at send time.
- **`bb github` CLI**: `repos`, `issues [repo]`, `prs [repo]`,
  `pr-state <repo> <number> --state open|draft|closed`, `sync` — also
  discoverable by agents through the plugin-commands skill. `prs` adds what
  each pull request needs next: a fourth tab-separated column in text, and
  `nextStep` plus a `pr` status object in `--json`. `pr-state` runs
  `gh pr ready`, `gh pr ready --undo`, `gh pr close`, or `gh pr reopen` as
  needed, reopening a closed pull request first, and refuses a merged one.
  A tracked repository's cache then refreshes in the background, also after
  a change that fails partway. Each command takes
  `--json` (`{"ok":true,…}` on success, `{"ok":false,"error":{…}}` on failure)
  and `--help`, which prints its arguments and options and exits 0.

## Auth

Uses the GitHub CLI. If `gh auth status` passes, the plugin works; otherwise
it reports needs-configuration. No tokens are stored by the plugin.

## Which repos are tracked

- Every BB project source whose checkout has a GitHub `origin` remote
  (repo → project mapping is also how spawn picks the project).
- Plus the `extraRepos` setting: comma-separated `owner/repo` list. Entries that
  are not `owner/repo` — a `owner/*` wildcard, a bare owner, a typo — are not
  tracked; `bb github repos` names them on stderr and the plugin log warns once
  per distinct set. Wildcards are not supported.
- `defaultProject` setting: where threads spawn for repos with no project.

```
bb plugin config github set extraRepos "owner/repo, owner/other"
bb plugin reload github
```

A background service refreshes immediately on startup, then waits 15 minutes
after each completed sync. Each tracked repository uses one bounded `gh api graphql`
request per sweep, using the existing GitHub CLI authentication. It fetches
100 open and 50 closed issues, plus 50 open and 30 closed or merged PRs,
ordered by creation time descending. Labels and assignees are each limited to
100 per item, matching the previous list commands. Open PRs also carry their
draft state, head and base branches, mergeability, review decision and
requested reviewers, merge-queue state, and check counts by state
(`checkRunCountsByState`, `statusContextCountsByState`); on get-bb/bb that
raises the request from 5 to 6 GraphQL points. `mergeStateStatus` is left to
the pull request detail because it slows the list request several-fold. Repositories with Issues
disabled still sync PRs. Failed or incomplete repository responses retain that
repository’s cached rows.

Batching reduces list-fetch process invocations from four to one per repository
(75%). This does not measure GraphQL rate-limit point savings.
Background data may take 15 minutes plus sync time to refresh. The panel's
Refresh button, the `refresh` RPC, or `bb github sync` starts a sync immediately.

Transient authentication failures and failures across all repositories retain
the existing retry backoff: 30 seconds, doubling to a five-minute cap, reset
after a successful sync. Partial repository failures use the normal interval.
The interval is internal policy; there is no polling setting.

## Development

Run the checks from the repository root:

```sh
pnpm exec turbo run typecheck test --filter=bb-plugin-github
```
