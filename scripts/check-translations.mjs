#!/usr/bin/env node
// Fails if any non-English locale is missing a key that English defines.
//
// TypeScript types translation keys from the English JSON only (src/i18n/types.d.ts), so a key
// missing from another locale (e.g. Hebrew) is NOT caught by tsc — it silently falls back to
// English. This gate closes that hole: every locale must cover every English key.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");

/** Flattens nested translation objects to dotted keys. */
function flatten(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function keysOf(lang, namespace) {
  const file = join(localesDir, lang, `${namespace}.json`);
  if (!existsSync(file)) return null;
  return new Set(flatten(JSON.parse(readFileSync(file, "utf8"))));
}

const namespaces = readdirSync(join(localesDir, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const otherLangs = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "en")
  .map((entry) => entry.name);

const missing = [];
for (const namespace of namespaces) {
  const enKeys = keysOf("en", namespace) ?? new Set();
  for (const lang of otherLangs) {
    const langKeys = keysOf(lang, namespace);
    if (langKeys === null) {
      missing.push(`${lang}/${namespace}.json: entire namespace file missing`);
      continue;
    }
    for (const key of enKeys) {
      if (!langKeys.has(key)) missing.push(`${lang}/${namespace}: ${key}`);
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing translations (${missing.length}):\n${missing.join("\n")}`);
  process.exit(1);
}
console.log(`Translations: ${otherLangs.join(", ") || "no other locales"} cover all English keys`);
