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
// Pairs: `@tauri-apps/api` against the `tauri` crate; `@tauri-apps/plugin-<x>` against
// `tauri-plugin-<x>`. `@tauri-apps/cli` is deliberately NOT compared: the failure that prompted this
// (tauri crate 2.12.5, api 2.11.1) named only `api` although the CLI was on 2.11.3, as far behind the
// crate, so the Tauri CLI's own check does not look at the CLI's version. Versions come from
// `package-lock.json` and `Cargo.lock`, the ones that are built. A pre-release (`2.13.0-rc.1`) counts
// as its major.minor, like the Tauri CLI. Where Cargo.lock holds several versions of a crate, the one
// the app crate (`src-tauri`) depends on is used. Runs as part of `npm run lint`.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "node_modules/@tauri-apps/";

/** `major.minor` of a version string (a pre-release suffix is ignored), or null. */
export function minorOf(version) {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(version);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** The `[[package]]` blocks of a Cargo.lock: name, version and the dependency entries. */
export function packagesOf(cargoLock) {
  const out = [];
  for (const block of cargoLock.split("[[package]]")) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    const deps = /^dependencies = \[([^\]]*)\]/m.exec(block)?.[1] ?? "";
    out.push({ name, version, deps: [...deps.matchAll(/"([^"]+)"/g)].map((d) => d[1]) });
  }
  return out;
}

/**
 * The version of `crate` the root crate resolves: the only one in the lock, else the one the root's
 * dependency entry names (`"tauri 2.12.5"`); null when it cannot be told.
 */
export function resolvedVersion(packages, crate, root) {
  const versions = packages.filter((p) => p.name === crate).map((p) => p.version);
  if (versions.length <= 1) return versions[0] ?? null;
  const deps = packages.find((p) => p.name === root)?.deps ?? [];
  for (const dep of deps) {
    const [name, version] = dep.split(" ");
    if (name === crate && version && versions.includes(version)) return version;
  }
  return null;
}

/** The crate an npm package `@tauri-apps/<name>` pairs with, or null (the CLI, its platform binaries). */
export function crateFor(name) {
  if (name === "api") return "tauri";
  if (name.startsWith("plugin-")) return `tauri-plugin-${name.slice("plugin-".length)}`;
  return null;
}

/** One message per npm package whose major.minor differs from its crate's (or cannot be compared). */
export function drift(packageLock, cargoLock, root = "arlesh") {
  const packages = packagesOf(cargoLock);
  const problems = [];
  for (const [path, entry] of Object.entries(JSON.parse(packageLock).packages ?? {})) {
    if (!path.startsWith(SCOPE)) continue;
    const name = path.slice(SCOPE.length);
    const crate = crateFor(name);
    if (!crate || !packages.some((p) => p.name === crate) || !entry.version) continue;
    const have = resolvedVersion(packages, crate, root);
    if (have === null) {
      problems.push(`${crate}: several versions in Cargo.lock and none is ${root}'s; cannot tell which @tauri-apps/${name} must match`);
    } else if (minorOf(entry.version) === null || minorOf(have) === null) {
      problems.push(`${crate} (v${have}) : @tauri-apps/${name} (v${entry.version}) cannot be compared`);
    } else if (minorOf(entry.version) !== minorOf(have)) {
      problems.push(`${crate} (v${have}) : @tauri-apps/${name} (v${entry.version})`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = /^name = "([^"]+)"/m.exec(readFileSync(join(ROOT, "src-tauri", "Cargo.toml"), "utf8"))?.[1];
  const problems = drift(
    readFileSync(join(ROOT, "package-lock.json"), "utf8"),
    readFileSync(join(ROOT, "Cargo.lock"), "utf8"),
    root,
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
