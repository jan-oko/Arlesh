import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  setHabitInstanceBlockReason, setHabitInstanceArchived, setHabitInstanceDependencies,
  setHabitInstancePlan, setHabitInstanceTitle,
} from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";
import {
  currentPlanOverride, occurrenceCandidates, pendingWrites, useOccurrenceEditor,
} from "@/hooks/use-occurrence-editor";
import type { OccurrenceEdits } from "@/hooks/use-occurrence-editor";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/api/flows", () => ({
  setHabitInstancePlan: vi.fn(),
  setHabitInstanceTitle: vi.fn(),
  setHabitInstanceBlockReason: vi.fn(),
  setHabitInstanceArchived: vi.fn(),
  setHabitInstanceDependencies: vi.fn(),
}));
vi.mock("@/api/gesture", () => ({
  withAtomicGesture: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));

const thursday = { start_id: 14, end_id: 14 };
const shop = { item_type: "flow_task" as const, item_id: 6 };
const key = { flowId: 3, itemType: "flow_task" as const, itemId: 7, scopeId: 100, cycleId: 2 };

const META = { templateTitle: "Cook", ownTitle: null, blockedReason: null, dependsOn: [shop], archived: false };

function occurrence(extra: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "habititem-flow_task-7-2-0-virtual", kind: "task", title: "Cook", position: 0, tagIds: [],
    children: [], virtual: true,
    habitItem: key,
    occurrence: META,
    ...extra,
  };
}

function unchanged(node: MindmapNode): OccurrenceEdits {
  return {
    title: node.title,
    blockedReason: node.occurrence?.blockedReason ?? "",
    plan: currentPlanOverride(node),
    dependsOn: node.occurrence?.dependsOn ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const write of [
    setHabitInstancePlan, setHabitInstanceTitle, setHabitInstanceBlockReason,
    setHabitInstanceArchived, setHabitInstanceDependencies,
  ]) {
    vi.mocked(write).mockResolvedValue(undefined);
  }
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

describe("pendingWrites", () => {
  it("writes nothing when nothing changed", () => {
    const node = occurrence();
    expect(pendingWrites(node, unchanged(node))).toEqual([]);
  });

  it("writes only the fields that changed", () => {
    const node = occurrence();
    expect(pendingWrites(node, { ...unchanged(node), title: "Cook for four", blockedReason: " no gas " }))
      .toEqual([
        { field: "title", value: "Cook for four" },
        { field: "blockedReason", value: "no gas" },
      ]);
  });

  it("hands an own title back as null when it is typed back to the template's, or emptied", () => {
    const node = occurrence({ title: "Cook for four", occurrence: { ...META, ownTitle: "Cook for four" } });
    expect(pendingWrites(node, { ...unchanged(node), title: "Cook" })).toEqual([{ field: "title", value: null }]);
    expect(pendingWrites(node, { ...unchanged(node), title: "  " })).toEqual([{ field: "title", value: null }]);
  });

  it("compares dependencies as a set, not a list", () => {
    const pasta = { item_type: "flow_task" as const, item_id: 8 };
    const node = occurrence({ occurrence: { ...META, dependsOn: [shop, pasta] } });
    expect(pendingWrites(node, { ...unchanged(node), dependsOn: [pasta, shop] })).toEqual([]);
    expect(pendingWrites(node, { ...unchanged(node), dependsOn: [] })).toEqual([{ field: "dependsOn", value: [] }]);
  });

  it("never writes a plan or dependencies for a goal occurrence", () => {
    const node = occurrence({ kind: "goal" });
    expect(pendingWrites(node, { ...unchanged(node), plan: { kind: "unplanned" }, dependsOn: [] })).toEqual([]);
  });
});

describe("occurrenceCandidates", () => {
  it("offers each other item drawn in the same iteration once, and nothing from other iterations", () => {
    const self = occurrence();
    const shopMorning = occurrence({ id: "a", title: "Shop", habitItem: { ...key, itemId: 6, cycleId: 0 },
      occurrence: { ...META, templateTitle: "Shop" } });
    const shopEvening = occurrence({ id: "b", title: "Shop", habitItem: { ...key, itemId: 6, cycleId: 9 },
      occurrence: { ...META, templateTitle: "Shop" } });
    const tomorrow = occurrence({ id: "c", habitItem: { ...key, itemId: 6, scopeId: 101 } });
    const root: MindmapNode = {
      id: "root", kind: "domain", title: "", position: 0, tagIds: [],
      children: [self, shopMorning, shopEvening, tomorrow],
    };
    expect(occurrenceCandidates(root, key)).toEqual([{ ref: shop, title: "Shop" }]);
  });
});

describe("useOccurrenceEditor", () => {
  const tree = (): MindmapNode => ({
    id: "root", kind: "domain", title: "", position: 0, tagIds: [], children: [occurrence()],
  });

  it("writes every changed field inside one gesture, then shuts and reloads", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOccurrenceEditor(tree(), reload));
    act(() => { result.current.open(occurrence()); });

    await act(() => result.current.save({
      ...unchanged(occurrence()), title: "Cook for four", plan: { kind: "planned", plan: thursday },
    }));

    expect(withAtomicGesture).toHaveBeenCalledTimes(1);
    expect(setHabitInstanceTitle).toHaveBeenCalledWith(key, "Cook for four");
    expect(setHabitInstancePlan).toHaveBeenCalledWith(key, { kind: "planned", plan: thursday });
    expect(setHabitInstanceBlockReason).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(result.current.target).toBeNull();
  });

  it("keeps the editor open and rejects when the backend refuses", async () => {
    vi.mocked(setHabitInstancePlan).mockRejectedValue(new Error("plan is not within the occurrence's window"));
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOccurrenceEditor(tree(), reload));
    act(() => { result.current.open(occurrence()); });

    await expect(act(() => result.current.save({ ...unchanged(occurrence()), plan: { kind: "unplanned" } })))
      .rejects.toThrow("occurrence's window");
    expect(result.current.target).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("deletes the occurrence from its iteration, and restores it", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOccurrenceEditor(tree(), reload));
    act(() => { result.current.open(occurrence()); });
    await act(() => result.current.setArchived(true));
    expect(setHabitInstanceArchived).toHaveBeenCalledWith(key, true);
    expect(result.current.target).toBeNull();
  });

  it("opens on a goal occurrence, but not on an iteration root", () => {
    const { result } = renderHook(() => useOccurrenceEditor(tree(), vi.fn()));
    let opened = true;
    act(() => {
      opened = result.current.open(occurrence({
        habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 100, cycleId: 0 },
      }));
    });
    expect(opened).toBe(false);
    act(() => {
      opened = result.current.open(occurrence({ kind: "goal", habitItem: { ...key, itemType: "flow_goal" } }));
    });
    expect(opened).toBe(true);
  });
});
