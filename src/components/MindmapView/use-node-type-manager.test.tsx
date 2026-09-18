import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNodeTypeManager } from "./use-node-type-manager";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function n(id: string, kind: NodeKind, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children };
}

// root → flow → { flow_goal (with a flow_goal child), flow_task (with a flow_task child) }
function makeTree(): MindmapNode {
  const flowGoal = n("flowgoal-1", "flow_goal", [n("flowgoal-2", "flow_goal")]);
  const flowTask = n("flowtask-3", "flow_task", [n("flowtask-4", "flow_task")]);
  return n("root", "domain", [n("flow-5", "flow", [flowGoal, flowTask])]);
}

function setup(retypeNode = vi.fn().mockResolvedValue("flowtask-99")) {
  const selectNode = vi.fn();
  const showToast = vi.fn();
  const { result } = renderHook(() =>
    useNodeTypeManager({ tree: makeTree(), hiddenKinds: [], retypeNode, selectNode, showToast }),
  );
  return { result, retypeNode, selectNode };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("useNodeTypeManager — flow item cycling", () => {
  it("cycles a flow-task to a flow-goal, retyping immediately", () => {
    const { result, retypeNode } = setup();
    act(() => { result.current.cycleType("flowtask-3", 1); });
    expect(retypeNode).toHaveBeenCalledWith("flowtask-3", "flow_task", "flow_goal", undefined);
    expect(result.current.warningModal).toBeNull();
  });

  it("prompts before turning a flow-goal with flow-goal children into a flow-task", () => {
    const { result, retypeNode } = setup();
    act(() => { result.current.cycleType("flowgoal-1", 1); });
    // No conversion yet — the reparent/delete prompt is shown instead.
    expect(retypeNode).not.toHaveBeenCalled();
    expect(result.current.warningModal).toMatchObject({ toKind: "flow_task", hasGoalChildren: true });
  });

  it("retypes with the chosen child action once the prompt is confirmed", () => {
    const { result, retypeNode } = setup();
    act(() => { result.current.cycleType("flowgoal-1", 1); });
    // First action is "reparent" (primary).
    act(() => { result.current.retypeActions?.[0]?.onClick(); });
    expect(retypeNode).toHaveBeenCalledWith("flowgoal-1", "flow_goal", "flow_task", { goalChildrenAction: "reparent" });
  });

  it("does not cycle a flow item that sits under a flow-task parent", () => {
    const { result, retypeNode } = setup();
    act(() => { result.current.cycleType("flowtask-4", 1); });
    expect(retypeNode).not.toHaveBeenCalled();
    expect(result.current.warningModal).toBeNull();
  });

  it("never cycles the flow node itself", () => {
    const { result, retypeNode } = setup();
    act(() => { result.current.cycleType("flow-5", 1); });
    expect(retypeNode).not.toHaveBeenCalled();
  });
});

describe("useNodeTypeManager — cycle wraps around", () => {
  function cycleHook(tree: MindmapNode, retypeNode = vi.fn().mockResolvedValue(null)) {
    const { result } = renderHook(() =>
      useNodeTypeManager({ tree, hiddenKinds: [], retypeNode, selectNode: vi.fn(), showToast: vi.fn() }),
    );
    return { result, retypeNode };
  }

  it("wraps from the last type (info) back to the first (domain) on ctrl+down", () => {
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("aspect-1", "aspect", [n("info-9", "info")])]));
    act(() => { result.current.cycleType("info-9", 1); });
    expect(retypeNode).toHaveBeenCalledWith("info-9", "info", "domain", undefined);
  });

  it("wraps from the first type (domain) back to the last (info) on ctrl+up", () => {
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("aspect-1", "aspect", [n("domain-9", "domain")])]));
    act(() => { result.current.cycleType("domain-9", -1); });
    expect(retypeNode).toHaveBeenCalledWith("domain-9", "domain", "info", undefined);
  });

  it("setType retypes directly to a chosen valid kind (from the submenu)", () => {
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("aspect-1", "aspect", [n("goal-9", "goal")])]));
    act(() => { result.current.setType("goal-9", "info"); });
    expect(retypeNode).toHaveBeenCalledWith("goal-9", "goal", "info", undefined);
  });

  it("setType ignores a kind not valid for the node's parent", () => {
    // A node under a task parent may only be task/info — goal is not offered.
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("task-1", "task", [n("task-9", "task")])]));
    act(() => { result.current.setType("task-9", "goal"); });
    expect(retypeNode).not.toHaveBeenCalled();
  });
});

