#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bb-alex-update [--revert | --now]

Installs the newest release of alexandre-vl/bb's alex build into a bb, when it
differs from the one running and no thread is running: download, sha256 check,
npm install into its own prefix, native module check, stop, back up bb's SQLite
files (bb.db and each plugin's data.db), switch, start, and wait until the new
version answers.

A version that does not answer is marked failed and never retried, and the bb
goes back to the build it ran before. If that build does not answer either,
the backup is restored (the databases it replaces are moved aside) and the bb
is started again.

With BB_ALEX_DROPIN set, the bb is an existing unit, such as the official bb,
and the first switch installs the systemd drop-in prepared in
<app dir>/dropin.conf, which runs <app dir>/current instead of the unit's own
install. --revert moves that drop-in aside, turns BB_ALEX_TIMER off and
restarts the unit on its own install, at once, running threads or not.

--now switches to the newest release at once, running threads or not, without
waiting BB_ALEX_MIN_HOURS. A thread that was running stops; resume it once the
new version answers. Start it outside the bb unit, with systemd-run, or the
stop kills it along with bb.

Environment: BB_ALEX_DATA_DIR (~/.bb-alex), BB_ALEX_APP_DIR (~/.bb-alex-app),
BB_ALEX_REPO (alexandre-vl/bb), BB_ALEX_SERVER_PORT (48886),
BB_ALEX_DAEMON_PORT (48887), BB_ALEX_UNIT (bb-alex.service), BB_ALEX_DROPIN,
BB_ALEX_TIMER, BB_ALEX_BACKUP_DIR (<data dir>/backups), BB_ALEX_KEEP_BACKUPS
(10), BB_ALEX_MIN_HOURS (0: the hours a release keeps running before the next
switch), BB_ALEX_START_TIMEOUT (360 seconds), BB_ALEX_RELEASE_BASE (the latest
release of BB_ALEX_REPO).
USAGE
}

