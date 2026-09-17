#!/usr/bin/env bash
# Build and run one isolated Arlesh instance per branch worktree, so several open PRs can be
# tried side by side without touching each other or the real database.
#
#   scripts/branch-instance.sh list
#   scripts/branch-instance.sh build [name ...]      # default: every worktree
#   scripts/branch-instance.sh run <name>
#   scripts/branch-instance.sh clean [name ...]
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

worktree_path() {
  local p="$WORKTREES/$1"
  [ -d "$p" ] || die "No worktree '$1'. Try: $0 list"
  printf '%s' "$p"
}

build_one() {
  local name="$1" wt binary
  wt="$(worktree_path "$name")"
  require_space

  # Each worktree needs node_modules reachable. A symlink to the main checkout's costs nothing and
  # is what the agents already use; npm install must never run inside a worktree.
  [ -e "$wt/node_modules" ] || ln -s "$REPO/node_modules" "$wt/node_modules"

  printf '\n=== %s: frontend ===\n' "$name"
  ( cd "$wt" && npm run build )

  printf '=== %s: tauri (shared target) ===\n' "$name"
  ( cd "$wt" && CARGO_TARGET_DIR="$SHARED_TARGET" cargo build --manifest-path src-tauri/Cargo.toml --bin arlesh )

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

  printf '=== %s: ready (%s, %sG free) ===\n' \
    "$name" "$(du -h "$INSTANCES/$name/arlesh" | cut -f1)" "$(free_gb)"
}

cmd_list() {
  printf '%-28s %-10s %-9s %s\n' BRANCH BUILT SIZE HEAD
  while read -r name; do
    [ -n "$name" ] || continue
    local built=no size=- head
    if [ -x "$INSTANCES/$name/arlesh" ]; then
      built=yes; size="$(du -h "$INSTANCES/$name/arlesh" | cut -f1)"
    fi
    head="$(git -C "$WORKTREES/$name" log --oneline -1 2>/dev/null || echo '?')"
    printf '%-28s %-10s %-9s %s\n' "$name" "$built" "$size" "${head:0:56}"
  done < <(all_names)
  printf '\n%sG free on /\n' "$(free_gb)"
}

cmd_build() {
  local names=("$@")
  [ "${#names[@]}" -gt 0 ] || mapfile -t names < <(all_names)
  [ "${#names[@]}" -gt 0 ] || die "No worktrees under $WORKTREES."
  # Sequential on purpose: cargo locks the shared target anyway, and this box has 15 GB of RAM —
  # parallel builds drive it into swap.
  for name in "${names[@]}"; do build_one "$name"; done
  printf '\nAll done. %sG free.\n' "$(free_gb)"
}

cmd_run() {
  local name="${1:-}"
  [ -n "$name" ] || die "Usage: $0 run <name>"
  [ -x "$INSTANCES/$name/arlesh" ] || die "'$name' is not built. Run: $0 build $name"
  printf 'Running %s with its own data at %s\n' "$name" "$INSTANCES/$name/data"
  XDG_DATA_HOME="$INSTANCES/$name/data" \
  XDG_CONFIG_HOME="$INSTANCES/$name/config" \
    exec "$INSTANCES/$name/arlesh"
}

cmd_clean() {
  local names=("$@")
  [ "${#names[@]}" -gt 0 ] || mapfile -t names < <(all_names)
  for name in "${names[@]}"; do
    # The binary is rebuildable; the database is not, so it is kept unless --all-data is given.
    rm -f "$INSTANCES/$name/arlesh"
    printf 'removed binary for %s (its data kept at %s)\n' "$name" "$INSTANCES/$name/data"
  done
  printf '%sG free.\n' "$(free_gb)"
}

case "${1:-list}" in
  list)  shift || true; cmd_list ;;
  build) shift; cmd_build "$@" ;;
  run)   shift; cmd_run "$@" ;;
  clean) shift; cmd_clean "$@" ;;
  *)     die "Usage: $0 {list|build [name...]|run <name>|clean [name...]}" ;;
esac
