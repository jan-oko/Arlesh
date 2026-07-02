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
