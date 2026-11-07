# alexandre-vl/bb

This fork carries every change of mine that is not in get-bb/bb yet, on top of
upstream, rebuilt automatically.

## Branches

| Branch | What it is | Who writes it |
| --- | --- | --- |
| `alex` (default) | upstream `main` + `fork-infra` + every branch in [`layers.txt`](layers.txt), rebuilt from scratch | Fork Sync, force-pushed |
| `main` | a mirror of get-bb/bb `main`, fast-forward only | Fork Sync |
| `fork-infra` | this directory and the `fork-*` workflows | me |
| `fork-rerere` | saved conflict resolutions (`git rerere` cache) | `fork/rerere.sh push` |
| one branch per pull request | based on `main`, opened against get-bb/bb | me |
| `carry/<branch>` | a pull request branch with `main` merged in, for a conflict rerere cannot replay (the fix belongs in a file that did not conflict); listed right before its branch in `layers.txt` | me |
| `*-assets` | screenshots for pull request bodies; `github-inbox-v3-assets` also serves GitHub Pages | me |

Never commit to `alex` or `main`: the next sync replaces `alex`, and refuses to
sync a `main` that has commits upstream lacks. Start every new branch from
`main`, never from `alex`, or its pull request drags the whole fork along.

## Workflows

- **Fork Sync** (`.github/workflows/fork-sync.yml`) runs at 00:17, 06:17,
  12:17 and 18:17 UTC, on every push to `fork-infra`, and by hand. It
  fast-forwards `main` to upstream, rebuilds `alex` with
  [`rebuild.sh`](rebuild.sh), pushes it when its tree changed, turns off
  upstream's workflows, and keeps the issue "alex rebuild needs attention" open
  while a layer is skipped.
- **Fork CI** (`.github/workflows/fork-ci.yml`) runs on every push to `alex`:
  lint, typecheck and tests of the packages the layers change, then versions
  `bb-app` as `X.Y.(Z+1)-alex.<run>.<attempt>`, smoke-tests the tarball, packs
  it and uploads it, on GitHub-hosted `ubuntu-latest`. A newer push to `alex`
  cancels the run still testing the older one.
- GitHub pauses a fork's workflows when it judges their Actions usage too
  large: on 2026-10-23, after a day of 25 Fork CI runs (384 runner minutes)
  with the sync every 30 minutes. The Actions page then shows a banner a
  maintainer can re-enable from, while the API still reports Actions enabled
  and a dispatch fails with `Actions has been disabled for this repository`.
  Keep the schedule sparse and batch pushes to `fork-infra`.
- **Fork Release** (`.github/workflows/fork-release.yml`) runs when Fork CI
  succeeds on `alex`. It publishes the tested tarball as the release
  `fork-v<version>` (`bb-app.tgz`, `version.txt`, `SHA256SUMS`, and the list
  of layers), marks it latest, and keeps the last 10. The newest build is
  always at
  `https://github.com/alexandre-vl/bb/releases/latest/download/bb-app.tgz`.
- **Fork PR Health** (`.github/workflows/fork-pr-health.yml`) runs daily at
  06:23 UTC and by hand. It rewrites the issue "Upstream pull requests" with
  each of my open pull requests on get-bb/bb: checks, merge state, review,
  whether `alex` contains it, and the day upstream's stale job closes it
  ([`pr-health.sh`](pr-health.sh)).
- Fork Sync also fast-forwards my other forks listed in
  [`forks.txt`](forks.txt) (alexandre-vl/marketplace), when `FORK_SYNC_TOKEN`
  can write to them.
- Upstream's workflows stay off on the fork: they need Blacksmith runners and
  upstream secrets, so they would sit queued forever.

## How a rebuild treats each layer

