#!/usr/bin/env bash
# Builds crates/arlesh-rules-wasm into src/wasm/pkg (gitignored): the wasm module and its generated
# JS glue and TypeScript declarations, which the frontend imports through src/wasm/rules.ts.
#
# Self-sufficient, so every place that builds the frontend (CI, `tauri build`, the Android bundle,
# a fresh checkout) gets the module without its own setup: it adds the wasm32 target and installs
# the `wasm-bindgen-cli` whose version matches the crate's pinned `wasm-bindgen = "=x.y.z"` (the
# two must be identical), then runs wasm-opt from the `binaryen` devDependency when present.
#
# Usage: scripts/build-rules-wasm.sh [--check]   (--check only rebuilds when a source is newer)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
crate="$root/crates/arlesh-rules-wasm"
out="$root/src/wasm/pkg"
name="arlesh_rules_wasm"

if [ "${1:-}" = "--check" ] && [ -f "$out/${name}_bg.wasm" ]; then
  newer=$(find "$crate/src" "$crate/Cargo.toml" "$root/crates/arlesh-rules/src" "$root/crates/arlesh-rules/Cargo.toml" \
    -type f -newer "$out/${name}_bg.wasm" -print -quit)
  [ -z "$newer" ] && exit 0
fi

version=$(sed -n 's/^wasm-bindgen = "=\([0-9.]*\)".*/\1/p' "$crate/Cargo.toml")
[ -n "$version" ] || { echo "wasm-bindgen is not pinned in $crate/Cargo.toml" >&2; exit 1; }

rustup target add wasm32-unknown-unknown >/dev/null
if [ "$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')" != "$version" ]; then
  echo "installing wasm-bindgen-cli $version" >&2
  cargo install wasm-bindgen-cli --version "$version" --locked
fi

cd "$crate"
cargo build --release --locked --target wasm32-unknown-unknown
built="$(cargo metadata --format-version 1 --no-deps | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).target_directory)')/wasm32-unknown-unknown/release/$name.wasm"

rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" "$built"
if [ -x "$root/node_modules/.bin/wasm-opt" ]; then
  "$root/node_modules/.bin/wasm-opt" -Oz --all-features --strip-debug --strip-producers \
    -o "$out/${name}_bg.opt.wasm" "$out/${name}_bg.wasm"
  mv -f "$out/${name}_bg.opt.wasm" "$out/${name}_bg.wasm"
else
  echo "wasm-opt not found (npm ci installs it); shipping the unoptimised module" >&2
fi
printf 'built %s (%s bytes, %s gzip)\n' "$out/${name}_bg.wasm" "$(wc -c <"$out/${name}_bg.wasm")" "$(gzip -9c "$out/${name}_bg.wasm" | wc -c)"
