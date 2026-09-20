import { describe, it, expect } from "vitest";
import {
  collapsedWithFoldedRuns,
  foldHabitRuns,
  habitRunId,
  isHabitRunNode,
  levelsForRun,
  unitKey,
  type HabitCollapseLabels,
} from "@/utils/habit-collapse";
import type { CanonicalKind } from "@/utils/scope-ref";
import type { HabitIterationMeta, MindmapNode } from "@/utils/tree-layout";

/** Plain, un-localized stand-ins, so what a node reads is visible in the assertion. */
const LABELS: HabitCollapseLabels = {
  run: (tally) => `${tally.passed} passed · ${tally.done} done, ${tally.missed} missed`,
  level: (unit, tally) => `${unit} · ${tally.done} done, ${tally.missed} missed`,
  unit: (level, anchorDate) => `${level}:${anchorDate}`,
  span: (start, end) => `${start}..${end}`,
};

const FLOW = 7;

/** One day-long iteration anchored on `date`, whose window closed the next midnight. */
function dayIteration(
  date: string,
  options: { done?: boolean; passed?: boolean; flowId?: number; index?: number } = {},
): MindmapNode {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const meta: HabitIterationMeta = {
    flowId: options.flowId ?? FLOW,
    index: options.index ?? 0,
    scopeKind: "day",
    anchorDate: date,
    windowEnd: `${next.toISOString().slice(0, 10)}T00:00:00`,
    passed: options.passed ?? true,
    done: options.done ?? false,
  };
  return {
    id: `habit-${meta.flowId}-${date}-virtual`,
    kind: "task",
    title: date,
    virtual: true,
    habitIteration: meta,
    position: meta.index,
    tagIds: [],
    children: [],
  };
}

/** One iteration of a coarser kind, anchored on the first day of its window. */
function iterationOfKind(kind: CanonicalKind, date: string, windowEnd: string, index: number): MindmapNode {
  const node = dayIteration(date, { index });
  return {
    ...node,
    id: `habit-${FLOW}-${kind}-${date}-virtual`,
    habitIteration: { ...node.habitIteration!, scopeKind: kind, windowEnd },
  };
}

function host(children: MindmapNode[]): MindmapNode {
  return { id: "goal-5", kind: "goal", title: "Fitness", position: 0, tagIds: [], children };
}

function titles(nodes: readonly MindmapNode[]): string[] {
  return nodes.map((node) => node.title);
}

describe("unitKey", () => {
  it("puts both halves of a Winter that straddles New Year in the same season and year", () => {
    expect(unitKey("season", "2026-12-20")).toBe(unitKey("season", "2027-01-10"));
    expect(unitKey("year", "2026-12-20")).toBe("2026");
    expect(unitKey("year", "2027-01-10")).toBe("2026");
  });

  it("keys a month by its calendar month and a week by its Sunday", () => {
    expect(unitKey("month", "2026-09-14")).toBe("2026-09");
    expect(unitKey("week", "2026-09-14")).toBe("2026-09-13");
  });
});

describe("levelsForRun", () => {
  function metas(nodes: readonly MindmapNode[]): HabitIterationMeta[] {
    return nodes.map((node) => node.habitIteration!);
  }

  it("inserts no week level for five days inside one week", () => {
    const run = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"].map((d) => dayIteration(d));
    expect(levelsForRun(metas(run))).toEqual([]);
  });

  it("inserts a week level but no month level for three weeks inside one month", () => {
    const run = ["2026-09-07", "2026-09-14", "2026-09-21"].map((d) => dayIteration(d));
    expect(levelsForRun(metas(run))).toEqual(["week"]);
  });

  it("orders the levels coarsest first when a run spans months and weeks", () => {
    const run = ["2026-08-10", "2026-09-10", "2026-10-10"].map((d) => dayIteration(d));
    expect(levelsForRun(metas(run))).toEqual(["season", "month", "week"]);
  });

  it("never inserts a level at or below the iterations' own scope kind", () => {
    // Two months inside one Autumn: nothing coarser is spanned twice, and no month or week level
    // may be inserted under monthly iterations.
    const run = [
      iterationOfKind("month", "2026-09-01", "2026-10-01T00:00:00", 0),
      iterationOfKind("month", "2026-10-01", "2026-11-01T00:00:00", 1),
    ];
    expect(levelsForRun(metas(run))).toEqual([]);
  });

  it("groups seasons under a year only once the run spans more than one of them", () => {
    const oneYear = [
      iterationOfKind("season", "2026-03-01", "2026-06-01T00:00:00", 0),
      iterationOfKind("season", "2026-06-01", "2026-09-01T00:00:00", 1),
    ];
    expect(levelsForRun(metas(oneYear))).toEqual([]);

    const twoYears = [
      iterationOfKind("season", "2026-09-01", "2026-12-01T00:00:00", 0),
      iterationOfKind("season", "2027-03-01", "2027-06-01T00:00:00", 1),
    ];
    expect(levelsForRun(metas(twoYears))).toEqual(["year"]);
  });

  it("treats a sub-day Phase window as a day, so its iterations are the day nodes", () => {
    const run = ["2026-09-14", "2026-09-15"].map((d) => {
      const node = dayIteration(d);
      return { ...node, habitIteration: { ...node.habitIteration!, scopeKind: null } };
    });
    expect(levelsForRun(metas(run))).toEqual([]);
  });
});

