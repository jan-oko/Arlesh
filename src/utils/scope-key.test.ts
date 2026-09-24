import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/scope-keys.json";
import type { PartOfDay } from "@/api/scopes";
import type { ScopeRef } from "@/utils/scope-ref";
import {
  canonicalStart, keyContaining, keyForRef, keyStartDate, sameScopeKey, scopeKeyFrom,
  scopeKeyFromText, scopeKeyText,
} from "@/utils/scope-key";

/**
 * A key's canonical text is produced in two places — here, to compare keys and index maps without
 * a round trip, and in the Rust `ScopeKey`, which writes the columns. `conformance/scope-keys.json`
 * is the one list both replay, so the two cannot drift apart unnoticed.
 */
interface Cell {
  kind: string;
  date?: string;
  part?: string;
  start?: string;
  end?: string;
}

interface KeyCase {
  cell: Cell;
  key: unknown;
  text: string;
}

const PARTS: readonly PartOfDay[] = ["premorning", "morning", "noon", "afternoon", "evening", "night"];

function refOf(cell: Cell): ScopeRef {
  if (cell.kind === "exact" && cell.start !== undefined && cell.end !== undefined) {
    return { kind: "exact", start: cell.start, end: cell.end };
  }
  const part = PARTS.find((candidate) => candidate === cell.part);
  if (cell.kind === "part_of_day" && cell.date !== undefined && part !== undefined) {
    return { kind: "part_of_day", date: cell.date, part };
  }
  if (cell.date === undefined) throw new Error("malformed corpus cell");
  switch (cell.kind) {
    case "season":
    case "month":
    case "week":
    case "day":
      return { kind: cell.kind, date: cell.date };
    default:
      throw new Error("malformed corpus cell");
  }
}

const cases: KeyCase[] = corpusJson.cases;

describe("the shared scope-key corpus", () => {
  it.each(cases.map((item) => [item.text, item] as const))("writes %s", (text, item) => {
    const key = keyForRef(refOf(item.cell));
    expect(scopeKeyText(key)).toBe(text);
    expect(key).toEqual(item.key);
  });

  it.each(cases.map((item) => [item.text] as const))("reads %s back to the same text", (text) => {
    const key = scopeKeyFromText(text);
    expect(key).not.toBeNull();
    if (key !== null) expect(scopeKeyText(key)).toBe(text);
  });
});

describe("scopeKeyText", () => {
  it("writes one text whatever order the key's fields arrived in", () => {
    const loose = scopeKeyFromText('{ "part": "night", "date": "2026-09-23", "kind": "part_of_day" }');
    expect(loose).not.toBeNull();
    if (loose !== null) {
      expect(scopeKeyText(loose)).toBe('{"kind":"part_of_day","date":"2026-09-23","part":"night"}');
    }
  });
});

describe("sameScopeKey", () => {
  it("compares keys by value, not by identity", () => {
    expect(sameScopeKey({ kind: "week", date: "2026-09-20" }, keyContaining("week", "2026-09-23"))).toBe(true);
    expect(sameScopeKey({ kind: "week", date: "2026-09-20" }, { kind: "day", date: "2026-09-20" })).toBe(false);
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

describe("scopeKeyFrom", () => {
  it("refuses anything that is no key", () => {
    for (const raw of [
      null, 42, "week:2026-09-20", { kind: "fortnight", date: "2026-09-20" }, { kind: "week", date: "tomorrow" },
      { kind: "part_of_day", date: "2026-09-23", part: "dusk" }, { kind: "exact", start: "2026-09-23T14:00:00" },
    ]) {
      expect(scopeKeyFrom(raw)).toBeNull();
    }
    expect(scopeKeyFromText("not json")).toBeNull();
  });
});

describe("keyStartDate", () => {
  it("reads the first day of any key", () => {
    expect(keyStartDate({ kind: "week", date: "2026-09-20" })).toBe("2026-09-20");
    expect(keyStartDate({ kind: "part_of_day", date: "2026-09-23", part: "night" })).toBe("2026-09-23");
    expect(keyStartDate({ kind: "exact", start: "2026-09-23T14:00:00", end: "2026-09-24T01:00:00" })).toBe("2026-09-23");
  });
});
