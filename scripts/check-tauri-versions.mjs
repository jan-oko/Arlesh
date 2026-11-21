#!/usr/bin/env node
// Fails when an `@tauri-apps/*` npm package and its Rust crate are on different major.minor releases.
//
// Why: `tauri android build` and `tauri build` stop with "Found version mismatched Tauri packages"
// when, say, the `tauri` crate is 2.12 and `@tauri-apps/api` is 2.11. A desktop `cargo build` never
// checks, and the pull-request jobs build neither, so a Cargo.lock bump (a new plugin pulls the
// `tauri` crate forward) went unnoticed until a phone build broke.
//
//   node scripts/check-tauri-versions.mjs   exit 1 and name each drifted package
//
// Pairs: `@tauri-apps/api` and `@tauri-apps/cli` against the `tauri` crate; `@tauri-apps/plugin-<x>`
// against `tauri-plugin-<x>`. Versions come from `package-lock.json` and `Cargo.lock`, the ones that
// are built. Runs as part of `npm run lint`.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "node_modules/@tauri-apps/";

/** `major.minor` of a version string, or null. */
export function minorOf(version) {
  const m = /^(\d+)\.(\d+)\./.exec(version);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Crate name -> version, from the text of a Cargo.lock. */
export function cratesOf(cargoLock) {
  const crates = new Map();
  for (const block of cargoLock.split("[[package]]")) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (name && version) crates.set(name, version);
  }
  return crates;
}

/** The crate an npm package `@tauri-apps/<name>` pairs with, or null (platform binaries of the CLI). */
export function crateFor(name) {
  if (name === "api" || name === "cli") return "tauri";
  if (name.startsWith("plugin-")) return `tauri-plugin-${name.slice("plugin-".length)}`;
  return null;
}

/** One message per npm package whose major.minor differs from its crate's. */
export function drift(packageLock, cargoLock) {
  const crates = cratesOf(cargoLock);
  const problems = [];
  for (const [path, entry] of Object.entries(JSON.parse(packageLock).packages ?? {})) {
    if (!path.startsWith(SCOPE)) continue;
    const name = path.slice(SCOPE.length);
    const crate = crateFor(name);
    const have = crate ? crates.get(crate) : undefined;
    if (!crate || !have || !entry.version) continue;
    if (minorOf(entry.version) !== minorOf(have)) {
      problems.push(`${crate} (v${have}) : @tauri-apps/${name} (v${entry.version})`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = drift(
    readFileSync(join(ROOT, "package-lock.json"), "utf8"),
    readFileSync(join(ROOT, "Cargo.lock"), "utf8"),
  );
  if (problems.length) {
    console.error(
      "Found version mismatched Tauri packages. Make sure the NPM package and Rust crate versions are on the same major/minor releases:",
    );
    for (const p of problems) console.error(`  ${p}`);
    console.error("Fix: npm update --package-lock-only <the @tauri-apps packages above>");
    process.exit(1);
  }
}