1. A branch already contained in `alex` is reported as `already included`.
2. A branch adding files under `packages/db/drizzle`, or SQL DDL anywhere else
   (a new `bb.storage.migrate` statement in a plugin), merges only after the
   `fork-migrations` layer, listed first; without it, it is held back unless
   its line in `layers.txt` ends with `allow-migrations`. See
   [Migrations](#migrations).
3. A branch is held back when one of its migrations or `bb.storage.migrate`
   statements changes or replaces one a fork release already shipped (the
   databases that ran the shipped version would never run the new one), when
   a migration drops or renames a table upstream's migrations create (bb runs
   it after upstream's newer migrations, so it would drop their columns), or
   when it adds a CREATE, ALTER or DROP string with `${...}` in a plugin, which
   the rebuild cannot list.
4. Conflicts are first replayed from `fork-rerere`; then conflicts in drizzle's
   meta files keep the side already merged, since the rebuild rewrites them
   anyway; then conflicts whose two sides differ only in version numbers take
   the higher one ([`resolve-versions.py`](resolve-versions.py)); anything
   else is skipped and reported.

## Migrations

Migrations are numbered: upstream reuses the number of a layer's migration for
its own next one, two layers can take the same number, and a layer's pull
request can merge upstream under another number. Left in drizzle's journal, a
layer's migration makes drizzle skip upstream's next one, and bb refuses to
start. The `fork-migrations` layer (branch `fork-migrations`, one commit on
upstream main) and the rebuild keep the layers' migrations out of drizzle's
way:

- The rebuild moves the migrations the layers add from drizzle's journal to
  `packages/db/drizzle/meta/_fork_journal.json`
  ([`fork-journal.py`](fork-journal.py)) and puts drizzle's meta back to
  upstream's. The layers' SQL files stay where they are.
- bb runs upstream's migrations first, then the fork journal's, and records
  these by tag in `__fork_migrations`. Drizzle's `__drizzle_migrations` only
  ever holds upstream's migrations, so an official build can open the
  database again.
- When upstream ships a migration whose SQL a fork migration already ran (a
  layer's pull request merged), bb records it without running it. A fork
  migration upstream already ran, or a renumbered one, is recorded the same
  way. A fork migration changed after it ran stops bb at start.
- When an upstream migration rebuilds a table a fork migration added a column
  or an index to, bb saves the column's values first, in
  `__fork_saved_column__<table>__<column>`, and puts the column back with
  them, and the index, before it runs any new fork migration. At each start
  it also puts back a fork column or index that is missing, unless a fork or
  upstream migration drops it.
- For plugin storage, the rebuild lists the SQL statements the layers add to
  plugin sources ([`storage-statements.py`](storage-statements.py), written to
  `packages/plugin-sdk/src/internal/fork-storage-statements.ts`).
  `bb.storage.migrate` records those at ids from 1 000 000 and upstream's at
  their upstream index, so upstream can append statements of its own, and an
  official build can open the plugin's database again.

An official build has none of this. Once a layer's migration or storage
statement has run, an official build that ships the same change, after its
pull request merged, runs it again and fails: bb does not start, or the plugin
does not load. Go back to an official build for good only after alex has run
upstream's version of each such change.

`fork-migrations` changes `packages/db/src/migrate.ts` and
`packages/plugin-sdk/src/internal/host-policy.ts`; when upstream changes them,
fix it like any skipped layer. Until it merges again, the layers with
migrations are held back.

## Fix a skipped layer

```bash
git remote add fork https://github.com/alexandre-vl/bb.git   # once, in a get-bb/bb clone
git fetch fork && git checkout fork/fork-infra -- fork      # or work in a fork-infra checkout
FORK_REMOTE=fork fork/rebuild.sh --stop-at-conflict
git -C <worktree it prints> add -A && git -C <worktree> commit --no-edit
FORK_REMOTE=fork fork/rerere.sh push
gh workflow run fork-sync.yml --repo alexandre-vl/bb
```

When the conflict is in the pull request itself, rebase the branch on `main`
instead: that also fixes the pull request upstream. When the right resolution
edits a file that did not conflict (upstream moved the code), rerere cannot
replay it: merge `main` into a `carry/<branch>` copy of the branch, resolve it
there, push it, and list it right before the branch in `layers.txt`.

## Add or drop a layer

Edit [`layers.txt`](layers.txt) on `fork-infra` and push. Order matters: put a
stacked branch's base first, or list only the top of the stack.

## The push token

Fork Sync pushes with `FORK_SYNC_TOKEN`, because the `GITHUB_TOKEN` of a
workflow may not push commits that change workflow files, and upstream changes
them all the time. Create a fine-grained token at
https://github.com/settings/personal-access-tokens/new with repository access
**Only select repositories → alexandre-vl/bb** (add alexandre-vl/marketplace to
sync it too) and permissions **Contents:
Read and write** and **Workflows: Read and write**, then:

```bash
gh secret set FORK_SYNC_TOKEN --repo alexandre-vl/bb
```

## Run alex as my bb

[`instance/adopt.sh`](instance/adopt.sh) makes the bb I already run, through
its systemd user unit, run the newest `fork-v*` release with the same data
dir, ports and account:

```bash
fork/instance/adopt.sh bb-host-daemon-alexvl-getbb-app-host_3ussyf3xqh.service --now
```

- `bb-fork-update.timer` runs [`instance/update.sh`](instance/update.sh)
  every 10 minutes. It switches only when no thread is running: it stops the
  unit, copies `bb.db` and each plugin's `data.db` to
  `~/.bb-fork-app/backups/` (keeps 3), and starts the unit again through the
  drop-in `<unit>.d/zz-alexandre-vl-fork.conf`, which runs
  `~/.bb-fork-app/current` with `--no-in-app-updates`. Once switched, it takes
  a newer release at most every 6 hours (`BB_FORK_MIN_HOURS`): upstream
  merges dozens of pull requests a day, and each switch restarts bb.
- To switch at once, running threads or not and without the 6-hour wait:
  `systemd-run --user --collect --unit=bb-fork-now -p EnvironmentFile=$HOME/.bb-fork-app/env ~/.local/bin/bb-fork-update --now`.
  It runs outside bb's unit, so stopping bb does not kill it. A thread that
  was running stops; resume it once bb answers.
- A release that does not answer within 6 minutes is marked failed and never
  retried, and the unit goes back to the build it ran before (its own install
  after a first switch). If that build does not answer either, the backup is
  restored; the databases it replaces are moved to `~/.bb-fork-app/failed/`.
- The unit's own install stays on disk. Back to it, at once, running threads
  or not: `systemctl --user start bb-fork-revert.service`, which also turns
  the timer off. Then update it from Settings: its install may be older than
  the fork's upstream base.
- `~/.local/bin/bb` runs the CLI of whichever build the unit runs. adopt.sh
  keeps the wrapper it replaced as `~/.bb-fork-app/bb-official`; copy it back
  to undo that.
- Machines enrolled in this bb update their daemon from it, so they run the
  fork's build too.
- The layers' migrations run from the fork journal, outside drizzle's ledger,
  so an official build can open the database again: it ignores
  `__fork_migrations` and the fork's tables and columns (nightly
  0.46.2-nightly.39620384282.1 reopened a database the fork build had
  migrated, before the layers had any).
- Logs: `journalctl --user -u bb-fork-update -u bb-fork-revert`.

## A second bb beside it: bb-alex

bb-alex is a separate bb on a Linux machine, beside the official one, with its
own empty data dir, that runs the newest `fork-v*` release:

```bash
fork/instance/install.sh
```

- Data in `~/.bb-alex`, server on `127.0.0.1:48886`, daemon on `48887`,
  in-app updates off, so it can never install an official `bb-app`.
- `bb-alex-update.timer` runs [`instance/update.sh`](instance/update.sh) every
  30 minutes, the same way as above, with its backups in `~/.bb-alex/backups/`
  (keeps 10).
- `bb-alex <command>` (in `~/.local/bin`) is the CLI for this instance; it
  drops the official instance's `BB_*` variables.
- Its getbb.app sign-in request carries the machine's hostname, the same as
  the official bb's, and the page can preselect "Replace <my address>":
  approving that moves my address to bb-alex and signs the official bb out.
  Choose **New server**, or leave bb-alex signed out.
- Logs: `journalctl --user -u bb-alex -u bb-alex-update`. Stop it for good:
  `systemctl --user disable --now bb-alex.service bb-alex-update.timer`
  (the data stays).

Never open `~/.bb-alex` with an official bb, never point an official build at
it, and never seed it with `bb server import` from the official instance: a
copy carries the official account and takes over or revokes its address.
