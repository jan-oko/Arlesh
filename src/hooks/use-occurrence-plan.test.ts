import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setHabitInstancePlan } from "@/api/flows";
import { currentPlanOverride, useOccurrencePlan } from "@/hooks/use-occurrence-plan";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("@/api/flows", () => ({ setHabitInstancePlan: vi.fn() }));

const thursday = { start_id: 14, end_id: 14 };

function occurrence(extra: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "habititem-flow_task-7-2-0-virtual", kind: "task", title: "Run", position: 0, tagIds: [],
    children: [], virtual: true,
    habitItem: { flowId: 3, itemType: "flow_task", itemId: 7, scopeId: 100, cycleId: 2 },
    ...extra,
  };
}

beforeEach(() => {
  vi.mocked(setHabitInstancePlan).mockReset();
});

describe("currentPlanOverride", () => {
  it("reads an untouched occurrence as following its Cycle Plan, whatever that plan is", () => {
    expect(currentPlanOverride(occurrence({ plan: thursday, planOverridden: false }))).toEqual({ kind: "inherit" });
  });

  it("reads an overridden occurrence with a plan as planned on its own", () => {
    expect(currentPlanOverride(occurrence({ plan: thursday, planOverridden: true })))
      .toEqual({ kind: "planned", plan: thursday });
  });

  it("reads an overridden occurrence with no plan as deliberately unplanned", () => {
    expect(currentPlanOverride(occurrence({ plan: null, planOverridden: true }))).toEqual({ kind: "unplanned" });
  });
});

describe("useOccurrencePlan", () => {
  it("writes the plan against the occurrence it was opened on, then shuts and reloads", async () => {
    vi.mocked(setHabitInstancePlan).mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOccurrencePlan(reload));

    act(() => {
      result.current.open(occurrence());
    });
    await act(() => result.current.save({ kind: "planned", plan: thursday }));

    expect(setHabitInstancePlan).toHaveBeenCalledWith(3, 7, 100, 2, { kind: "planned", plan: thursday });
    expect(reload).toHaveBeenCalled();
    expect(result.current.target).toBeNull();
  });

  it("keeps the editor open and rejects when the backend refuses the plan", async () => {
    vi.mocked(setHabitInstancePlan).mockRejectedValue(new Error("plan is not within the occurrence's window"));
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOccurrencePlan(reload));
    act(() => {
      result.current.open(occurrence());
    });

    await expect(act(() => result.current.save({ kind: "unplanned" }))).rejects.toThrow("occurrence's window");
    expect(result.current.target).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses to open on a goal occurrence or an iteration root", () => {
    const { result } = renderHook(() => useOccurrencePlan(vi.fn()));
    let opened = true;
    act(() => {
      opened = result.current.open(occurrence({
        habitItem: { flowId: 3, itemType: "flow_goal", itemId: 7, scopeId: 100, cycleId: 0 },
      }));
    });
    expect(opened).toBe(false);
    expect(result.current.target).toBeNull();
  });
});
