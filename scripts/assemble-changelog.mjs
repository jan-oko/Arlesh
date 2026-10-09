#!/usr/bin/env node
// Renders CHANGELOG.md's [Unreleased] section from the fragments in changelog.d/.
//
// Why fragments at all: [Unreleased] conflicted in five of five master-merges measured on
// 2026-09-20, every one the same shape — two branches prepending an unrelated entry to the same
// section head. One file per change means two branches touch two different files.
//
// The numbered release sections below [Unreleased] are history and are never rewritten: this
// splices the one section and copies the rest of the file through byte for byte.
//
//   node scripts/assemble-changelog.mjs           rewrite CHANGELOG.md in place
//   node scripts/assemble-changelog.mjs --check   exit 1 if it is out of step, change nothing
//
// A fragment is `changelog.d/<heading>/<NNNN>-<slug>.md`, holding one entry as user-facing prose
// about behaviour — the same thing you would have written straight into the section. The directory
// is the heading. The number orders the section, newest first, and does NOT have to be unique:
// two branches that both pick 0042 produce two different files, which is the whole point. Pick one
// above every number you can see.
//
// Everything above `main()` is pure — text in, text out — and is what assemble-changelog.test.mjs
// exercises. Only `main()` touches the disk.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const FRAGMENTS = join(ROOT, "changelog.d");

/** Keep a Changelog's headings, in the order they appear under [Unreleased]. */
export const HEADINGS = [
  { dir: "added", title: "Added" },
  { dir: "changed", title: "Changed" },
  { dir: "fixed", title: "Fixed" },
  { dir: "removed", title: "Removed" },
];

export const SECTION_HEAD = "## [Unreleased]";
const FRAGMENT_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** A fragment that cannot be read as an entry — a bad filename or a body that is not a list item. */
export class ChangelogError extends Error {}

/** One fragment's entry text, with the blank lines around it stripped. */
export function readEntry(text, label) {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) throw new ChangelogError(`${label} is empty`);
  if (!lines[0].startsWith("- ")) {
    throw new ChangelogError(`${label} must start with a "- " list entry, not: ${lines[0].slice(0, 40)}`);
  }
  return lines.join("\n");
}

/** Throws unless `name` is `<NNNN>-<kebab-slug>.md`. */
export function checkFragmentName(dir, name) {
  if (FRAGMENT_NAME.test(name)) return;
  throw new ChangelogError(
    `changelog.d/${dir}/${name}: a fragment is named <NNNN>-<kebab-slug>.md, e.g. 0042-close-to-tray.md`,
  );
}

/**
 * The entries under one heading, newest first. Ordering is by filename descending, which puts the
 * highest number at the top; a tie falls back to the rest of the filename, so the render is
 * deterministic whoever ran it and two branches never have to agree on a number.
 *
 * `files` is `[{ name, text }]`, so this stays testable without a filesystem.
 */
export function entriesFor(dir, files) {
  for (const file of files) checkFragmentName(dir, file.name);
  const ordered = [...files].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return ordered.map((file) => readEntry(file.text, `changelog.d/${dir}/${file.name}`));
}

/**
 * The whole [Unreleased] section, heading line included, ending in a single newline.
 * `fragments` maps a heading directory to its `[{ name, text }]`.
 */
export function renderSection(fragments) {
  const sections = [];
  for (const { dir, title } of HEADINGS) {
    const entries = entriesFor(dir, fragments[dir] ?? []);
    if (entries.length === 0) continue;
    sections.push(`### ${title}\n${entries.join("\n\n")}\n`);
  }
  if (sections.length === 0) return `${SECTION_HEAD}\n\n`;
  return `${SECTION_HEAD}\n\n${sections.join("\n")}\n`;
}

/** Replaces the [Unreleased] section in `source`, leaving every numbered release section alone. */
export function spliceSection(source, section) {
  const lines = source.split("\n");
  const start = lines.indexOf(SECTION_HEAD);
  if (start === -1) throw new ChangelogError(`CHANGELOG.md has no "${SECTION_HEAD}" line`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...section.split("\n").slice(0, -1), ...lines.slice(end)].join("\n");
}

/** The whole job: the current CHANGELOG.md text and the fragments in, the new text out. */
export function assemble(source, fragments) {
  return spliceSection(source, renderSection(fragments));
}

/** Reads `changelog.d/` off disk into the shape `assemble` wants. */
function loadFragments() {
  const fragments = {};
  for (const { dir } of HEADINGS) {
    const path = join(FRAGMENTS, dir);
    if (!existsSync(path)) {
      fragments[dir] = [];
      continue;
    }
    fragments[dir] = readdirSync(path)
      .filter((name) => name !== ".gitkeep")
      .map((name) => ({ name, text: readFileSync(join(path, name), "utf8") }));
  }
  return fragments;
}

function main() {
  const check = process.argv.includes("--check");
  const current = readFileSync(CHANGELOG, "utf8");
  const next = assemble(current, loadFragments());
  if (next === current) {
    console.log(check ? "CHANGELOG.md is in step with changelog.d/." : "CHANGELOG.md is already up to date.");
    return;
  }
  if (check) {
    console.error("CHANGELOG.md is out of step with changelog.d/. Run `npm run changelog` and commit the result.");
    process.exitCode = 1;
    return;
  }
  writeFileSync(CHANGELOG, next);
  console.log("Rewrote CHANGELOG.md's [Unreleased] section from changelog.d/.");
}

// Skipped when the module is imported by its test, which drives the pure functions above directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (error instanceof ChangelogError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
