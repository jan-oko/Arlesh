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
    useNodeTypeManager({ tree: makeTree(), retypeNode, selectNode, showToast }),
  );
  return { result, retypeNode, selectNode };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("useNodeTypeManager — flow item cycling", () => {
  it("cycles a flow-task to a flow-goal, retyping immediately", () => {
    const { result, retypeNode } = setup();
    act(() => { result.current.cycleType("flowtask-3", 1); });
    expect(retypeNode).toHaveBeenCalledWith("flowtask-3", "flow_task", "flow_goal");
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
      useNodeTypeManager({ tree, retypeNode, selectNode: vi.fn(), showToast: vi.fn() }),
    );
    return { result, retypeNode };
  }

  it("wraps from the last type (info) back to the first (domain) on ctrl+down", () => {
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("aspect-1", "aspect", [n("info-9", "info")])]));
    act(() => { result.current.cycleType("info-9", 1); });
    expect(retypeNode).toHaveBeenCalledWith("info-9", "info", "domain");
  });

  it("wraps from the first type (domain) back to the last (info) on ctrl+up", () => {
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("aspect-1", "aspect", [n("domain-9", "domain")])]));
    act(() => { result.current.cycleType("domain-9", -1); });
    expect(retypeNode).toHaveBeenCalledWith("domain-9", "domain", "info");
  });

  it("setType retypes directly to a chosen valid kind (from the submenu)", () => {
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("aspect-1", "aspect", [n("goal-9", "goal")])]));
    act(() => { result.current.setType("goal-9", "info"); });
    expect(retypeNode).toHaveBeenCalledWith("goal-9", "goal", "info");
  });

  it("setType ignores a kind not valid for the node's parent", () => {
    // A node under a task parent may only be task/info — goal is not offered.
    const { result, retypeNode } = cycleHook(n("root", "domain", [n("task-1", "task", [n("task-9", "task")])]));
    act(() => { result.current.setType("task-9", "goal"); });
    expect(retypeNode).not.toHaveBeenCalled();
  });
});
