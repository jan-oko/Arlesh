import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/cooldown.json";
import { fail, record, str } from "@/test/conformance-board";
import type { CooldownKind } from "@/api/flows";
import { cooldownKinds, maxCooldown } from "@/components/FlowEditorModal/recurrence-ui";

/**
 * A Habit's cooldown options have two evaluators: the Flow editor's `cooldownKinds` and
 * `maxCooldown`, which bound the field as you type, and the backend's `CooldownUnit::allowed_for`
 * and `Cooldown::longest`, the bound `Cooldown::fits` refuses past. `conformance/cooldown.json` holds
 * them together; `src-tauri/tests/operations/cooldown_conformance.rs` is this file's other half.
 */

const UNITS: readonly CooldownKind[] = ["part", "day", "week", "month"];

function unit(value: unknown, what: string): CooldownKind {
  const spelled = str(value, what);
  return UNITS.find((candidate) => candidate === spelled) ?? fail(`${what} is not a cooldown unit`);
}

function array(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} is not an array`);
}

function number(value: unknown, what: string): number {
  return typeof value === "number" ? value : fail(`${what} is not a number`);
}

const top = record(corpusJson, "the corpus");

describe("cooldown conformance corpus", () => {
  for (const [index, value] of array(top.units, "`units`").entries()) {
    const entry = record(value, `units[${index}]`);
    const kind = str(entry.habitKind, `units[${index}].habitKind`);
    it(`a ${kind} habit counts a cooldown in the units the corpus names`, () => {
      const units = array(entry.units, `units[${index}].units`).map((u, i) => unit(u, `units[${index}].units[${i}]`));
      expect(cooldownKinds(kind)).toEqual(units);
    });
  }

  for (const [index, value] of array(top.cases, "`cases`").entries()) {
    const entry = record(value, `cases[${index}]`);
    const kind = str(entry.habitKind, `cases[${index}].habitKind`);
    const n = number(entry.habitN, `cases[${index}].habitN`);
    const cooldownUnit = unit(entry.unit, `cases[${index}].unit`);
    it(`a ${n} ${kind} habit takes at most ${String(entry.longest)} ${cooldownUnit}`, () => {
      expect(maxCooldown(cooldownUnit, kind, n)).toBe(number(entry.longest, `cases[${index}].longest`));
    });
  }
});
