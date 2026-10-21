#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: fork/instance/install.sh

Installs or refreshes bb-alex, a second bb instance on this Linux machine that
runs alexandre-vl/bb's alex releases beside the official bb, with its own data
dir and ports, in-app updates off, and a systemd user timer that installs each
new release. Safe to run again.

Environment: BB_ALEX_DATA_DIR (~/.bb-alex), BB_ALEX_APP_DIR (~/.bb-alex-app),
BB_ALEX_SERVER_PORT (48886), BB_ALEX_DAEMON_PORT (48887),
BB_ALEX_NODE (the node on PATH), BB_ALEX_REPO (alexandre-vl/bb).
USAGE
}

if [[ $# -gt 0 ]]; then
  usage
  exit 2
fi

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
data=${BB_ALEX_DATA_DIR:-$HOME/.bb-alex}
root=${BB_ALEX_APP_DIR:-$HOME/.bb-alex-app}
port=${BB_ALEX_SERVER_PORT:-48886}
daemon_port=${BB_ALEX_DAEMON_PORT:-48887}
repo=${BB_ALEX_REPO:-alexandre-vl/bb}
units=$HOME/.config/systemd/user

fail() {
  echo "$1" >&2
  exit 1
}

node=$(readlink -f "${BB_ALEX_NODE:-$(command -v node || true)}")
[[ -x $node ]] || fail "No node found. Set BB_ALEX_NODE to a Node 22.19+ binary."
"$node" -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  const ok = (major === 22 && minor >= 19) || major === 24 || major === 26;
  process.exit(ok ? 0 : 1);
' || fail "$node is Node $("$node" -p process.versions.node); bb-app needs ^22.19, ^24 or ^26."
npm_cli=$(readlink -f "$(dirname "$node")/../lib/node_modules/npm/bin/npm-cli.js" 2>/dev/null || true)
[[ -f $npm_cli ]] || fail "No npm ships with $node (looked for lib/node_modules/npm/bin/npm-cli.js)."
systemctl --user show-environment >/dev/null 2>&1 || fail "systemd user services are not available here."

mkdir -p "$data"
data=$(readlink -f "$data")
case $data in
  "$HOME/.bb" | "$HOME/.bb/"* | "$HOME/.bb-machines" | "$HOME/.bb-machines/"*)
    fail "$data belongs to an official bb. Pick another BB_ALEX_DATA_DIR." ;;
esac
if [[ -f $data/bb-app-runtime.json ]] && ! systemctl --user is-active --quiet bb-alex.service; then
  fail "$data has a running or stale bb that bb-alex.service does not own ($data/bb-app-runtime.json)."
fi

if ! systemctl --user is-active --quiet bb-alex.service; then
  busy=$(ss -ltnH "( sport = :$port or sport = :$daemon_port )" 2>/dev/null || true)
  [[ -z $busy ]] || fail "Port $port or $daemon_port is taken: $busy"
fi

mkdir -p "$root/versions" "$HOME/.local/bin" "$units"
printf '%s\n' "$node" >"$root/node"
printf '%s\n' "$npm_cli" >"$root/npm-cli"
install -m 755 "$here/update.sh" "$HOME/.local/bin/bb-alex-update"
cat >"$HOME/.local/bin/bb-alex" <<EOF
#!/usr/bin/env bash
export BB_SERVER_URL=http://127.0.0.1:$port
export BB_HOST_DAEMON_PORT=$daemon_port
exec "$node" "$root/current/bin/bb" "\$@"
EOF
chmod 755 "$HOME/.local/bin/bb-alex"

render() {
  sed -e "s|@NODE_DIR@|$(dirname "$node")|g" -e "s|@NODE@|$node|g" -e "s|@ROOT@|$root|g" \
    -e "s|@DATA@|$data|g" -e "s|@PORT@|$port|g" -e "s|@DAEMON_PORT@|$daemon_port|g" "$1"
}
render "$here/bb-alex.service" >"$units/bb-alex.service"
cp "$here/bb-alex-update.service" "$here/bb-alex-update.timer" "$units/"
if [[ $repo != alexandre-vl/bb || -n ${BB_ALEX_DATA_DIR:-} || -n ${BB_ALEX_APP_DIR:-} || -n ${BB_ALEX_SERVER_PORT:-} ]]; then
  mkdir -p "$units/bb-alex-update.service.d"
  cat >"$units/bb-alex-update.service.d/env.conf" <<EOF
[Service]
Environment=BB_ALEX_REPO=$repo BB_ALEX_DATA_DIR=$data BB_ALEX_APP_DIR=$root BB_ALEX_SERVER_PORT=$port
EOF
fi
systemctl --user daemon-reload
systemctl --user enable bb-alex.service bb-alex-update.timer >/dev/null

BB_ALEX_REPO=$repo BB_ALEX_DATA_DIR=$data BB_ALEX_APP_DIR=$root BB_ALEX_SERVER_PORT=$port "$HOME/.local/bin/bb-alex-update"
systemctl --user is-active --quiet bb-alex.service || systemctl --user start bb-alex.service
systemctl --user start bb-alex-update.timer

if [[ $(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true) != yes ]]; then
  loginctl enable-linger "$USER" 2>/dev/null ||
    echo "Run 'sudo loginctl enable-linger $USER' so bb-alex keeps running after you log out."
fi

version=$(curl -fsS "http://127.0.0.1:$port/install/version" 2>/dev/null || true)
echo "bb-alex: $version"
echo "Server http://127.0.0.1:$port · data $data · CLI bb-alex · logs journalctl --user -u bb-alex"
