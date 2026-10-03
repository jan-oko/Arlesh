import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/scope-keys.json";
import { fail, record, str } from "@/test/conformance-board";
import { dayScopeDate, monthCells, partContaining, seasonOf, weekNumber } from "@/utils/scope-calendar";

/**
 * The calendar rules the scope picker navigates by per keystroke — week numbers, season names and
 * years, and which Day and part hold an instant by the 02:00 boundary — have two evaluators:
 * `scope-calendar.ts`, and the Rust scopes and wait rules. `conformance/scope-keys.json` holds them
 * together; `src-tauri/tests/structure/scopes.rs` is this file's other half.
 */

function array(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} is not an array`);
}

/** The label the calendar gives a canonical key, as the Rust `ScopeKey::label` spells it. */
function labelOf(kind: string, date: string): string {
  switch (kind) {
    case "day":
      return date;
    case "week":
      return `Week ${weekNumber(date)} ${date.slice(0, 4)}`;
    case "month": {
      const cell = monthCells(Number(date.slice(0, 4))).find((candidate) => candidate.startDate === date);
      return cell?.label ?? fail(`no month cell starts on ${date}`);
    }
    case "season": {
      const season = seasonOf(date);
      return `${season.name} ${season.year}`;
    }
    default:
      return fail(`${kind} has no calendar label`);
  }
}

const top = record(corpusJson, "the corpus");

describe("calendar conformance corpus", () => {
  for (const [index, value] of array(top.labels, "`labels`").entries()) {
    const entry = record(value, `labels[${index}]`);
    const key = record(entry.key, `labels[${index}].key`);
    const kind = str(key.kind, `labels[${index}].key.kind`);
    const date = str(key.date, `labels[${index}].key.date`);
    it(`labels the ${kind} of ${date}`, () => {
      expect(labelOf(kind, date)).toBe(str(entry.label, `labels[${index}].label`));
    });
  }

  for (const [index, value] of array(top.instants, "`instants`").entries()) {
    const entry = record(value, `instants[${index}]`);
    const at = str(entry.at, `instants[${index}].at`);
    it(`finds the day and part holding ${at}`, () => {
      const hour = Number(at.slice(11, 13));
      expect(dayScopeDate(at.slice(0, 10), hour)).toBe(str(entry.day, `instants[${index}].day`));
      expect(partContaining(hour)).toBe(str(entry.part, `instants[${index}].part`));
    });
  }
});
