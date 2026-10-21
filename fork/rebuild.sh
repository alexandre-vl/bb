#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: fork/rebuild.sh [--push] [--stop-at-conflict] [--layers <file>]

Rebuilds the fork's integration branch from upstream main, the fork-infra
branch and every branch listed in fork/layers.txt, in order.

  --push              Fast-forward the fork's main to upstream main, and push
                      the rebuilt integration branch when its tree changed.
  --stop-at-conflict  Stop at the first conflict rerere cannot resolve and
                      leave it in the build worktree for you to resolve.
  --layers <file>     Read the layer list from <file>.

A layer line is a branch name on the fork, optionally followed by
allow-migrations. A layer that adds files under packages/db/drizzle, or SQL
DDL such as a new bb.storage.migrate statement, is held back unless its line
says allow-migrations.

The result is also kept locally as refs/fork/<target>.

Environment: FORK_REMOTE (origin), FORK_UPSTREAM_URL
(https://github.com/get-bb/bb.git), FORK_TARGET (alex), FORK_INFRA_REF
(<remote>/fork-infra), FORK_RERERE_BRANCH (fork-rerere), FORK_REPORT
(./fork-report.md).
USAGE
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
layers_file=$script_dir/layers.txt
push=0
stop_at_conflict=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --push) push=1 ;;
    --stop-at-conflict) stop_at_conflict=1 ;;
    --layers) layers_file=$2; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

