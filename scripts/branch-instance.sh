#!/usr/bin/env bash
# Build and run one isolated Arlesh instance per branch worktree, so several open PRs can be
# tried side by side without touching each other or the real database.
#
#   scripts/branch-instance.sh list
#   scripts/branch-instance.sh build [name ... | all]   # default: all
#   scripts/branch-instance.sh run   <name | all>
#   scripts/branch-instance.sh stop  [name ... | all]   # default: all
#   scripts/branch-instance.sh clean [name ... | all]   # default: all
#
# `all` means every worktree. `run all` launches each built instance at once, detached, so the
# branches can be compared side by side and survive the shell that started them.
#
# Each instance's window is titled "Arlesh — <branch>", so several open at once are distinguishable.
#
# How it runs: a debug Tauri build resolves its frontend from tauri.conf.json's `devUrl` rather than
# embedding it, so each instance is paired with its own Vite dev server on its own port, and `run`
# starts both. That keeps builds cheap — the debug dependency tree already exists and is shared,
# where a release build would need a second one — and it means an edit in a worktree hot-reloads in
# that worktree's window.
#
# Both the window title and the port are baked in at build time, so the worktree's tauri.conf.json
# is edited for the length of the build and restored afterwards, including when the build fails.
#
# Space: every branch compiles into the ONE target directory the main checkout already has, so the
# dependency tree is built once and shared. Only the per-branch binary is kept (the shared target's
# binary is overwritten by the next build, which is why it is copied out). Each instance carries a
# seeded copy of the real database, currently ~240 KB.
#
# Isolation: the app resolves its database from Tauri's app_data_dir, which on Linux is
# $XDG_DATA_HOME/com.atai.arlesh. Pointing XDG_DATA_HOME at a per-instance directory therefore
# isolates the database, the webview's localStorage and every persisted Zustand slice in one move.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREES="$REPO/.claude/worktrees"
SHARED_TARGET="${ARLESH_SHARED_TARGET:-$REPO/src-tauri/target}"
INSTANCES="${ARLESH_INSTANCES:-$HOME/.cache/arlesh/instances}"
REAL_DB="${ARLESH_REAL_DB:-$HOME/.local/share/com.atai.arlesh/arlesh.db}"
MIN_FREE_GB="${ARLESH_MIN_FREE_GB:-5}"
BASE_PORT="${ARLESH_BASE_PORT:-14200}"

die() { printf '%s\n' "$*" >&2; exit 1; }

free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }

require_space() {
  local free; free="$(free_gb)"
  [ "$free" -ge "$MIN_FREE_GB" ] ||
    die "Only ${free}G free on /, need ${MIN_FREE_GB}G. Run '$0 clean' or free space first."
}

all_names() {
  [ -d "$WORKTREES" ] || return 0
  for d in "$WORKTREES"/*/; do [ -d "$d" ] && basename "$d"; done
}

built_names() {
  while read -r name; do
    [ -n "$name" ] && [ -x "$INSTANCES/$name/arlesh" ] && printf '%s\n' "$name"
  done < <(all_names)
}

# Expands the argument list a command was given into concrete names: empty or `all` means every
# worktree. Keeps `all` from ever being mistaken for a branch called "all".
resolve_names() {
  local -n out=$1; shift
  if [ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = "all" ]; }; then
    mapfile -t out < <(all_names)
  else
    out=("$@")
  fi
}

worktree_path() {
  local p="$WORKTREES/$1"
  [ -d "$p" ] || die "No worktree '$1'. Try: $0 list"
  printf '%s' "$p"
}

# A port is assigned once and then kept, so a rebuilt instance keeps the port its binary was
# compiled against. Assigning by list position instead would silently break every built instance
# the moment a worktree was added or removed.
port_for() {
  local name="$1" portfile="$INSTANCES/$name/port" port taken
  if [ -f "$portfile" ]; then cat "$portfile"; return; fi
  port="$BASE_PORT"
  while :; do
    taken=no
    for f in "$INSTANCES"/*/port; do
      [ -f "$f" ] && [ "$(cat "$f")" = "$port" ] && taken=yes && break
    done
    [ "$taken" = no ] && break
    port=$((port + 1))
  done
  mkdir -p "$INSTANCES/$name"
  printf '%s' "$port" > "$portfile"
  printf '%s' "$port"
}

