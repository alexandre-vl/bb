#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bb-alex-update

Installs the newest release of alexandre-vl/bb's alex build into the bb-alex
instance, when it is newer than the running one and no thread is running:
download, sha256 check, npm install into its own prefix, native module check,
stop, back up every SQLite file of the data dir, switch, start, and wait until
the new version answers. A version that fails to start is rolled back to the
previous one, marked failed and never retried.

Environment: BB_ALEX_DATA_DIR (~/.bb-alex), BB_ALEX_APP_DIR (~/.bb-alex-app),
BB_ALEX_REPO (alexandre-vl/bb), BB_ALEX_SERVER_PORT (48886),
BB_ALEX_UNIT (bb-alex.service).
USAGE
}

if [[ $# -gt 0 ]]; then
  usage
  exit 2
fi

data=${BB_ALEX_DATA_DIR:-$HOME/.bb-alex}
root=${BB_ALEX_APP_DIR:-$HOME/.bb-alex-app}
repo=${BB_ALEX_REPO:-alexandre-vl/bb}
port=${BB_ALEX_SERVER_PORT:-48886}
unit=${BB_ALEX_UNIT:-bb-alex.service}
node=$(cat "$root/node")
npm_cli=$(cat "$root/npm-cli")
base=https://github.com/$repo/releases/latest/download
url=http://127.0.0.1:$port
export PATH="$(dirname "$node"):$PATH"

exec 9>"$root/update.lock"
if ! flock -n 9; then
  echo "Another update is running."
  exit 0
fi

json_field() {
  "$node" -e '
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(input)[process.argv[1]];
        process.stdout.write(value === undefined || value === null ? "" : String(value));
      } catch {
        process.stdout.write("");
      }
    });
  ' "$1"
}

want=$(curl -fsSL "$base/version.txt")
current=$(readlink "$root/current" 2>/dev/null || true)
have=${current##*/}
if [[ $want == "$have" ]]; then
  exit 0
fi
if [[ -e $root/failed/$want ]]; then
  echo "bb $want failed to start before; waiting for a newer release."
  exit 0
fi

mkdir -p "$root/versions" "$root/failed"
stage=$(mktemp -d "$root/.stage.XXXXXX")
trap 'rm -rf "$stage"' EXIT
for asset in bb-app.tgz version.txt SHA256SUMS; do
  curl -fsSL -o "$stage/$asset" "$base/$asset"
done
(cd "$stage" && sha256sum --quiet -c SHA256SUMS)
if [[ $(cat "$stage/version.txt") != "$want" ]]; then
  echo "A newer release appeared during the download; the next run takes it."
  exit 0
fi

prefix=$root/versions/$want
if [[ ! -e $prefix/bin/bb-app ]]; then
  rm -rf "$prefix.partial"
  "$node" "$npm_cli" install --global --prefix "$prefix.partial" --no-fund --no-audit \
    --allow-scripts=better-sqlite3,node-pty,@parcel/watcher "$stage/bb-app.tgz"
  (cd "$prefix.partial/lib/node_modules/bb-app" &&
    "$node" -e "new (require('better-sqlite3'))(':memory:').close(); require('node-pty');")
  mv "$prefix.partial" "$prefix"
fi

if [[ -n $have ]] && curl -fsS "$url/health" >/dev/null 2>&1; then
  running=$(BB_SERVER_URL=$url "$node" "$root/current/bin/bb" updates app status --json 2>/dev/null | json_field runningThreadCount)
  if [[ $running != 0 ]]; then
    echo "${running:-Some} thread(s) running on bb-alex; the next run updates it."
    exit 0
  fi
fi

systemctl --user stop "$unit" || true
backup=$data/backups/$(date -u +%Y%m%dT%H%M%SZ)-before-$want
if [[ -f $data/bb.db ]]; then
  mkdir -p "$backup"
  (cd "$data" && find . -maxdepth 4 -path ./backups -prune -o -type f \( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \) -print0 |
    xargs -0 -r cp -a --parents -t "$backup")
fi
previous=$(readlink "$root/current" 2>/dev/null || true)
ln -sfn "$prefix" "$root/current"
systemctl --user start "$unit"

for _ in $(seq 72); do
  running_version=$(curl -fsS "$url/install/version" 2>/dev/null | json_field version || true)
  if [[ $running_version == "$want" ]]; then
    if [[ -d $data/backups ]]; then
      find "$data/backups" -mindepth 1 -maxdepth 1 -type d | sort | head -n -10 | xargs -r rm -rf
    fi
    find "$root/versions" -mindepth 1 -maxdepth 1 -type d | while read -r dir; do
      if [[ $dir != "$prefix" && $dir != "$previous" ]]; then
        rm -rf "$dir"
      fi
    done
    echo "bb $want is running on $url (was ${have:-nothing})."
    exit 0
  fi
  sleep 5
done

systemctl --user stop "$unit" || true
touch "$root/failed/$want"
if [[ -n $previous ]]; then
  ln -sfn "$previous" "$root/current"
fi
echo "bb $want did not answer on $url within 6 minutes. It is marked failed and bb-alex is stopped." >&2
echo "Its first start may have migrated the database: copy $backup back into $data, then start bb-alex (${previous##*/})." >&2
exit 1
