#!/usr/bin/env node
// Re-cuts the fresh-database baseline to the newest migration.
//
// A fresh database is created from crates/arlesh-core/baseline/schema.sql, which stands for
// migrations 1..=N, and runs only the migrations above N (crates/arlesh-core/src/database/
// baseline.rs). N is the number in baseline/version.txt. Left alone, every migration added since
// would run on top of the baseline in every new database, and the cost this baseline exists to
// remove would creep back one migration at a time. So when a migration lands on master the master
// bot (.github/workflows/master-bot.yml) moves N to the newest migration and regenerates the
// schema. Nobody re-cuts by hand, and a branch never does: a re-cut in a branch conflicts with
// every other branch that adds a migration.
//
//   node scripts/recut-baseline.mjs           re-cut when behind
//   node scripts/recut-baseline.mjs --force   regenerate even when not behind (a migration changed)
//
// It prints `recut` when it rewrote the baseline and `current` when it did not. Everything above
// `main()` is pure and is what recut-baseline.test.mjs exercises.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "crates/arlesh-core");
const MIGRATIONS = join(CORE, "migrations");
const VERSION_FILE = join(CORE, "baseline/version.txt");

const MIGRATION_NAME = /^(\d+)_.+\.sql$/;

/** The highest migration number among `filenames`; throws when there is none. */
export function latestMigration(filenames) {
  const versions = filenames
    .map((name) => MIGRATION_NAME.exec(name))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]));
  if (versions.length === 0) throw new Error("no migrations found");
  return Math.max(...versions);
}

/** The number `version.txt` holds. */
export function parseVersion(text) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`baseline/version.txt must hold one number, not: ${trimmed}`);
  return Number(trimmed);
}

/** Whether to regenerate: behind the newest migration, or forced because a migration changed. */
export function needsRecut({ latest, current, force }) {
  return force || latest > current;
}

function main() {
  const force = process.argv.includes("--force");
  const latest = latestMigration(readdirSync(MIGRATIONS));
  const current = parseVersion(readFileSync(VERSION_FILE, "utf8"));
  if (!needsRecut({ latest, current, force })) {
    console.log("current");
    return;
  }
  writeFileSync(VERSION_FILE, `${latest}\n`);
  const run = spawnSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "arlesh-core", "--example", "generate_baseline"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (run.status !== 0) process.exit(run.status ?? 1);
  console.log("recut");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
