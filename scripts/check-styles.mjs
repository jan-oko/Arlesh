#!/usr/bin/env node
// Fails if an interactive JSX element has no className (or props spread) — the usual cause of
// unstyled "white" controls against the dark theme. Checks <button>, <select>, <textarea>, and
// non-checkbox/radio <input>. Options are excluded (styled via their parent select).
//
// Not a full JSX parser: it scans each opening tag brace- and string-aware, so arrow functions
// (`onClick={() => x > 0}`) inside attributes don't prematurely end the tag.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const TAGS = ["button", "select", "textarea", "input"];

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) return [path];
    return [];
  });
}

/** Returns the opening tag text starting at `start` (`<`), scanning brace/string-aware to `>`. */
function openingTag(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote !== null) {
      if (char === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

const violations = [];
for (const file of tsxFiles(srcDir)) {
  const source = readFileSync(file, "utf8");
  for (const tag of TAGS) {
    const needle = `<${tag}`;
    let index = source.indexOf(needle);
    while (index !== -1) {
      const boundary = source[index + needle.length];
      if (boundary !== undefined && /[\s/>]/.test(boundary)) {
        const text = openingTag(source, index);
        const isBareInput = /\btype\s*=\s*["'](checkbox|radio|hidden)["']/.test(text);
        const styled =
          text.includes("className") || text.includes("style=") || text.includes("{...");
        if (!styled && !isBareInput) {
          violations.push(`${file.replace(srcDir, "src")}:${lineOf(source, index)}: <${tag}> has no className`);
        }
      }
      index = source.indexOf(needle, index + needle.length);
    }
  }
}

if (violations.length > 0) {
  console.error(`Unstyled interactive elements (${violations.length}):\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("Styles: all interactive elements have a className");
