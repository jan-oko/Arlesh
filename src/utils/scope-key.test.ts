import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/scope-keys.json";
import type { PartOfDay } from "@/api/scopes";
import type { ScopeRef } from "@/utils/scope-ref";
import { canonicalStart, keyContaining, keyForRef, keyStartDate, refForKey } from "@/utils/scope-key";

/**
 * The value key is spelled in two places — here, to name a cell without a round trip, and in the
 * Rust `ScopeKey`, which the columns hold. `conformance/scope-keys.json` is the one list both
 * replay, so the two spellings cannot drift apart unnoticed.
 */
interface KeyCase {
  kind: string;
  date?: string;
  part?: string;
  start?: string;
  end?: string;
  key: string;
}

const PARTS: readonly PartOfDay[] = ["premorning", "morning", "noon", "afternoon", "evening", "night"];

function refOf(item: KeyCase): ScopeRef {
  if (item.kind === "exact" && item.start !== undefined && item.end !== undefined) {
    return { kind: "exact", start: item.start, end: item.end };
  }
  const part = PARTS.find((candidate) => candidate === item.part);
  if (item.kind === "part_of_day" && item.date !== undefined && part !== undefined) {
    return { kind: "part_of_day", date: item.date, part };
  }
  if (item.date === undefined) throw new Error(`malformed corpus case ${item.key}`);
  switch (item.kind) {
    case "season":
    case "month":
    case "week":
    case "day":
      return { kind: item.kind, date: item.date };
    default:
      throw new Error(`malformed corpus case ${item.key}`);
  }
}

const cases: KeyCase[] = corpusJson.cases;

describe("the shared scope-key corpus", () => {
  it.each(cases.map((item) => [item.key, item] as const))("spells %s", (_key, item) => {
    expect(keyForRef(refOf(item))).toBe(item.key);
  });

  it.each(cases.map((item) => [item.key] as const))("reads %s back as its own cell", (key) => {
    const ref = refForKey(key);
    expect(ref).not.toBeNull();
    if (ref !== null) expect(keyForRef(ref)).toBe(key);
  });
});

describe("canonicalStart", () => {
  it("snaps a date to its week's Sunday, its month's 1st and its season's first day", () => {
    expect(canonicalStart("week", "2026-09-23")).toBe("2026-09-20");
    expect(canonicalStart("month", "2026-09-23")).toBe("2026-09-01");
    expect(canonicalStart("season", "2026-10-15")).toBe("2026-09-01");
    expect(canonicalStart("season", "2027-02-01")).toBe("2026-12-01");
  });
});

describe("keyContaining", () => {
  it("names the scope of a kind holding a date", () => {
    expect(keyContaining("week", "2026-09-26")).toBe("week:2026-09-20");
  });
});

describe("refForKey", () => {
  it("refuses a string that is no key", () => {
    for (const raw of ["", "42", "fortnight:2026-09-20", "week:tomorrow", "part_of_day:2026-09-23:dusk", "exact:2026-09-23T14:00:00"]) {
      expect(refForKey(raw)).toBeNull();
    }
  });
});

describe("keyStartDate", () => {
  it("reads the first day of any key", () => {
    expect(keyStartDate("week:2026-09-20")).toBe("2026-09-20");
    expect(keyStartDate("part_of_day:2026-09-23:night")).toBe("2026-09-23");
    expect(keyStartDate("exact:2026-09-23T14:00:00/2026-09-24T01:00:00")).toBe("2026-09-23");
    expect(keyStartDate("nonsense")).toBeNull();
  });
});
