import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/habit-fold.json";
import { fail, record, str } from "@/test/conformance-board";
import type { HabitCollapseLabels } from "@/utils/habit-collapse";
import { foldHabitRuns } from "@/utils/habit-collapse";
import type { CanonicalKind } from "@/utils/scope-ref";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * The Habit fold has two evaluators: `foldHabitRuns`, which every view runs per render over what
 * the filter kept, and `flows::rules::fold`. `conformance/habit-fold.json` holds them together;
 * `src-tauri/tests/operations/habit_fold_conformance.rs` is this file's other half.
 */

const KINDS: readonly CanonicalKind[] = ["day", "week", "month", "season"];

/** Labels are drawing, not the fold: every one reads as nothing. */
const LABELS: HabitCollapseLabels = { run: () => "", level: () => "", unit: () => "", span: () => "" };

function bool(value: unknown, what: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(`${what} is not a boolean`);
  return value;
}

/** One corpus child, drawn as the board draws it. */
function child(value: unknown, index: number, what: string): MindmapNode {
  const raw = record(value, what);
  const id = str(raw.id, `${what}.id`);
  const node: MindmapNode = { id, kind: "task", title: id, position: index, tagIds: [], children: [] };
  if (raw.flow === undefined) return node;
  if (typeof raw.flow !== "number") fail(`${what}.flow is not a number`);
  const kind = raw.kind === null ? null : str(raw.kind, `${what}.kind`);
  return {
    ...node,
    habitIteration: {
      flowId: raw.flow,
      flowTitle: "Habit",
      index,
      scopeKind: kind === null ? null : (KINDS.find((candidate) => candidate === kind) ?? fail(`${what}.kind`)),
      anchorDate: str(raw.anchor, `${what}.anchor`),
      windowEnd: str(raw.windowEnd, `${what}.windowEnd`),
      passed: bool(raw.passed, `${what}.passed`),
      done: bool(raw.done, `${what}.done`),
      ...(bool(raw.owed, `${what}.owed`) ? { owed: true } : {}),
    },
  };
}

/** What the corpus writes for a folded child. */
function drawn(node: MindmapNode): unknown {
  const group = node.habitGroup;
  if (group === undefined) return node.id;
  return {
    id: node.id,
    level: group.level,
    tally: { passed: group.passed, done: group.done, missed: group.missed },
    children: node.children.map(drawn),
  };
}

const top = record(corpusJson, "the corpus");
const cases: unknown[] = Array.isArray(top.cases) ? top.cases : fail("`cases` is not an array");

describe("habit fold conformance corpus", () => {
  for (const [caseIndex, value] of cases.entries()) {
    const raw = record(value, `cases[${caseIndex}]`);
    const name = str(raw.name, `cases[${caseIndex}].name`);
    it(name, () => {
      if (typeof raw.threshold !== "number") fail(`${name}.threshold is not a number`);
      if (!Array.isArray(raw.children)) fail(`${name}.children is not an array`);
      const children = raw.children.map((entry, index) => child(entry, index, `${name}.children[${index}]`));
      const root: MindmapNode = { id: "host", kind: "task", title: "host", position: 0, tagIds: [], children };
      expect(foldHabitRuns(root, raw.threshold, LABELS).children.map(drawn)).toEqual(raw.folded);
    });
  }
});