remote=${FORK_REMOTE:-origin}
upstream_url=${FORK_UPSTREAM_URL:-https://github.com/get-bb/bb.git}
target=${FORK_TARGET:-alex}
rerere_branch=${FORK_RERERE_BRANCH:-fork-rerere}
report=${FORK_REPORT:-$PWD/fork-report.md}
migrations_path=packages/db/drizzle

if [[ ! -f $layers_file ]]; then
  echo "No layer list at $layers_file" >&2
  exit 2
fi

git fetch --quiet --no-tags "$upstream_url" "+refs/heads/main:refs/fork/upstream-main"
git fetch --quiet --no-tags --prune "$remote" "+refs/heads/*:refs/remotes/$remote/*"
upstream=$(git rev-parse refs/fork/upstream-main)
infra=$(git rev-parse --verify "${FORK_INFRA_REF:-refs/remotes/$remote/fork-infra}^{commit}")

if [[ $push == 1 ]]; then
  fork_main=$(git rev-parse --verify --quiet "refs/remotes/$remote/main" || true)
  if [[ -n $fork_main ]] && ! git merge-base --is-ancestor "$fork_main" "$upstream"; then
    echo "$remote/main has commits that upstream main lacks, so it was not synced." >&2
    exit 1
  fi
  if [[ $fork_main != "$upstream" ]]; then
    git push --quiet "$remote" "$upstream:refs/heads/main"
  fi
fi

common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
git config rerere.enabled true
git config rerere.autoUpdate true
rerere_ref=refs/remotes/$remote/$rerere_branch
if git rev-parse --verify --quiet "$rerere_ref" >/dev/null && [[ -n $(git ls-tree --name-only "$rerere_ref" rr-cache) ]]; then
  git archive "$rerere_ref" rr-cache | tar -x -C "$common_dir"
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/fork-$target.XXXXXX")
keep_work=0
cleanup() {
  if [[ $keep_work == 0 ]]; then
    git worktree remove --force "$work"
  fi
}
git worktree add --quiet --detach "$work" "$upstream"
trap cleanup EXIT

if ! git -C "$work" merge --quiet --no-ff --no-edit -m "Merge fork-infra into $target" "$infra" >/dev/null; then
  echo "fork-infra does not merge cleanly into upstream main." >&2
  exit 1
fi

rows=()
skipped=0
held=0
while read -r branch options || [[ -n ${branch:-} ]]; do
  if [[ -z ${branch:-} ]]; then
    continue
  fi
  if ! sha=$(git rev-parse --verify --quiet "refs/remotes/$remote/$branch^{commit}"); then
    rows+=("| \`$branch\` | | missing on $remote |")
    skipped=$((skipped + 1))
    continue
  fi
  short=$(git rev-parse --short "$sha")
  if git -C "$work" merge-base --is-ancestor "$sha" HEAD; then
    rows+=("| \`$branch\` | $short | already included |")
    continue
  fi
  if [[ ${options:-} != *allow-migrations* ]]; then
    if [[ -n $(git diff --name-only "$upstream...$sha" -- "$migrations_path") ]]; then
      rows+=("| \`$branch\` | $short | held back: adds database migrations |")
      held=$((held + 1))
      continue
    fi
    ddl=$(git diff --unified=0 "$upstream...$sha" -- . ":(exclude)$migrations_path" ':(glob,exclude)**/__tests__/**' ':(glob,exclude)**/*.test.*' ':(glob,exclude)**/*.md' |
      grep -m1 -oE "^\+[^+].*[\`\"'] *(CREATE|ALTER|DROP) +(TABLE|(UNIQUE +)?INDEX|VIEW|TRIGGER)" || true)
    if [[ -n $ddl ]]; then
      rows+=("| \`$branch\` | $short | held back: adds storage statements |")
      held=$((held + 1))
      continue
    fi
  fi
  if git -C "$work" -c merge.conflictStyle=diff3 merge --quiet --no-ff --no-edit -m "Merge $branch into $target" "$sha" >/dev/null 2>&1; then
    rows+=("| \`$branch\` | $short | merged |")
  elif git -C "$work" rev-parse --verify --quiet MERGE_HEAD >/dev/null && [[ -z $(git -C "$work" ls-files -u) ]]; then
    git -C "$work" commit --quiet --no-edit
    rows+=("| \`$branch\` | $short | merged with a recorded resolution |")
  elif mapfile -t conflicted < <(git -C "$work" diff --name-only --diff-filter=U) &&
    (cd "$work" && python3 "$script_dir/resolve-versions.py" "${conflicted[@]}" 2>/dev/null); then
    git -C "$work" add -- "${conflicted[@]}"
    git -C "$work" commit --quiet --no-edit
    rows+=("| \`$branch\` | $short | merged, version bumps resolved to the higher one |")
  else
    files=$(git -C "$work" diff --name-only --diff-filter=U | paste -sd, - | sed 's/,/, /g')
    if [[ $stop_at_conflict == 1 ]]; then
      keep_work=1
      cat >&2 <<EOF
Merging $branch conflicts in: $files
Resolve it in $work, then:
  git -C $work add -A && git -C $work commit --no-edit
  fork/rerere.sh push
and run fork/rebuild.sh again.
EOF
      exit 1
    fi
    git -C "$work" merge --abort
    rows+=("| \`$branch\` | $short | skipped: conflicts in $files |")
    skipped=$((skipped + 1))
  fi
done <"$layers_file"

git update-ref "refs/fork/$target" "$(git -C "$work" rev-parse HEAD)"
new_tree=$(git -C "$work" rev-parse 'HEAD^{tree}')
old=$(git rev-parse --verify --quiet "refs/remotes/$remote/$target" || true)
state=unchanged
if [[ -z $old || $(git rev-parse "$old^{tree}") != "$new_tree" ]]; then
  state=changed
  if [[ $push == 1 ]]; then
    git -C "$work" push --quiet --force-with-lease="refs/heads/$target:$old" "$remote" "HEAD:refs/heads/$target"
    state=pushed
  fi
fi

{
  echo "## $target rebuild"
  echo
  echo "Upstream main \`$(git rev-parse --short "$upstream")\` · $target $state · $skipped skipped · $held held back"
  echo
  echo "| Layer | Commit | Result |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} >"$report"
if [[ -n ${GITHUB_OUTPUT:-} ]]; then
  {
    echo "skipped=$skipped"
    echo "held=$held"
    echo "state=$state"
  } >>"$GITHUB_OUTPUT"
fi
cat "$report"
