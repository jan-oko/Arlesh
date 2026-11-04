#!/usr/bin/env bash
# SPIKE (ADR 0015): build the rules slice to wasm and print its sizes.
#
# Needs `rustup target add wasm32-unknown-unknown`, `cargo install wasm-bindgen-cli --version 0.2.130`
# and a `wasm-opt` on PATH (binaryen; `npm i binaryen` works). Output goes to spike/rules-wasm/pkg.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
target="$here/../../src-tauri/target/wasm32-unknown-unknown/release"
cd "$here"
cargo build --release --target wasm32-unknown-unknown
rm -rf pkg
wasm-bindgen --target web --out-dir pkg "$target/arlesh_rules_wasm_spike.wasm"
wasm-opt -Oz --all-features --strip-debug --strip-producers \
  \
  -o pkg/arlesh_rules_wasm_spike_bg.opt.wasm pkg/arlesh_rules_wasm_spike_bg.wasm
for f in "$target/arlesh_rules_wasm_spike.wasm" pkg/arlesh_rules_wasm_spike_bg.wasm pkg/arlesh_rules_wasm_spike_bg.opt.wasm pkg/arlesh_rules_wasm_spike.js; do
  printf '%-48s raw %8d  gzip %8d  brotli %8s\n' "$(basename "$f")" "$(wc -c <"$f")" "$(gzip -9c "$f" | wc -c)" \
    "$(command -v brotli >/dev/null && brotli -c "$f" | wc -c || echo n/a)"
done