revert=false
now=false
if [[ $# -eq 1 && $1 == --revert ]]; then
  revert=true
elif [[ $# -eq 1 && $1 == --now ]]; then
  now=true
elif [[ $# -gt 0 ]]; then
  usage
  exit 2
fi

data=${BB_ALEX_DATA_DIR:-$HOME/.bb-alex}
root=${BB_ALEX_APP_DIR:-$HOME/.bb-alex-app}
repo=${BB_ALEX_REPO:-alexandre-vl/bb}
port=${BB_ALEX_SERVER_PORT:-48886}
daemon_port=${BB_ALEX_DAEMON_PORT:-48887}
unit=${BB_ALEX_UNIT:-bb-alex.service}
dropin=${BB_ALEX_DROPIN:-}
timer=${BB_ALEX_TIMER:-}
backups=${BB_ALEX_BACKUP_DIR:-$data/backups}
keep=${BB_ALEX_KEEP_BACKUPS:-10}
min_hours=${BB_ALEX_MIN_HOURS:-0}
start_timeout=${BB_ALEX_START_TIMEOUT:-360}
base=${BB_ALEX_RELEASE_BASE:-https://github.com/$repo/releases/latest/download}
node=$(cat "$root/node")
npm_cli=$(cat "$root/npm-cli")
url=http://127.0.0.1:$port
export PATH="$(dirname "$node"):$PATH"
unset BB_CLI BB_DATA_DIR BB_PROJECT_ID BB_THREAD_ID BB_ENVIRONMENT_ID BB_SERVER_URL BB_HOST_DAEMON_PORT

exec 9>"$root/update.lock"
if $revert; then
  flock 9
elif ! flock -n 9; then
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

answering_version() {
  curl -fsS "$url/install/version" 2>/dev/null | json_field version || true
}

wait_for() {
  local expected=$1 got
  for _ in $(seq $(((start_timeout + 4) / 5))); do
    got=$(answering_version)
    if [[ -n $got && (-z $expected || $got == "$expected") ]]; then
      echo "$got"
      return 0
    fi
    sleep 5
  done
  return 1
}

databases() {
  (cd "$data" && find . -maxdepth 3 -type f \( -path ./bb.db -o -path ./bb.db-wal -o -path ./bb.db-shm \
    -o -path './plugins/*/data.db' -o -path './plugins/*/data.db-wal' -o -path './plugins/*/data.db-shm' \) -print0)
}

back_up() {
  mkdir -p "$1"
  databases | (cd "$data" && xargs -0 -r cp -a --parents -t "$1")
}

restore() {
  local from=$1 aside=$2 file
  while IFS= read -r -d '' file; do
    mkdir -p "$aside/$(dirname "$file")"
    mv "$data/$file" "$aside/$file"
  done < <(databases)
  (cd "$from" && find . -type f -print0 | xargs -0 -r cp -a --parents -t "$data")
}

if $revert; then
  if [[ -z $dropin ]]; then
    echo "--revert needs BB_ALEX_DROPIN." >&2
    exit 2
  fi
  if [[ -n $timer ]]; then
    systemctl --user disable --now "$timer" || true
  fi
  if [[ -f $dropin ]]; then
    systemctl --user stop "$unit" || true
    mkdir -p "$root/reverted"
    mv "$dropin" "$root/reverted/$(date -u +%Y%m%dT%H%M%SZ).conf"
    systemctl --user daemon-reload
    systemctl --user start "$unit"
  fi
  if got=$(wait_for ""); then
    echo "$unit runs its own install again: bb $got on $url. The alex updates are off."
    exit 0
  fi
  echo "$unit does not answer on $url $start_timeout seconds after the revert." >&2
  exit 1
fi

if [[ -n $dropin && ! -f $root/dropin.conf ]]; then
  echo "BB_ALEX_DROPIN is set but $root/dropin.conf is missing; run adopt.sh again." >&2
  exit 1
fi
adopted=true
if [[ -n $dropin && ! -f $dropin ]]; then
  adopted=false
fi
current=$(readlink "$root/current" 2>/dev/null || true)
have=${current##*/}
if ! $adopted; then
  have=""
fi
running_label=${have:-nothing}
if ! $adopted; then
  running_label="its own install"
fi

want=$(curl -fsSL "$base/version.txt")
if [[ $want == "$have" ]]; then
  exit 0
fi
if [[ -e $root/failed/$want ]]; then
  echo "bb $want failed to start before; waiting for a newer release."
  exit 0
fi
if [[ -n $have && $min_hours != 0 ]] && ! $now; then
  switched=$(stat -c %Y "$root/current")
  if (($(date +%s) - switched < min_hours * 3600)); then
    echo "bb $have has run for less than $min_hours hours; bb $want waits."
    exit 0
  fi
fi

mkdir -p "$root/versions" "$root/failed"
prefix=$root/versions/$want
if [[ ! -e $prefix/bin/bb-app ]]; then
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
  rm -rf "$prefix.partial"
  "$node" "$npm_cli" install --global --prefix "$prefix.partial" --no-fund --no-audit \
    --allow-scripts=better-sqlite3,node-pty,@parcel/watcher "$stage/bb-app.tgz"
  (cd "$prefix.partial/lib/node_modules/bb-app" &&
    "$node" -e "new (require('better-sqlite3'))(':memory:').close(); require('node-pty');")
  mv "$prefix.partial" "$prefix"
fi

if $now; then
  if [[ -n $dropin ]] && ! curl -fsS "$url/health" >/dev/null 2>&1; then
    echo "$unit does not answer on $url; not switching a bb that is down." >&2
    exit 1
  fi
elif curl -fsS "$url/health" >/dev/null 2>&1; then
  running=$(BB_SERVER_URL=$url BB_HOST_DAEMON_PORT=$daemon_port "$node" "$prefix/bin/bb" updates app status --json 2>/dev/null | json_field runningThreadCount)
  if [[ -z $running ]]; then
    echo "Could not read the running threads from $url; not updating." >&2
    exit 1
  fi
  if [[ $running != 0 ]]; then
    echo "$running thread(s) running on $url; the next run switches to bb $want."
    exit 0
  fi
elif [[ -n $dropin ]]; then
  echo "$unit does not answer on $url; not switching a bb that is down." >&2
  exit 1
fi

systemctl --user stop "$unit" || true
backup=""
if [[ -f $data/bb.db ]]; then
  backup=$backups/$(date -u +%Y%m%dT%H%M%SZ)-before-$want
  back_up "$backup"
fi
previous=$current
ln -sfn "$prefix" "$root/current"
if ! $adopted; then
  mkdir -p "$(dirname "$dropin")"
  cp "$root/dropin.conf" "$dropin.partial"
  mv "$dropin.partial" "$dropin"
  systemctl --user daemon-reload
fi
systemctl --user start "$unit"

if wait_for "$want" >/dev/null; then
  if [[ -d $backups ]]; then
    find "$backups" -mindepth 1 -maxdepth 1 -type d -name '*-before-*' | sort | head -n -"$keep" | xargs -r rm -rf
  fi
  find "$root/versions" -mindepth 1 -maxdepth 1 -type d | while read -r dir; do
    if [[ $dir != "$prefix" && $dir != "$previous" ]]; then
      rm -rf "$dir"
    fi
  done
  echo "bb $want is running on $url (was $running_label)."
  exit 0
fi

systemctl --user stop "$unit" || true
touch "$root/failed/$want"
if ! $adopted; then
  mv "$dropin" "$root/failed/$want.conf"
  systemctl --user daemon-reload
  if [[ -n $previous ]]; then
    ln -sfn "$previous" "$root/current"
  else
    rm -f "$root/current"
  fi
elif [[ -n $previous ]]; then
  ln -sfn "$previous" "$root/current"
else
  echo "bb $want did not answer on $url within $start_timeout seconds and there is no build to go back to; $unit is stopped." >&2
  exit 1
fi
systemctl --user start "$unit"
if got=$(wait_for ""); then
  echo "bb $want did not answer on $url within $start_timeout seconds; it is marked failed and $unit runs $running_label again (bb $got)." >&2
  exit 1
fi
if [[ -z $backup ]]; then
  echo "Neither bb $want nor $running_label answers on $url, and there is no backup to restore." >&2
  exit 1
fi
systemctl --user stop "$unit" || true
aside=$root/failed/$want-databases
restore "$backup" "$aside"
systemctl --user start "$unit"
if got=$(wait_for ""); then
  echo "bb $want did not answer, and $running_label answered only once $backup was restored (bb $got). The databases it replaced are in $aside." >&2
  exit 1
fi
echo "Neither bb $want nor $running_label answers on $url, even with $backup restored. The databases it replaced are in $aside." >&2
exit 1
