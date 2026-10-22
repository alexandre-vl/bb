#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: fork/instance/adopt.sh <unit> [--now]

Makes an existing bb, run by the systemd user unit <unit> (the official bb),
run alexandre-vl/bb's alex releases with the same data dir, ports and account.
It installs bb-fork-update.timer, which runs bb-fork-update (update.sh) every
10 minutes. The first run with no thread running stops the unit, backs up
bb.db and each plugin's data.db, and restarts the unit through a drop-in that
runs the newest release; later runs keep it updated the same way.

The unit's own install stays on disk. To go back to it, at once:
  systemctl --user start bb-fork-revert.service

--now runs the first check at once. It downloads and installs the release,
then switches only if no thread is running.

Environment: BB_FORK_APP_DIR (~/.bb-fork-app), BB_FORK_REPO (alexandre-vl/bb),
BB_FORK_KEEP_BACKUPS (3).
USAGE
}

unit=""
now=false
for arg in "$@"; do
  case $arg in
    --now) now=true ;;
    -h | --help) usage; exit 0 ;;
    -*) usage; exit 2 ;;
    *)
      if [[ -n $unit ]]; then
        usage
        exit 2
      fi
      unit=$arg
      ;;
  esac
done
if [[ -z $unit ]]; then
  usage
  exit 2
fi

fail() {
  echo "$*" >&2
  exit 1
}

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=${BB_FORK_APP_DIR:-$HOME/.bb-fork-app}
repo=${BB_FORK_REPO:-alexandre-vl/bb}
keep=${BB_FORK_KEEP_BACKUPS:-3}
units=$HOME/.config/systemd/user
dropin=$units/$unit.d/zz-alexandre-vl-fork.conf

systemctl --user show-environment >/dev/null 2>&1 || fail "systemd --user is not available here."
fragment=$(systemctl --user show -p FragmentPath --value "$unit")
[[ -n $fragment && -f $fragment ]] || fail "No unit file for $unit."
[[ $fragment != "$units/bb-fork-"* ]] || fail "$unit is one of the fork's own units."

mapfile -t argv < <(python3 -c '
import shlex, sys
lines = [line.strip() for line in open(sys.argv[1]) if line.strip().startswith("ExecStart=")]
command = [line for line in lines if line != "ExecStart="][-1][len("ExecStart="):].lstrip("-@:+!|")
print("\n".join(shlex.split(command)))
' "$fragment")
node=${argv[0]:-}
[[ ${#argv[@]} -ge 3 && ${argv[1]} == */bin/bb-app && ${argv[2]} == start ]] ||
  fail "$fragment does not start bb with <node> <prefix>/bin/bb-app start: ${argv[*]}"
[[ -x $node ]] || fail "The node of $unit is not executable: $node"
npm_cli=$(dirname "$node")/../lib/node_modules/npm/bin/npm-cli.js
[[ -f $npm_cli ]] || fail "npm-cli.js does not ship beside $node."
npm_cli=$(cd "$(dirname "$npm_cli")" && pwd)/npm-cli.js

data="" port="" daemon_port=""
start_args=()
for ((i = 3; i < ${#argv[@]}; i++)); do
  case ${argv[i]} in
    --data-dir) data=${argv[i + 1]:-} ;;
    --server-port) port=${argv[i + 1]:-} ;;
    --host-daemon-port) daemon_port=${argv[i + 1]:-} ;;
    --no-in-app-updates) continue ;;
  esac
  start_args+=("${argv[i]}")
done
[[ -n $data && -n $port && -n $daemon_port ]] ||
  fail "$fragment must pass --data-dir, --server-port and --host-daemon-port: ${argv[*]}"
[[ -f $data/bb.db ]] || fail "$data has no bb.db; is it the data dir of a bb?"
case $root/ in
  "$data"/*) fail "BB_FORK_APP_DIR must be outside $data." ;;
esac

quote() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//%/%%}
  value=${value//\$/\$\$}
  printf '"%s"' "$value"
}

mkdir -p "$root/versions" "$root/failed" "$units" "$HOME/.local/bin"
printf '%s\n' "$node" >"$root/node"
printf '%s\n' "$npm_cli" >"$root/npm-cli"
{
  echo "[Service]"
  echo "ExecStart="
  line="ExecStart=$(quote "$node") $(quote "$root/current/bin/bb-app") \"start\""
  for arg in "${start_args[@]}"; do
    line+=" $(quote "$arg")"
  done
  echo "$line \"--no-in-app-updates\""
  echo "UnsetEnvironment=BB_APP_NPM_PREFIX"
} >"$root/dropin.conf"
cat >"$root/env" <<EOF
BB_ALEX_UNIT=$unit
BB_ALEX_DATA_DIR=$data
BB_ALEX_APP_DIR=$root
BB_ALEX_REPO=$repo
BB_ALEX_SERVER_PORT=$port
BB_ALEX_DAEMON_PORT=$daemon_port
BB_ALEX_DROPIN=$dropin
BB_ALEX_TIMER=bb-fork-update.timer
BB_ALEX_BACKUP_DIR=$root/backups
BB_ALEX_KEEP_BACKUPS=$keep
EOF
install -m 755 "$here/update.sh" "$HOME/.local/bin/bb-fork-update"

cat >"$units/bb-fork-update.service" <<EOF
[Unit]
Description=Switch $unit to the newest alexandre-vl/bb alex release when no thread runs

[Service]
Type=oneshot
EnvironmentFile=$root/env
ExecStart=%h/.local/bin/bb-fork-update
EOF
cat >"$units/bb-fork-update.timer" <<'EOF'
[Unit]
Description=Check for a new alexandre-vl/bb alex release every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
RandomizedDelaySec=1min

[Install]
WantedBy=timers.target
EOF
cat >"$units/bb-fork-revert.service" <<EOF
[Unit]
Description=Put $unit back on its own install and turn the alex updates off

[Service]
Type=oneshot
EnvironmentFile=$root/env
ExecStart=%h/.local/bin/bb-fork-update --revert
EOF

systemctl --user daemon-reload
systemctl --user enable --now bb-fork-update.timer >/dev/null
echo "$unit: data $data, server $port, daemon $daemon_port."
echo "bb-fork-update.timer switches it to the newest alex release the first time no thread runs, then keeps it updated."
echo "Backups: $root/backups (keeps $keep). Back to its own install: systemctl --user start bb-fork-revert.service"
if $now; then
  systemctl --user start bb-fork-update.service || true
  journalctl --user -u bb-fork-update.service -n 20 --no-pager -o cat | grep -v -e '^Starting ' -e '^Finished ' || true
fi
