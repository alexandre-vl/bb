#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: fork/rerere.sh push

Saves this repository's rerere resolutions (rr-cache), merged with the ones
already on the fork, to the fork-rerere branch, so the next rebuild on
GitHub replays them.

Environment: FORK_REMOTE (origin), FORK_RERERE_BRANCH (fork-rerere).
USAGE
}

if [[ ${1:-} != push ]]; then
  usage >&2
  exit 2
fi

remote=${FORK_REMOTE:-origin}
branch=${FORK_RERERE_BRANCH:-fork-rerere}
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
ref=refs/remotes/$remote/$branch

git fetch --quiet --no-tags "$remote" "+refs/heads/$branch:$ref" 2>/dev/null || true
parent=$(git rev-parse --verify --quiet "$ref" || true)
if [[ -n $parent && -n $(git ls-tree --name-only "$parent" rr-cache) ]]; then
  git archive "$parent" rr-cache | tar -x -C "$common_dir"
fi
if [[ ! -d $common_dir/rr-cache ]]; then
  echo "No rerere resolutions to save."
  exit 0
fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
export GIT_INDEX_FILE=$scratch/index
git read-tree --empty
(cd "$common_dir" && find rr-cache -type f -print0) |
  while IFS= read -r -d '' path; do
    git update-index --add --cacheinfo "100644,$(git hash-object -w "$common_dir/$path"),$path"
  done
tree=$(git write-tree)
if [[ -n $parent && $(git rev-parse "$parent^{tree}") == "$tree" ]]; then
  echo "$remote/$branch already holds every resolution."
  exit 0
fi
if [[ -n $parent ]]; then
  commit=$(git commit-tree "$tree" -p "$parent" -m "Save rerere resolutions")
else
  commit=$(git commit-tree "$tree" -m "Save rerere resolutions")
fi
git push --quiet "$remote" "$commit:refs/heads/$branch"
echo "Saved $(git ls-tree -r --name-only "$commit" | grep -c '/postimage$' || true) resolutions to $remote/$branch."
