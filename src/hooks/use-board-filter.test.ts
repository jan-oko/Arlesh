import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBoardFilter } from "./use-board-filter";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { DEFAULT_FILTER, passesExpectationPreset } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER, filterTaskList } from "@/utils/list-filter";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TimeScope } from "@/api/time-scope";

function row(id: string, timeScope?: TimeScope): TaskListRow {
  const node: MindmapNode = {
    id, kind: "task", title: id, position: 0, tagIds: [], children: [], status: "todo",
    ...(timeScope === undefined ? {} : { timeScope }),
  };
  return {
    node, ancestors: [],
    goalRef: null, goalStatus: null, projectRef: null, projectStatus: null,
    dependencyRefs: [], isBlocked: false, isAgentic: false, isAsynchronous: false,
    hasBlockedAncestor: false, hasPrivateAncestor: false, scopeTokens: [],
  };
}

const ROWS = [
  row("inside", { start_id: { kind: "day", date: "2026-09-22" }, end_id: { kind: "day", date: "2026-09-22" } }),
  row("straddling", { start_id: { kind: "day", date: "2026-09-25" }, end_id: { kind: "day", date: "2026-09-28" } }),
  row("unscoped"),
];

beforeEach(() => {
  useFilterStore.setState({
    filter: { ...DEFAULT_FILTER, statusMode: "plan", planScope: { kind: "week", date: "2026-09-20" } },
  });
  useDisplayStore.setState({ planScopeOverlapping: false, startHidesCheckedWaits: false });
});

describe("useBoardFilter", () => {
  it("fills in the app-wide match, and toggling it changes which rows pass", () => {
    const { result } = renderHook(() => useBoardFilter());
    const kept = () => filterTaskList(ROWS, result.current, DEFAULT_LIST_FILTER).map((r) => r.node.id);

    expect(result.current.scopeMatch).toBe("contained");
    expect(kept()).toEqual(["inside"]);

    act(() => { useDisplayStore.getState().togglePlanScopeOverlapping(); });
    expect(result.current.scopeMatch).toBe("overlapping");
    // Overlap keeps the straddling window, and an Unscoped Task, always relevant, overlaps every scope.
    expect(kept()).toEqual(["inside", "straddling", "unscoped"]);
  });

  it("fills in whether Start hides a wait that has checks: off by default, so Start shows it", () => {
    const checked: MindmapNode = {
      id: "wait", kind: "expectation", title: "wait", position: 0, tagIds: [], children: [],
      status: "pending", checkEvery: { n: 1, kind: "hour" },
    };
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "start" } });
    const { result } = renderHook(() => useBoardFilter());
    expect(result.current.startHidesCheckedWaits).toBe(false);
    expect(passesExpectationPreset(checked, result.current)).toBe(true);

    act(() => { useDisplayStore.getState().toggleStartHidesCheckedWaits(); });
    expect(result.current.startHidesCheckedWaits).toBe(true);
    expect(passesExpectationPreset(checked, result.current)).toBe(false);
    expect(passesExpectationPreset({ ...checked, checkEvery: null }, result.current)).toBe(true);
    expect(useFilterStore.getState().filter.startHidesCheckedWaits).toBeUndefined();
  });

  it("leaves the tab's stored filter without a match of its own", () => {
    renderHook(() => useBoardFilter());
    expect(useFilterStore.getState().filter.scopeMatch).toBeUndefined();
  });
});
