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

- **Fork Sync** (`.github/workflows/fork-sync.yml`) runs at :17 and :47 every
  hour, on every push to `fork-infra`, and by hand. It fast-forwards `main` to
  upstream, rebuilds `alex` with [`rebuild.sh`](rebuild.sh), pushes it when its
  tree changed, turns off upstream's workflows, and keeps the issue
  "alex rebuild needs attention" open while a layer is skipped.
- **Fork CI** (`.github/workflows/fork-ci.yml`) runs on every push to `alex`:
  lint, typecheck and tests of the packages the layers change, then versions
  `bb-app` as `X.Y.(Z+1)-alex.<run>.<attempt>`, smoke-tests the tarball, packs
  it and uploads it, on GitHub-hosted `ubuntu-latest`. Runs queue; none is
  cancelled.
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
   (a new `bb.storage.migrate` statement in a plugin), is held back unless its
   line in `layers.txt` ends with `allow-migrations`. Both kinds are numbered:
   upstream reuses the number for its own next migration, and bb then refuses
   to start (`packages/db/src/migrate.ts`) or to load the plugin
   (`bb.storage.migrate` rejects a reused index). A build carrying unmerged
   migrations must never touch a data directory an official bb also opens.
3. Conflicts are first replayed from `fork-rerere`; then conflicts whose two
   sides differ only in version numbers take the higher one
   ([`resolve-versions.py`](resolve-versions.py)); anything else is skipped and
   reported.

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

## Run alex as my bb: bb-alex

bb-alex is a second bb on a Linux machine, beside the official one, that runs
the newest `fork-v*` release. Install or refresh it with:

```bash
fork/instance/install.sh
```

- Data in `~/.bb-alex`, server on `127.0.0.1:48886`, daemon on `48887`,
  in-app updates off, so it can never install an official `bb-app`.
- `bb-alex-update.timer` runs [`instance/update.sh`](instance/update.sh) every
  30 minutes. It installs a new release only when no thread is running,
  copies every SQLite file of the data dir to `~/.bb-alex/backups/` first
  (keeps 10), switches `~/.bb-alex-app/current`, and waits for the new version
  to answer. A release that does not come up is rolled back and never retried;
  bb-alex then stays stopped until its backup is restored.
- `bb-alex <command>` (in `~/.local/bin`) is the CLI for this instance; it drops the official instance's `BB_*` variables. Sign it in once with
  `bb-alex account login` to get its own getbb.app address
  (`bb-alex connect servers` lists it).
- Logs: `journalctl --user -u bb-alex -u bb-alex-update`. Stop it for good:
  `systemctl --user disable --now bb-alex.service bb-alex-update.timer`
  (the data stays).

Never open `~/.bb-alex` with an official bb, never point an official build at
it, and never seed it with `bb server import` from the official instance: a
copy carries the official account and takes over or revokes its address.
