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
allow-migrations.

A layer that adds files under packages/db/drizzle, or SQL DDL such as a new
bb.storage.migrate statement, merges only after a layer that brings
packages/db/src/fork-migrations.ts (fork-migrations, listed first). The
rebuild then moves the migrations the layers add from drizzle's journal to
packages/db/drizzle/meta/_fork_journal.json and puts drizzle's meta back to
upstream's: bb runs the fork journal's migrations after upstream's and records
them in __fork_migrations, never in drizzle's ledger. Conflicts in drizzle's
meta files resolve to the side already merged. A layer that changes a
migration a fork release already shipped is held back. allow-migrations
merges a layer without the fork-migrations layer before it.

The result is also kept locally as refs/fork-rebuild/<target>.

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
journal=$migrations_path/meta/_journal.json
fork_journal=$migrations_path/meta/_fork_journal.json
ledger=packages/db/src/fork-migrations.ts
storage_statements=packages/plugin-sdk/src/internal/fork-storage-statements.ts

if [[ ! -f $layers_file ]]; then
  echo "No layer list at $layers_file" >&2
  exit 2
fi

git fetch --quiet --no-tags "$upstream_url" "+refs/heads/main:refs/fork-rebuild/upstream-main"
git fetch --quiet --no-tags --prune "$remote" "+refs/heads/*:refs/remotes/$remote/*"
git fetch --quiet --no-tags "$remote" "+refs/tags/fork-v*:refs/tags/fork-v*"
upstream=$(git rev-parse refs/fork-rebuild/upstream-main)
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
sources=$(mktemp -d "${TMPDIR:-/tmp}/fork-$target-journals.XXXXXX")
keep_work=0
cleanup() {
  rm -rf "$sources"
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

declare -A shipped=() shipped_by=() shipped_blobs=()
for release in $(git for-each-ref --format='%(objectname)' 'refs/tags/fork-v*'); do
  while read -r tag layer; do
    if blob=$(git rev-parse --verify --quiet "$release:$migrations_path/$tag.sql"); then
      if [[ " ${shipped[$tag]:-} " != *" $blob "* ]]; then
        shipped[$tag]="${shipped[$tag]:+${shipped[$tag]} }$blob"
      fi
      shipped_blobs[$blob]=1
      if [[ $layer != - ]]; then
        shipped_by[$tag]=$layer
      fi
    fi
  done < <(git show "$release:$fork_journal" 2>/dev/null | python3 "$script_dir/fork-journal.py" tags 2>/dev/null || true)
done
upstream_tags=" $(git show "$upstream:$journal" | python3 -c 'import json, sys; print(" ".join(entry["tag"] for entry in json.load(sys.stdin)["entries"]))') "
declare -A upstream_blobs=() shipped_statement_by=() upstream_statements=()
while read -r _ _ blob _; do
  upstream_blobs[$blob]=1
done < <(git ls-tree "$upstream" -- "$migrations_path/")
for release in $(git for-each-ref --format='%(objectname)' 'refs/tags/fork-v*'); do
  while read -r hash layer; do
    shipped_statement_by[$hash]=$layer
  done < <(python3 -B "$script_dir/storage-statements.py" shipped . "$release")
done
while read -r hash; do
  upstream_statements[$hash]=1
done < <(python3 -B "$script_dir/storage-statements.py" upstream . "$upstream")

migration_hold() {
  local branch=$1 sha=$2 tag blob hash changed="" new="" dropped="" rebuilt statements
  local -a tags
  local -A blobs=() added=()
  mapfile -t tags < <(layer_migrations "$sha")
  for tag in "${tags[@]}"; do
    blob=$(git rev-parse "$sha:$migrations_path/$tag.sql")
    blobs[$blob]=1
    if [[ -n ${shipped[$tag]:-} && ${shipped[$tag]} != "$blob" ]]; then
      changed+="${changed:+, }$tag"
    elif [[ -z ${shipped[$tag]:-} && -z ${shipped_blobs[$blob]:-} ]]; then
      new+="${new:+, }$tag"
    fi
  done
  for tag in "${!shipped_by[@]}"; do
    if [[ ${shipped_by[$tag]} == "$branch" && " ${tags[*]} " != *" $tag "* && $upstream_tags != *" $tag "* ]]; then
      for blob in ${shipped[$tag]:-}; do
        if [[ -z ${blobs[$blob]:-} && -z ${upstream_blobs[$blob]:-} ]]; then
          dropped+="${dropped:+, }$tag"
          break
        fi
      done
    fi
  done
  if [[ -n $changed ]]; then
    echo "changes migration $changed, which a fork release already shipped"
    return
  elif [[ -n $dropped && -n $new ]]; then
    echo "replaces migration $dropped, which a fork release already shipped, with $new"
    return
  elif [[ ${#tags[@]} -gt 0 ]] && rebuilt=$(python3 -B "$script_dir/fork-journal.py" rebuilt-tables . "$upstream" "$sha" "${tags[@]}" | paste -sd, - | sed 's/,/, /g') && [[ -n $rebuilt ]]; then
    echo "rebuilds upstream's table $rebuilt, which would drop the columns upstream added since"
    return
  fi
  if ! statements=$(python3 -B "$script_dir/storage-statements.py" layer . "$upstream" "$sha" 2>&1); then
    echo "adds bb.storage.migrate statements the rebuild cannot read exactly, in $statements"
    return
  fi
  new=""
  for hash in $statements; do
    added[$hash]=1
    if [[ -z ${shipped_statement_by[$hash]:-} ]]; then
      new=1
    fi
  done
  for hash in "${!shipped_statement_by[@]}"; do
    if [[ ${shipped_statement_by[$hash]} == "$branch" && -z ${added[$hash]:-} && -z ${upstream_statements[$hash]:-} && -n $new ]]; then
      echo "replaces a bb.storage.migrate statement a fork release already shipped"
      return
    fi
  done
}

layer_migrations() {
  git diff --name-only --diff-filter=A "$upstream...$1" -- "$migrations_path" |
    sed -n "s|^$migrations_path/\([^/]*\)\.sql\$|\1|p"
}

layer_sources=()
record_layer_migrations() {
  local tags source hash
  for hash in $(python3 -B "$script_dir/storage-statements.py" layer . "$upstream" "$2" 2>/dev/null || true); do
    printf '%s %s\n' "$hash" "$1" >>"$sources/statements"
  done
  tags=$(layer_migrations "$2")
  if [[ -z $tags ]]; then
    return 0
  fi
  source=$sources/${#layer_sources[@]}-${1//\//_}
  git show "$2:$journal" >"$source.json"
  printf '%s\n' "$tags" >"$source.tags"
  printf '%s\n' "$1" >"$source.layer"
  layer_sources+=("$source")
}

resolution=""
resolve_conflicts() {
  local file others=()
  resolution=""
  for file in "$@"; do
    if [[ -f $work/$ledger && $file == "$migrations_path/meta/"* ]]; then
      git -C "$work" checkout --ours -- "$file" || return 1
      git -C "$work" add -- "$file"
      resolution="drizzle meta kept as merged"
    else
      others+=("$file")
    fi
  done
  if [[ ${#others[@]} -eq 0 ]]; then
    return 0
  fi
  (cd "$work" && python3 "$script_dir/resolve-versions.py" "${others[@]}" 2>/dev/null) || return 1
  git -C "$work" add -- "${others[@]}"
  resolution="${resolution:+$resolution, }version bumps resolved to the higher one"
}

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
  stores=""
  if [[ -n $(git diff --name-only "$upstream...$sha" -- "$migrations_path") ]]; then
    stores="database migrations"
  elif [[ -n $(git diff --unified=0 "$upstream...$sha" -- . ":(exclude)$migrations_path" ':(glob,exclude)**/__tests__/**' ':(glob,exclude)**/*.test.*' ':(glob,exclude)**/*.md' |
    grep -m1 -oE "^\+[^+].*[\`\"'] *(CREATE|ALTER|DROP) +(TABLE|(UNIQUE +)?INDEX|VIEW|TRIGGER)" || true) ]]; then
    stores="storage statements"
  fi
  if [[ -n $stores && ${options:-} != *allow-migrations* && ! -f $work/$ledger ]] && ! git cat-file -e "$sha:$ledger" 2>/dev/null; then
    rows+=("| \`$branch\` | $short | held back: adds $stores, and no fork-migrations layer merged before it |")
    held=$((held + 1))
    continue
  fi
  if [[ -n $stores ]]; then
    hold=$(migration_hold "$branch" "$sha")
    if [[ -n $hold ]]; then
      rows+=("| \`$branch\` | $short | held back: $hold |")
      held=$((held + 1))
      continue
    fi
  fi
  if git -C "$work" -c merge.conflictStyle=diff3 merge --quiet --no-ff --no-edit -m "Merge $branch into $target" "$sha" >/dev/null 2>&1; then
    rows+=("| \`$branch\` | $short | merged |")
    record_layer_migrations "$branch" "$sha"
  elif git -C "$work" rev-parse --verify --quiet MERGE_HEAD >/dev/null && [[ -z $(git -C "$work" ls-files -u) ]]; then
    git -C "$work" commit --quiet --no-edit
    rows+=("| \`$branch\` | $short | merged with a recorded resolution |")
    record_layer_migrations "$branch" "$sha"
  elif mapfile -t conflicted < <(git -C "$work" diff --name-only --diff-filter=U) &&
    resolve_conflicts "${conflicted[@]}"; then
    git -C "$work" commit --quiet --no-edit
    rows+=("| \`$branch\` | $short | merged, $resolution |")
    record_layer_migrations "$branch" "$sha"
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

fork_migrations=""
if [[ -f $work/$ledger ]]; then
  git -C "$work" rm -r -q -- "$migrations_path/meta"
  git -C "$work" checkout "$upstream" -- "$migrations_path/meta"
  if [[ ${#layer_sources[@]} -gt 0 ]]; then
    python3 -B "$script_dir/fork-journal.py" build "$work/$journal" "$work/$migrations_path" "${layer_sources[@]}" >"$work/$fork_journal"
    git -C "$work" add -- "$fork_journal"
    fork_migrations=$(python3 "$script_dir/fork-journal.py" tags <"$work/$fork_journal" | cut -d' ' -f1 | paste -sd, - | sed 's/,/, /g')
  fi
  touch "$sources/statements"
  python3 -B "$script_dir/storage-statements.py" module "$work" "$upstream" HEAD "$sources/statements" >"$work/$storage_statements"
  git -C "$work" add -- "$storage_statements"
  if ! git -C "$work" diff --cached --quiet; then
    git -C "$work" commit --quiet -m "Move the layers' migrations to the fork journal and list their storage statements"
  fi
fi

git update-ref "refs/fork-rebuild/$target" "$(git -C "$work" rev-parse HEAD)"
git for-each-ref --format='delete %(refname)' "refs/fork/$target" refs/fork/upstream-main | git update-ref --stdin
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
  if [[ -n $fork_migrations ]]; then
    echo "Fork journal: $fork_migrations"
    echo
  fi
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
