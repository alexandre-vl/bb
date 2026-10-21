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
  lint, typecheck and tests of the packages the layers change, and a smoke test
  of the `bb-app` tarball, on GitHub-hosted `ubuntu-latest`.
- Upstream's workflows stay off on the fork: they need Blacksmith runners and
  upstream secrets, so they would sit queued forever.

## How a rebuild treats each layer

1. A branch already contained in `alex` is reported as `already included`.
2. A branch adding files under `packages/db/drizzle` is held back unless its
   line in `layers.txt` ends with `allow-migrations`. A build carrying unmerged
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
instead: that also fixes the pull request upstream.

## Add or drop a layer

Edit [`layers.txt`](layers.txt) on `fork-infra` and push. Order matters: put a
stacked branch's base first, or list only the top of the stack.

## The push token

Fork Sync pushes with `FORK_SYNC_TOKEN`, because the `GITHUB_TOKEN` of a
workflow may not push commits that change workflow files, and upstream changes
them all the time. Create a fine-grained token at
https://github.com/settings/personal-access-tokens/new with repository access
**Only select repositories → alexandre-vl/bb** and permissions **Contents:
Read and write** and **Workflows: Read and write**, then:

```bash
gh secret set FORK_SYNC_TOKEN --repo alexandre-vl/bb
```
