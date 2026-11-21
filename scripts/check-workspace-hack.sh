#!/usr/bin/env bash
# Guards the workspace-hack crate (crates/arlesh-workspace-hack, .config/hakari.toml), which makes the
# desktop app and the server's native module resolve the shared crates alike so each compiles once
# into box's shared target. Two checks:
#
#   1. The hack is what hakari would generate, and every crate has its dependency line
#      (`cargo hakari generate --diff`, `cargo hakari manage-deps --dry-run`).
#   2. The goal itself, which hakari cannot see (a hand-written line in the hack, a workspace
#      crate's own feature such as arlesh-backend/sqlite): every unit at or below arlesh-rules,
#      arlesh-core and arlesh-backend is identical in the app's and the module's build
#      (scripts/check-shared-features.py, from cargo's unit graph, no compile).
#
# Fix, after adding or changing a dependency or a feature:
#   cargo install cargo-hakari --locked --version 0.9.39     # once; CI pins the same version
#   cargo hakari generate && cargo hakari manage-deps --yes
# If two branches both regenerated the hack, git conflicts on its Cargo.toml by design
# (.gitattributes: merge=binary): take dev's file and regenerate.

set -euo pipefail

cd "$(dirname "$0")/.."

fix="Run: cargo hakari generate && cargo hakari manage-deps --yes   (install: cargo install cargo-hakari --locked --version 0.9.39)"

if ! command -v cargo-hakari >/dev/null; then
  echo "cargo-hakari is not installed. Install it: cargo install cargo-hakari --locked --version 0.9.39" >&2
  exit 1
fi

if ! cargo hakari generate --diff; then
  echo >&2
  echo "The workspace-hack crate is out of date. $fix" >&2
  exit 1
fi

if ! cargo hakari manage-deps --dry-run; then
  echo >&2
  echo "A workspace crate is missing its arlesh-workspace-hack dependency. $fix" >&2
  exit 1
fi

python3 scripts/check-shared-features.py
echo "arlesh-workspace-hack is up to date."