describe("useNodeTypeManager — the cycle skips kinds the filter hides", () => {
  function hiddenHook(tree: MindmapNode, hiddenKinds: NodeKind[]) {
    const retypeNode = vi.fn().mockResolvedValue(null);
    const selectNode = vi.fn();
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useNodeTypeManager({ tree, hiddenKinds, retypeNode, selectNode, showToast }),
    );
    return { result, retypeNode, selectNode, showToast };
  }

  // root → aspect-1 → the node under test, so the full domain-parent ring is available.
  function underAspect(node: MindmapNode): MindmapNode {
    return n("root", "domain", [n("aspect-1", "aspect", [node])]);
  }

  it("wraps a task straight past a hidden Info back to domain on ctrl+down", () => {
    const { result, retypeNode } = hiddenHook(underAspect(n("task-9", "task")), ["info"]);
    act(() => { result.current.cycleType("task-9", 1); });
    expect(retypeNode).toHaveBeenCalledWith("task-9", "task", "domain", undefined);
  });

  it("stops at task rather than Info when cycling up from a hidden Info's neighbour", () => {
    const { result, retypeNode } = hiddenHook(underAspect(n("domain-9", "domain")), ["info"]);
    act(() => { result.current.cycleType("domain-9", -1); });
    expect(retypeNode).toHaveBeenCalledWith("domain-9", "domain", "task", undefined);
  });

  it("offers Info again the moment nothing is hidden", () => {
    const { result, retypeNode } = hiddenHook(underAspect(n("task-9", "task")), []);
    act(() => { result.current.cycleType("task-9", 1); });
    expect(retypeNode).toHaveBeenCalledWith("task-9", "task", "info", undefined);
  });

  it("still cycles an existing Info node out of Info while Info is hidden", () => {
    const { result, retypeNode } = hiddenHook(underAspect(n("info-9", "info")), ["info"]);
    act(() => { result.current.cycleType("info-9", 1); });
    expect(retypeNode).toHaveBeenCalledWith("info-9", "info", "domain", undefined);
  });

  it("keeps the node selected after a cycle that skipped a hidden kind", async () => {
    const { result, selectNode } = hiddenHook(underAspect(n("task-9", "task")), ["info"]);
    await act(async () => { result.current.cycleType("task-9", 1); });
    expect(selectNode).toHaveBeenCalledWith("task-9");
  });

  it("does nothing at all — no retype, no toast — when the filter leaves only the node's own kind", () => {
    const { result, retypeNode, showToast } = hiddenHook(
      underAspect(n("task-9", "task")),
      ["domain", "project", "tag", "goal", "info"],
    );
    act(() => { result.current.cycleType("task-9", 1); });
    act(() => { result.current.cycleType("task-9", -1); });
    expect(retypeNode).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.warningModal).toBeNull();
  });

  it("refuses setType to a hidden kind, so the submenu and the cycle agree", () => {
    const { result, retypeNode } = hiddenHook(underAspect(n("goal-9", "goal")), ["info"]);
    act(() => { result.current.setType("goal-9", "info"); });
    expect(retypeNode).not.toHaveBeenCalled();
  });
});

describe("useNodeTypeManager — the backend's refusal becomes the prompt", () => {
  function refusingHook(rejection: unknown) {
    const retypeNode = vi.fn().mockRejectedValueOnce(rejection).mockResolvedValue("task-99");
    const selectNode = vi.fn();
    const showToast = vi.fn();
    const tree = n("root", "domain", [n("aspect-1", "aspect", [n("goal-9", "goal")])]);
    const { result } = renderHook(() =>
      useNodeTypeManager({ tree, hiddenKinds: [], retypeNode, selectNode, showToast }),
    );
    return { result, retypeNode, selectNode, showToast };
  }

  function refusal(details: unknown) {
    return { kind: "needs_confirmation", message: "would lose things", details };
  }

  it("names every child and field the command said it would lose", async () => {
    const { result, showToast } = refusingHook(
      refusal({
        lost_children: [{ kind: "goal", id: 4, title: "Sub-goal" }],
        lost_fields: [{ field: "plan", value: "12" }],
      }),
    );

    await act(async () => { result.current.setType("goal-9", "task"); });

    expect(result.current.warningModal).toMatchObject({
      nodeId: "goal-9",
      toKind: "task",
      consequences: ["warnings:strandedChildren", "warnings:strandedChild", "warnings:lostField.plan"],
    });
    // The status remap is a notification, not part of the question.
    expect(showToast).toHaveBeenCalledWith({ nodeId: "goal-9", message: "warnings:statusToast" });
  });

  it("offers reparent and delete when children are at stake, and retries with the choice", async () => {
    const { result, retypeNode } = refusingHook(
      refusal({ lost_children: [{ kind: "goal", id: 4, title: "Sub-goal" }], lost_fields: [] }),
    );
    await act(async () => { result.current.setType("goal-9", "task"); });

    expect(result.current.retypeActions).toHaveLength(2);
    await act(async () => { result.current.retypeActions?.[1]?.onClick(); });

    expect(retypeNode).toHaveBeenLastCalledWith("goal-9", "goal", "task", { strandedChildren: "delete" });
    expect(result.current.warningModal).toBeNull();
  });

  it("offers one action when only fields are at stake, and it still acknowledges", async () => {
    const { result, retypeNode } = refusingHook(
      refusal({ lost_children: [], lost_fields: [{ field: "time_scope", value: "3-5" }] }),
    );
    await act(async () => { result.current.setType("goal-9", "task"); });

    expect(result.current.retypeActions).toHaveLength(1);
    await act(async () => { result.current.retypeActions?.[0]?.onClick(); });

    // Without `strandedChildren` the command would refuse again — confirming has to say so.
    expect(retypeNode).toHaveBeenLastCalledWith("goal-9", "goal", "task", { strandedChildren: "reparent" });
  });

  it("toasts any other rejection instead of letting the retype fail in silence", async () => {
    const { result, showToast } = refusingHook({ kind: "database", message: "disk is full" });

    await act(async () => { result.current.setType("goal-9", "task"); });

    expect(result.current.warningModal).toBeNull();
    expect(showToast).toHaveBeenCalledWith({ nodeId: "goal-9", message: "warnings:retypeFailed" });
  });
});
