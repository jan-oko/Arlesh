import { describe, it, expect } from "vitest";
import { drawnPathToNode, fallbackRootFor, storedSubtreeBase } from "@/utils/drawn-path";
import type { FoldReading } from "@/utils/drawn-path";
import { habitGroupFlowId, habitRunId } from "@/utils/habit-collapse";
import type { HabitIterationMeta, MindmapNode } from "@/utils/tree-layout";

const FLOW = 7;
const RUN = habitRunId(FLOW);
const WEEK_ONE = `habitrun-${FLOW}-week-2026-09-08-virtual`;

/** One passed, day-long iteration of Habit 7, anchored on `date`. */
function iteration(date: string, index: number, done = false): MindmapNode {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const habitIteration: HabitIterationMeta = {
    flowId: FLOW, flowTitle: "Journal", index, scopeKind: "day", anchorDate: date,
    windowEnd: `${next.toISOString().slice(0, 10)}T02:00:00`, passed: true, done,
  };
  return {
    id: `habit-${FLOW}-${index}-virtual`, kind: "task", title: date, virtual: true, habitIteration,
    position: index, tagIds: [], children: [],
  };
}

const TREE: MindmapNode = {
  id: "root", kind: "domain", title: "Arlesh", position: 0, tagIds: [],
  children: [{
    id: "goal-5", rowId: 5, kind: "goal", title: "Fitness", position: 0, tagIds: [],
    children: ["2026-09-08", "2026-09-09", "2026-09-15", "2026-09-16"].map((date, index) => iteration(date, index)),
  }],
};

const LABELS = {
  run: (habit: string, tally: { passed: number }) => `${habit}: ${tally.passed}`,
  level: (unit: string) => unit,
  unit: (level: string, anchorDate: string) => `${level}:${anchorDate}`,
  span: (start: string, end: string) => `${start}..${end}`,
};

function reading(threshold = 3, drawHost: (host: MindmapNode) => MindmapNode = (host) => host): FoldReading {
  return { threshold, labels: LABELS, drawHost };
}

function ids(path: readonly MindmapNode[]): string[] {
  return path.map((node) => node.id);
}

describe("a fold id", () => {
  it("names the Habit it belongs to, whether a run or a scope level", () => {
    expect(habitGroupFlowId(RUN)).toBe(FLOW);
    expect(habitGroupFlowId(WEEK_ONE)).toBe(FLOW);
    expect(habitGroupFlowId("habit-7-0-virtual")).toBeUndefined();
    expect(habitGroupFlowId("goal-5")).toBeUndefined();
  });
});

describe("the path to a node as drawn", () => {
  it("resolves a run by folding its Habit's host again", () => {
    expect(ids(drawnPathToNode(TREE, RUN, reading()))).toEqual(["root", "goal-5", RUN]);
  });

  it("resolves a scope level beneath the run", () => {
    expect(ids(drawnPathToNode(TREE, WEEK_ONE, reading()))).toEqual(["root", "goal-5", RUN, WEEK_ONE]);
  });

  it("puts the fold back between the host and an iteration drawn inside it", () => {
    expect(ids(drawnPathToNode(TREE, "habit-7-0-virtual", reading())))
      .toEqual(["root", "goal-5", RUN, WEEK_ONE, "habit-7-0-virtual"]);
  });

  it("leaves an iteration's path as loaded when its run is under the threshold", () => {
    expect(ids(drawnPathToNode(TREE, "habit-7-0-virtual", reading(9)))).toEqual(["root", "goal-5", "habit-7-0-virtual"]);
    expect(drawnPathToNode(TREE, RUN, reading(9))).toEqual([]);
  });

  it("folds what the view draws, so a run the filter thinned below the threshold is not there", () => {
    const keepOne = (host: MindmapNode): MindmapNode => ({ ...host, children: host.children.slice(0, 1) });
    expect(drawnPathToNode(TREE, RUN, reading(3, keepOne))).toEqual([]);
  });
});

describe("where a root that is no longer drawn climbs to", () => {
  it("a level climbs to its run, and a run to its Habit's host", () => {
    expect(fallbackRootFor(TREE, `habitrun-${FLOW}-week-2020-01-05-virtual`, reading())).toBe(RUN);
    expect(fallbackRootFor(TREE, RUN, reading(9))).toBe("goal-5");
  });

  it("anything else, or a Habit no longer on the board, goes to the true root", () => {
    expect(fallbackRootFor(TREE, "task-404", reading())).toBeNull();
    expect(fallbackRootFor(TREE, habitRunId(99), reading())).toBeNull();
  });
});

describe("the stored node a loaded-tree view roots at", () => {
  it("is a fold node's host, since only the Steps View draws the fold as a Step", () => {
    expect(storedSubtreeBase(TREE, RUN).id).toBe("goal-5");
    expect(storedSubtreeBase(TREE, "goal-5").id).toBe("goal-5");
    expect(storedSubtreeBase(TREE, null).id).toBe("root");
    expect(storedSubtreeBase(TREE, "gone-1").id).toBe("root");
  });
});
