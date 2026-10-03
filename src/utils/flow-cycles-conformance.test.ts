import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/flow-cycles.json";
import { fail, record, str } from "@/test/conformance-board";
import type { CycleScopeKind } from "@/utils/flow-cycle";
import { cycleLevels, isCycleScopeKind, pathToIndex, subdivisionsBetween } from "@/utils/flow-cycle";

/**
 * The relative cycle grid has two evaluators: the Flow editor's navigator (`flow-cycle.ts`) and
 * `flows::rules::cycle_grid`. `conformance/flow-cycles.json` holds them together;
 * `src-tauri/tests/operations/flow_cycles_conformance.rs` is this file's other half.
 */

function array(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} is not an array`);
}

function number(value: unknown, what: string): number {
  return typeof value === "number" ? value : fail(`${what} is not a number`);
}

function kind(value: unknown, what: string): CycleScopeKind {
  const spelled = str(value, what);
  return isCycleScopeKind(spelled) ? spelled : fail(`${what} is not a cycle kind: ${spelled}`);
}

const top = record(corpusJson, "the corpus");

describe("flow cycles conformance corpus", () => {
  for (const [index, value] of array(top.subdivisions, "`subdivisions`").entries()) {
    const entry = record(value, `subdivisions[${index}]`);
    const parent = str(entry.parent, `subdivisions[${index}].parent`);
    const child = str(entry.child, `subdivisions[${index}].child`);
    it(`counts the ${child} units in a ${parent}`, () => {
      expect(subdivisionsBetween(parent, child)).toBe(number(entry.count, `subdivisions[${index}].count`));
    });
  }

  for (const [index, value] of array(top.levels, "`levels`").entries()) {
    const entry = record(value, `levels[${index}]`);
    const flowKind = str(entry.flowKind, `levels[${index}].flowKind`);
    const target = kind(entry.target, `levels[${index}].target`);
    it(`steps from ${flowKind} down to ${target}`, () => {
      const expected = array(entry.levels, `levels[${index}].levels`).map((level, i) => {
        const raw = record(level, `levels[${index}].levels[${i}]`);
        return { kind: str(raw.kind, `levels[${index}].levels[${i}].kind`), count: number(raw.count, "count") };
      });
      expect(cycleLevels(number(entry.flowN, "flowN"), flowKind, target)).toEqual(expected);
    });
  }

  for (const [index, value] of array(top.paths, "`paths`").entries()) {
    const entry = record(value, `paths[${index}]`);
    const path = array(entry.path, `paths[${index}].path`).map((step) => number(step, "step"));
    it(`names path ${path.join(".")} by one flat index`, () => {
      const levels = cycleLevels(number(entry.flowN, "flowN"), str(entry.flowKind, "flowKind"), kind(entry.target, "target"));
      expect(pathToIndex(levels, path)).toBe(number(entry.index, `paths[${index}].index`));
    });
  }
});
