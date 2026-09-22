#!/usr/bin/env node
// Fails if a tracked source file contains a raw NUL (0x00) byte.
//
// Why this exists: git decides a file is binary by looking for a NUL in its first 8000 bytes. One
// stray NUL anywhere in a .ts file therefore costs the whole file its diff, its blame and its
// three-way merge — `git diff` prints "Bin 4944 -> 5065 bytes" and a conflict in it cannot be
// resolved by hand. grep skips it too, so the file drops out of ordinary code search. On a repo
// running many branches at once that is expensive, and it is invisible until someone tries to
// merge. NodeSearchModal.tsx carried one for four commits before anyone noticed (Arlesh-ru8).
//
// This does NOT ban the NUL *character* from strings — `"\u0000"` is a perfectly good separator and
// two files here rely on it. It bans writing that character as a raw byte instead of an escape,
// which is a distinction only the source text can make, so no ESLint rule can see it: by the time
// ESLint has an AST, the escape and the raw byte are the same string value.
//
//   node scripts/check-source-text.mjs   exit 1 and name the offenders, change nothing
//
// Runs as part of `npm run lint`. The directories below hold source only — no images, no binaries —
// so every file in them is read and checked.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["src", "src-tauri/src", "scripts"];

/** Every file under `dir`, recursively, as absolute paths. */
function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/** Paths, relative to the repo root, of the files in `paths` that contain a raw NUL byte. */
function withNulByte(paths) {
  return paths.filter((path) => readFileSync(path).includes(0)).map((path) => relative(ROOT, path));
}

function main() {
  const roots = ROOTS.map((dir) => join(ROOT, dir)).filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory());
  const offenders = withNulByte(roots.flatMap(filesUnder));
  if (offenders.length === 0) return;
  console.error("Raw NUL (0x00) byte in source — git will treat these files as binary:");
  for (const path of offenders) console.error(`  ${path}`);
  console.error('Write the NUL as an escape ("\\u0000") instead of embedding the byte.');
  process.exit(1);
}

main();