describe("foldHabitRuns", () => {
  it("folds a run at the threshold and reads its tally", () => {
    const tree = host([
      dayIteration("2026-09-14", { done: true, index: 0 }),
      dayIteration("2026-09-15", { done: true, index: 1 }),
      dayIteration("2026-09-16", { index: 2 }),
    ]);

    const folded = foldHabitRuns(tree, 3, LABELS);

    expect(titles(folded.children)).toEqual(["3 passed · 2 done, 1 missed"]);
  });

  it("leaves a run shorter than the threshold as its own iterations", () => {
    const tree = host([
      dayIteration("2026-09-14", { index: 0 }),
      dayIteration("2026-09-15", { index: 1 }),
    ]);

    const folded = foldHabitRuns(tree, 3, LABELS);

    expect(titles(folded.children)).toEqual(["2026-09-14", "2026-09-15"]);
  });

  it("always draws the iteration whose window is still open on its own", () => {
    const tree = host([
      dayIteration("2026-09-14", { index: 0 }),
      dayIteration("2026-09-15", { index: 1 }),
      dayIteration("2026-09-16", { index: 2 }),
      dayIteration("2026-09-17", { index: 3, passed: false }),
    ]);

    const folded = foldHabitRuns(tree, 3, LABELS);

    expect(titles(folded.children)).toEqual(["3 passed · 0 done, 3 missed", "2026-09-17"]);
  });

  it("folds each Habit's iterations only with its own", () => {
    const tree = host([
      dayIteration("2026-09-14", { index: 0 }),
      dayIteration("2026-09-15", { index: 1 }),
      dayIteration("2026-09-16", { index: 2 }),
      dayIteration("2026-09-14", { index: 0, flowId: 9 }),
      dayIteration("2026-09-15", { index: 1, flowId: 9 }),
    ]);

    const folded = foldHabitRuns(tree, 3, LABELS);

    expect(titles(folded.children)).toEqual([
      "3 passed · 0 done, 3 missed",
      "2026-09-14",
      "2026-09-15",
    ]);
  });

  it("leaves every other node where it was", () => {
    const tree = host([
      { id: "task-1", kind: "task", title: "Buy shoes", position: 0, tagIds: [], children: [] },
      dayIteration("2026-09-14", { index: 0 }),
      dayIteration("2026-09-15", { index: 1 }),
      dayIteration("2026-09-16", { index: 2 }),
    ]);

    const folded = foldHabitRuns(tree, 3, LABELS);

    expect(titles(folded.children)).toEqual(["Buy shoes", "3 passed · 0 done, 3 missed"]);
  });

  it("folds runs wherever they sit in the tree, not only under the root", () => {
    const tree: MindmapNode = {
      id: "root", kind: "domain", title: "Root", position: 0, tagIds: [],
      children: [host([
        dayIteration("2026-09-14", { index: 0 }),
        dayIteration("2026-09-15", { index: 1 }),
        dayIteration("2026-09-16", { index: 2 }),
      ])],
    };

    const folded = foldHabitRuns(tree, 3, LABELS);

    expect(titles(folded.children[0]?.children ?? [])).toEqual(["3 passed · 0 done, 3 missed"]);
  });

  it("gives the run node the span of its iterations' days for the tooltip", () => {
    const tree = host([
      dayIteration("2026-09-14", { index: 0 }),
      dayIteration("2026-09-15", { index: 1 }),
      dayIteration("2026-09-16", { index: 2 }),
    ]);

    const run = foldHabitRuns(tree, 3, LABELS).children[0];

    expect(run?.habitGroup?.spanStart).toBe("2026-09-14");
    expect(run?.habitGroup?.spanEnd).toBe("2026-09-16");
    expect(run?.habitGroup?.spanLabel).toBe("2026-09-14..2026-09-16");
  });

  it("expands into week nodes, each carrying its own tally, when the run spans weeks", () => {
    const dates = ["2026-09-08", "2026-09-09", "2026-09-15", "2026-09-16"];
    const tree = host(dates.map((d, i) => dayIteration(d, { index: i, done: i === 0 })));

    const run = foldHabitRuns(tree, 3, LABELS).children[0];

    expect(titles(run?.children ?? [])).toEqual([
      "week:2026-09-08 · 1 done, 1 missed",
      "week:2026-09-15 · 0 done, 2 missed",
    ]);
    expect(titles(run?.children[0]?.children ?? [])).toEqual(["2026-09-08", "2026-09-09"]);
  });

  it("nests month over week when the run spans both", () => {
    // September and October both fall in Autumn, so no season level joins them.
    const dates = ["2026-09-10", "2026-09-20", "2026-10-10", "2026-10-20"];
    const tree = host(dates.map((d, i) => dayIteration(d, { index: i })));

    const run = foldHabitRuns(tree, 3, LABELS).children[0];

    expect(titles(run?.children ?? [])).toEqual([
      "month:2026-09-10 · 0 done, 2 missed",
      "month:2026-10-10 · 0 done, 2 missed",
    ]);
    expect(titles(run?.children[0]?.children ?? [])).toEqual([
      "week:2026-09-10 · 0 done, 1 missed",
      "week:2026-09-20 · 0 done, 1 missed",
    ]);
  });

  it("gives every group node a distinct id even where a week straddles two months", () => {
    const dates = ["2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"];
    const tree = host(dates.map((d, i) => dayIteration(d, { index: i })));

    const run = foldHabitRuns(tree, 3, LABELS).children[0];
    const ids: string[] = [];
    function visit(node: MindmapNode): void {
      ids.push(node.id);
      node.children.forEach(visit);
    }
    visit(run!);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the run node after its flow, so an expansion survives the run growing", () => {
    const tree = host([
      dayIteration("2026-09-14", { index: 0 }),
      dayIteration("2026-09-15", { index: 1 }),
      dayIteration("2026-09-16", { index: 2 }),
    ]);

    const run = foldHabitRuns(tree, 3, LABELS).children[0];

    expect(run?.id).toBe(habitRunId(FLOW));
    expect(isHabitRunNode(run!)).toBe(true);
  });

  it("marks the run node virtual, so it can be neither edited nor dragged", () => {
    const tree = host([
      dayIteration("2026-09-14", { index: 0 }),
      dayIteration("2026-09-15", { index: 1 }),
      dayIteration("2026-09-16", { index: 2 }),
    ]);

    expect(foldHabitRuns(tree, 3, LABELS).children[0]?.virtual).toBe(true);
  });
});

describe("collapsedWithFoldedRuns", () => {
  const tree = host([
    dayIteration("2026-09-14", { index: 0 }),
    dayIteration("2026-09-15", { index: 1 }),
    dayIteration("2026-09-16", { index: 2 }),
  ]);
  const folded = foldHabitRuns(tree, 3, LABELS);

  it("collapses a run the user has not expanded", () => {
    const collapsed = collapsedWithFoldedRuns(folded, new Set(), new Set());
    expect(collapsed.has(habitRunId(FLOW))).toBe(true);
  });

  it("leaves an expanded run open", () => {
    const collapsed = collapsedWithFoldedRuns(folded, new Set(), new Set([habitRunId(FLOW)]));
    expect(collapsed.has(habitRunId(FLOW))).toBe(false);
  });

  it("keeps the nodes the user collapsed by hand", () => {
    const collapsed = collapsedWithFoldedRuns(folded, new Set(["goal-5"]), new Set());
    expect(collapsed.has("goal-5")).toBe(true);
  });
});
