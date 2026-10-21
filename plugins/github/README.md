# bb-plugin-github

GitHub issues and pull requests inside BB, with one-click agent dispatch.

Install it from the BB Official catalog:

```sh
bb plugin install github
```

## What it does

- **Sidebar panel** (GitHub logo, full width) opens on the pull request
  inbox. Its views are Inbox (what needs you), Mine, All, Merged, and Issues;
  switch with the tab bar, `[` and `]`, or ← and →. The panel's badge counts
  the pull requests that need you.
- **Pull request inbox**: pull requests are grouped by what each needs next —
  Your move (your review is requested, an agent asked you something, or
  changes were requested on yours), Ready to merge, Needs fixing (conflicts,
  failing checks, changes requested), In progress (checks running, merge
  queue, an agent at work), Waiting for review, Open, Drafts, Snoozed — with
  one status glyph and the reason on a second line, such as
  `#12 · 2 checks failing` or `#14 · 3 checks passed · stacked on #12`.
  Hovering a row shows its next action (answer the agent, open its thread,
  merge, fix or resolve with an agent, start an agent) and a menu to change
  the status, snooze, copy the branch, or open it on GitHub. Space peeks at a
  row's failing checks and agent without opening it.
- **Display menu** (⇧V): group by next step, author, or not at all;
  comfortable or compact rows; which facts show on a row (author, checks,
  stack, issue key, diff size). Choices persist per browser.
- **Filter** (`/`): free text plus qualifiers (`is:`, `ci:`, `author:`,
  `assignee:`, `label:`, `base:`, `stack:`, `agent:`, `repo:`), with
  suggestions as you type. Each token shows as a removable chip beside the
  number of matching pull requests.
- **Keyboard**: `j`/`k` or ↑/↓ move, Enter opens, `x` selects, and `a`
  (agent), `m` (merge), `r` (ready), `s` (status), `z` (snooze), `t` (agent
  thread), `c` (copy branch), and `o` (open on GitHub) act on the focused row
  or the open pull request. Esc steps back one level; `?` lists every
  shortcut.
- **Bulk actions**: selected rows can start agents, be marked ready, or be
  snoozed together. A group's Merge all merges each ready pull request after a
  confirmation.
- **Snooze**: until the checks change, a new push, the linked agent replies,
  tomorrow at 8:00, or next Monday at 8:00. Merging or closing wakes it.
- **Pull request detail**: beside the list on a wide panel, full width on a
  narrow one. The header carries the status menu (Draft, Open, Closed where
  GitHub's `viewerCanUpdate`, `viewerCanClose`, and `viewerCanReopen` allow
  it, plus Merge…), the author, a copy chip for the head branch, and the diff
  stat. Closing takes a second press; the pill spins while GitHub answers and
  keeps focus; Undo is offered when it restores the exact state, and a
  failure says why and reloads. The diff stat uses core's
  `text-diff-added`/`text-diff-removed` colours and five-block size bar,
  breaks the change into code, tests, docs, and generated files on hover
  (files GitHub does not list count as Not listed), and opens the Files tab.
- **Next step card**: one card says what the pull request needs now and
  offers the action: merge, fix the failing checks with an agent or re-run
  them, resolve conflicts, mark a draft ready, review it, or reopen it. While
  an agent works on it the card shows its progress; when the agent asks a
  question, the card shows the question and its options, and the answer goes
  straight back to the agent. A switch follows the pull request: new CI
  results, reviews, and comments are sent to the agent's thread.
- **Tabs**: Activity tells the story (commits grouped by author, CI, reviews,
  review threads, comments, Linear links) and ends in a reply box that posts
  to GitHub or messages the agent; Files lists the files in reading order
  (code, docs, tests, generated) with their diffs and links into the bb
  worktree that holds the branch; Checks lists failed checks first, with their
  logs and Re-run failed. Stacked pull requests show their chain and offer to
  restack it with an agent.
- **Merge dialog**: the repository's allowed methods, its default first, and
  whether the head branch is deleted. A branch that a bb worktree holds, or
  that lives in a fork, is kept. When a bb environment holds the branch, the
  merge goes through bb's own merge path.
- **Start an agent**: a sheet with presets (Fix checks, Resolve conflicts,
  Review, Finish draft, Restack, Custom) and bb's new-thread composer, seeded
  with the preset's prompt and placed in the bb worktree already on the
  branch, else a new worktree from `origin/<head>`. The thread is linked to
  the pull request.
- **In threads**: a thread linked to a pull request shows it in its header
  (unless bb already does) and its next step on its sidebar row. The GitHub
  PR panel shows the same detail, or a picker when no pull request is linked.
- **Home page**: what the inbox holds (`2 your move · 1 ready · 1 need
fixing`) and its first four rows.
- **Command palette**: GitHub: Open the inbox, GitHub: Find a pull request…,
  and GitHub: Open this thread's pull request.
- **Issues view and issue detail**: open and closed issues; the detail has the
  markdown body, comments, a comment box, status, assignee, and label editing,
  plus Start an agent. Deep links: `issues/<owner>/<repo>/<number>` and
  `pulls/<owner>/<repo>/<number>` under the panel's route.
- **Mentions**: `@` or `#` in any composer completes GitHub issues and PRs; the
  selected item's title/body/state is attached as agent context at send time.
- **`bb github` CLI**: `repos`, `issues [repo]`, `prs [repo]`,
  `pr-state <repo> <number> --state open|draft|closed`,
  `merge <repo> <number> [--method squash|merge|rebase] [--delete-branch]`,
  `rerun <repo> <number>`,
  `snooze <repo> <number> --until checks|push|reply|tomorrow|monday|<ISO>`,
  `unsnooze <repo> <number>`,
  `agent <repo> <number> [--preset …] [--prompt …]`,
  `follow <repo> <number> [--thread <id>] [--off]`, and `sync` — also
  discoverable by agents through the plugin-commands skill. `prs` adds what
  each pull request needs next: a fourth tab-separated column in text, and
  `nextStep` plus a `pr` status object in `--json`. `pr-state` runs
  `gh pr ready`, `gh pr ready --undo`, `gh pr close`, or `gh pr reopen` as
  needed, reopening a closed pull request first, and refuses a merged one.
  `merge` runs `gh pr merge` with `--match-head-commit`, so a push that lands
  meanwhile stops it. A tracked repository's cache then refreshes in the
  background, also after a change that fails partway. Each command takes
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