RESTORE_CONF=""
restore_conf() {
  [ -n "$RESTORE_CONF" ] || return 0
  [ -f "$RESTORE_CONF.orig" ] && mv -f "$RESTORE_CONF.orig" "$RESTORE_CONF"
  RESTORE_CONF=""
}
trap restore_conf EXIT

build_one() {
  local name="$1" wt binary port conf
  wt="$(worktree_path "$name")"
  port="$(port_for "$name")"
  require_space

  # Each worktree needs node_modules reachable. A symlink to the main checkout's costs nothing and
  # is what the agents already use; npm install must never run inside a worktree.
  [ -e "$wt/node_modules" ] || ln -s "$REPO/node_modules" "$wt/node_modules"

  conf="$wt/src-tauri/tauri.conf.json"
  cp "$conf" "$conf.orig"
  RESTORE_CONF="$conf"
  python3 - "$conf" "$name" "$port" <<'SETCONF'
import json, sys
path, branch, port = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f: conf = json.load(f)
conf.setdefault("build", {})["devUrl"] = f"http://localhost:{port}"
for window in conf.get("app", {}).get("windows", []):
    window["title"] = f"Arlesh — {branch}"
with open(path, "w") as f: json.dump(conf, f, indent=2)
SETCONF

  printf '\n=== %s: tauri debug, port %s (shared target) ===\n' "$name" "$port"
  ( cd "$wt" && CARGO_TARGET_DIR="$SHARED_TARGET" cargo build --manifest-path src-tauri/Cargo.toml --bin arlesh )

  restore_conf

  binary="$SHARED_TARGET/debug/arlesh"
  [ -x "$binary" ] || die "Expected a binary at $binary and found none."

  mkdir -p "$INSTANCES/$name/data/com.atai.arlesh"
  cp "$binary" "$INSTANCES/$name/arlesh"

  # Seed once, then leave it alone: the point of an instance is that what you do in it persists
  # across runs and never reaches the real board.
  if [ ! -f "$INSTANCES/$name/data/com.atai.arlesh/arlesh.db" ] && [ -f "$REAL_DB" ]; then
    cp "$REAL_DB" "$INSTANCES/$name/data/com.atai.arlesh/arlesh.db"
    printf '    seeded from %s\n' "$REAL_DB"
  fi

  printf '=== %s: ready (%s, port %s, %sG free) ===\n' \
    "$name" "$(du -h "$INSTANCES/$name/arlesh" | cut -f1)" "$port" "$(free_gb)"
}

cmd_list() {
  printf '%-28s %-7s %-7s %-7s %s\n' BRANCH BUILT PORT SIZE HEAD
  while read -r name; do
    [ -n "$name" ] || continue
    local built=no size=- port=- head
    if [ -x "$INSTANCES/$name/arlesh" ]; then
      built=yes; size="$(du -h "$INSTANCES/$name/arlesh" | cut -f1)"
    fi
    [ -f "$INSTANCES/$name/port" ] && port="$(cat "$INSTANCES/$name/port")"
    head="$(git -C "$WORKTREES/$name" log --oneline -1 2>/dev/null || echo '?')"
    printf '%-28s %-7s %-7s %-7s %s\n' "$name" "$built" "$port" "$size" "${head:0:50}"
  done < <(all_names)
  printf '\n%sG free on /\n' "$(free_gb)"
}

cmd_build() {
  local names; resolve_names names "$@"
  [ "${#names[@]}" -gt 0 ] || die "No worktrees under $WORKTREES."
  # Sequential on purpose: cargo locks the shared target anyway, and this box has 15 GB of RAM —
  # parallel builds drive it into swap.
  for name in "${names[@]}"; do build_one "$name"; done
  printf '\nAll done. %sG free.\n' "$(free_gb)"
}

