import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNodeTypeManager } from "./use-node-type-manager";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { testKey } from "@/test/scope-key";

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
      useNodeTypeManager({ tree, retypeNode, selectNode: vi.fn(), showToast: vi.fn() }),
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

describe("useNodeTypeManager — the backend's refusal becomes the prompt", () => {
  function refusingHook(rejection: unknown) {
    const retypeNode = vi.fn().mockRejectedValueOnce(rejection).mockResolvedValue("task-99");
    const selectNode = vi.fn();
    const showToast = vi.fn();
    const tree = n("root", "domain", [n("aspect-1", "aspect", [n("goal-9", "goal")])]);
    const { result } = renderHook(() =>
      useNodeTypeManager({ tree, retypeNode, selectNode, showToast }),
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

describe("useNodeTypeManager — a Commitment with nowhere to get a window", () => {
  const UNSCOPED = { kind: "needs_time_scope", message: "a commitment must have a time scope of its own or inherit one" };
  const TONIGHT = { start_id: testKey(7), end_id: testKey(7) };

  function unscopedHook(first: unknown = UNSCOPED) {
    const retypeNode = vi.fn().mockRejectedValueOnce(first).mockResolvedValue("commitment-99");
    const showToast = vi.fn();
    const tree = n("root", "domain", [n("aspect-1", "aspect", [n("task-9", "task")])]);
    const { result } = renderHook(() =>
      useNodeTypeManager({ tree, retypeNode, selectNode: vi.fn(), showToast }),
    );
    return { result, retypeNode, showToast };
  }

  it("asks for a window instead of toasting a failure", async () => {
    const { result, showToast } = unscopedHook();
    await act(async () => { result.current.setType("task-9", "commitment"); });

    expect(result.current.commitmentScopeRequest).toMatchObject({
      nodeId: "task-9", toKind: "commitment", title: "task-9",
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("runs the retype again carrying the window that was chosen", async () => {
    const { result, retypeNode } = unscopedHook();
    await act(async () => { result.current.setType("task-9", "commitment"); });
    await act(async () => { result.current.resolveCommitmentScope(TONIGHT); });

    expect(retypeNode).toHaveBeenLastCalledWith("task-9", "task", "commitment", { timeScope: TONIGHT });
    expect(result.current.commitmentScopeRequest).toBeNull();
  });

  it("cancelling writes nothing at all, so the node is left exactly as it was", async () => {
    const { result, retypeNode } = unscopedHook();
    await act(async () => { result.current.setType("task-9", "commitment"); });
    await act(async () => { result.current.resolveCommitmentScope(null); });

    // One call: the refused one. Nothing was written, so there is no half-retyped node to undo.
    expect(retypeNode).toHaveBeenCalledTimes(1);
    expect(result.current.commitmentScopeRequest).toBeNull();
  });

  it("keeps the answer already given to the loss prompt in front of it", async () => {
    // Two refusals in a row: first what the retype would lose, then the missing window. Answering
    // the second must not throw away the acknowledgement that got past the first.
    const retypeNode = vi
      .fn()
      .mockRejectedValueOnce({
        kind: "needs_confirmation",
        message: "would lose things",
        details: { lost_children: [], lost_fields: [{ field: "plan", value: "12" }] },
      })
      .mockRejectedValueOnce(UNSCOPED)
      .mockResolvedValue("commitment-99");
    const tree = n("root", "domain", [n("aspect-1", "aspect", [n("task-9", "task")])]);
    const { result } = renderHook(() =>
      useNodeTypeManager({ tree, retypeNode, selectNode: vi.fn(), showToast: vi.fn() }),
    );

    await act(async () => { result.current.setType("task-9", "commitment"); });
    await act(async () => { result.current.retypeActions?.[0]?.onClick(); });
    await act(async () => { result.current.resolveCommitmentScope(TONIGHT); });

    expect(retypeNode).toHaveBeenLastCalledWith("task-9", "task", "commitment", {
      strandedChildren: "reparent",
      timeScope: TONIGHT,
    });
  });
});
