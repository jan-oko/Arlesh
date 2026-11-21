#!/usr/bin/env bash
# Fails when the workspace-hack crate (crates/arlesh-workspace-hack) has drifted: a dependency or a
# feature was added to a crate and the hack was not regenerated, or a workspace crate lost its
# dependency line on it. Drift is what splits the desktop app's and the server module's builds
# into two sets of cargo units again (see .config/hakari.toml).
#
# Fix: `cargo hakari generate && cargo hakari manage-deps --yes`, and commit the result.
# Needs cargo-hakari (`cargo install cargo-hakari --locked`).

set -euo pipefail

cd "$(dirname "$0")/.."

if ! cargo hakari generate --diff; then
  echo >&2
  echo "The workspace-hack crate is out of date: run 'cargo hakari generate'." >&2
  exit 1
fi

if ! cargo hakari manage-deps --dry-run; then
  echo >&2
  echo "A workspace crate is missing its arlesh-workspace-hack dependency: run" >&2
  echo "'cargo hakari manage-deps --yes'." >&2
  exit 1
fi
echo "arlesh-workspace-hack is up to date."