# Starts the instance's own Vite server and waits for it to answer. The app is a debug build and
# loads its frontend over HTTP, so launching it before the server answers is the white "could not
# connect to localhost" window.
start_vite() {
  local name="$1" wt port
  wt="$(worktree_path "$name")"
  port="$(port_for "$name")"
  if curl -sf -o /dev/null "http://localhost:$port" 2>/dev/null; then
    printf '  %-28s vite already up on %s\n' "$name" "$port"
    return 0
  fi
  ( cd "$wt" && setsid npm run dev -- --port "$port" --strictPort \
      >"$INSTANCES/$name/vite.log" 2>&1 < /dev/null & printf '%s' "$!" > "$INSTANCES/$name/vite.pid" )
  for _ in $(seq 60); do
    curl -sf -o /dev/null "http://localhost:$port" 2>/dev/null && return 0
    sleep 1
  done
  die "Vite never came up on port $port for '$name' — see $INSTANCES/$name/vite.log"
}

# Detached in its own session, so an instance outlives the shell that started it — closing the
# terminal mid-review should not take every window down with it.
launch() {
  local name="$1"
  XDG_DATA_HOME="$INSTANCES/$name/data" \
  XDG_CONFIG_HOME="$INSTANCES/$name/config" \
    setsid "$INSTANCES/$name/arlesh" >"$INSTANCES/$name/run.log" 2>&1 < /dev/null &
  local pid=$!
  printf '%s' "$pid" > "$INSTANCES/$name/run.pid"
  printf '  %-28s app pid %-8s port %-6s logs %s\n' \
    "$name" "$pid" "$(port_for "$name")" "$INSTANCES/$name/"
}

cmd_run() {
  local name="${1:-}"
  [ -n "$name" ] || die "Usage: $0 run <name|all>"

  local names
  if [ "$name" = "all" ]; then
    mapfile -t names < <(built_names)
    [ "${#names[@]}" -gt 0 ] || die "Nothing is built yet. Run: $0 build all"
  else
    [ -x "$INSTANCES/$name/arlesh" ] || die "'$name' is not built. Run: $0 build $name"
    names=("$name")
  fi

  # Each instance is a WebKit process plus a Vite server. On a 15 GB box a handful is fine and all
  # of them is not, so say what this is about to cost rather than discovering it in swap.
  local free_mb; free_mb="$(free -m | awk '/^Mem:/ {print $7}')"
  printf 'Starting %d instance(s) — each is a Vite server plus a WebKit window (%s MB available).\n' \
    "${#names[@]}" "$free_mb"
  if [ "${#names[@]}" -gt 4 ] && [ "$free_mb" -lt 6000 ]; then
    printf 'Refusing: %d instances with only %s MB free will swap. Name the ones you want, or free memory.\n' \
      "${#names[@]}" "$free_mb" >&2
    exit 1
  fi

  for n in "${names[@]}"; do start_vite "$n"; launch "$n"; done
  printf 'Stop them with: %s stop %s\n' "$0" "$name"
}

kill_pidfile() {
  local pidfile="$1" what="$2" name="$3" pid
  [ -f "$pidfile" ] || return 0
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    # Negative pid: these are setsid leaders, so the whole group goes, not just the parent shell.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    printf 'stopped %s %s (pid %s)\n' "$name" "$what" "$pid"
  fi
  rm -f "$pidfile"
}

cmd_stop() {
  local names; resolve_names names "$@"
  for name in "${names[@]}"; do
    kill_pidfile "$INSTANCES/$name/run.pid" app "$name"
    kill_pidfile "$INSTANCES/$name/vite.pid" vite "$name"
  done
}

cmd_clean() {
  local names; resolve_names names "$@"
  for name in "${names[@]}"; do
    # Only the binary goes. An instance's database is the state you built up while testing that
    # branch, and it is not rebuildable — delete those by hand if you really want them gone.
    rm -f "$INSTANCES/$name/arlesh"
    printf 'removed binary for %s (its data and port kept at %s)\n' "$name" "$INSTANCES/$name"
  done
  printf '%sG free.\n' "$(free_gb)"
}

case "${1:-list}" in
  list)  shift || true; cmd_list ;;
  build) shift; cmd_build "$@" ;;
  run)   shift; cmd_run "$@" ;;
  stop)  shift; cmd_stop "$@" ;;
  clean) shift; cmd_clean "$@" ;;
  *)     die "Usage: $0 {list | build [name...|all] | run <name|all> | stop [name...|all] | clean [name...|all]}" ;;
esac
